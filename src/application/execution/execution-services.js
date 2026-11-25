import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { minutesBetween } from '../../shared/clock.js';
import {
  validateExecutionInput,
  validateOutcomeInput,
  validateObservationInput,
} from '../../domain/execution/execution-validators.js';

export function createExecutionService({ executionRepository, referenceResolver = null, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function updateStatus(id, nextStatus, { notes = null } = {}) {
    const current = executionRepository.findExecutionById(id);
    if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Ejecución no encontrada: ${id}`, { entity: 'Execution' });
    const now = nowIso();
    const updated = {
      ...current,
      execution_status: nextStatus,
      completed_at: ['COMPLETED', 'INTERRUPTED', 'CANCELLED'].includes(nextStatus) ? (current.completed_at ?? now) : current.completed_at,
      notes: notes !== null ? notes : current.notes,
      updated_at: now,
    };
    executionRepository.updateExecution(updated);
    auditService?.recordChange({
      entity_type: 'execution',
      entity_id: id,
      operation_type: `execution.${nextStatus.toLowerCase()}`,
      previous_state: { execution_status: current.execution_status },
      new_state: { execution_status: updated.execution_status },
    });
    return updated;
  }

  return {
    startExecution(input) {
      validateExecutionInput(input);
      referenceResolver?.assertExists(input.related_entity_type, input.related_entity_id);
      const now = nowIso();
      const exec = {
        id: randomUUID(),
        related_entity_type: input.related_entity_type,
        related_entity_id: input.related_entity_id,
        started_at: input.started_at ?? now,
        completed_at: null,
        execution_status: 'STARTED',
        source_id: input.source_id ?? null,
        notes: (input.notes ?? '').trim(),
        created_at: now,
        updated_at: now,
      };
      executionRepository.insertExecution(exec);
      return exec;
    },
    pauseExecution(id, opts) { return updateStatus(id, 'PAUSED', opts); },
    resumeExecution(id, opts) { return updateStatus(id, 'STARTED', opts); },
    completeExecution(id, opts) { return updateStatus(id, 'COMPLETED', opts); },
    interruptExecution(id, opts) { return updateStatus(id, 'INTERRUPTED', opts); },
    cancelExecution(id, opts) { return updateStatus(id, 'CANCELLED', opts); },
    getExecution(id) {
      const exec = executionRepository.findExecutionById(id);
      if (!exec) throw new NexusError(ERROR_CODES.NOT_FOUND, `Ejecución no encontrada: ${id}`, { entity: 'Execution' });
      return {
        ...exec,
        sessions: executionRepository.listSessionsByExecution(id),
        outcomes: executionRepository.listOutcomesByExecution(id),
      };
    },
    listExecutions(filters = {}) {
      return executionRepository.listExecutions(filters);
    },
  };
}

export function createWorkSessionService({ executionRepository, taskService = null, transactionService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function syncTaskActualDuration(executionId) {
    if (!taskService) return;
    const exec = executionRepository.findExecutionById(executionId);
    if (!exec || exec.related_entity_type !== 'task') return;
    const allExecutions = executionRepository.listExecutions({
      related_entity_type: 'task',
      related_entity_id: exec.related_entity_id,
    });
    let totalActualMinutes = 0;
    for (const ex of allExecutions) {
      const sessions = executionRepository.listSessionsByExecution(ex.id);
      for (const sess of sessions) {
        if (sess.status === 'ENDED' && Number.isFinite(sess.duration_minutes)) {
          totalActualMinutes += sess.duration_minutes;
        }
      }
    }
    // NL-MASTER-02 §6.3: registra duración real acumulada sin sobrescribir estimated_duration_minutes
    taskService.updateTask(exec.related_entity_id, { actual_duration_minutes: totalActualMinutes });
  }

  return {
    startSession({ execution_id, started_at = null, notes = '' }) {
      if (!executionRepository.findExecutionById(execution_id)) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, `Ejecución no encontrada: ${execution_id}`);
      }
      const session = {
        id: randomUUID(),
        execution_id,
        started_at: started_at ?? nowIso(),
        ended_at: null,
        paused_at: null,
        duration_minutes: null,
        pause_duration_minutes: 0,
        status: 'ACTIVE',
        notes: notes.trim(),
      };
      return executionRepository.insertSession(session);
    },

    pauseSession(id) {
      const s = executionRepository.findSessionById(id);
      if (!s) throw new NexusError(ERROR_CODES.NOT_FOUND, `Sesión no encontrada: ${id}`);
      if (s.status !== 'ACTIVE') throw new NexusError(ERROR_CODES.CONFLICT, 'Solo se puede pausar una sesión ACTIVE.');
      return executionRepository.updateSession({ ...s, status: 'PAUSED', paused_at: nowIso() });
    },

    resumeSession(id) {
      const s = executionRepository.findSessionById(id);
      if (!s) throw new NexusError(ERROR_CODES.NOT_FOUND, `Sesión no encontrada: ${id}`);
      if (s.status !== 'PAUSED') throw new NexusError(ERROR_CODES.CONFLICT, 'Solo se puede reanudar una sesión PAUSED.');
      const pauseMins = s.paused_at ? Math.max(0, minutesBetween(s.paused_at, nowIso())) : 0;
      return executionRepository.updateSession({
        ...s,
        status: 'ACTIVE',
        paused_at: null,
        pause_duration_minutes: s.pause_duration_minutes + pauseMins,
      });
    },

    endSession(id, { ended_at = null, notes = null, pause_duration_minutes = null } = {}) {
      const s = executionRepository.findSessionById(id);
      if (!s) throw new NexusError(ERROR_CODES.NOT_FOUND, `Sesión no encontrada: ${id}`);
      const endIso = ended_at ?? nowIso();
      let pauseMins = pause_duration_minutes !== null ? Number(pause_duration_minutes) : s.pause_duration_minutes;
      if (s.status === 'PAUSED' && s.paused_at && pause_duration_minutes === null) {
        pauseMins += Math.max(0, minutesBetween(s.paused_at, endIso));
      }
      const totalMins = Math.max(0, minutesBetween(s.started_at, endIso));
      const netDuration = Math.max(0, totalMins - pauseMins);

      const applyEnd = () => {
        const updatedSession = executionRepository.updateSession({
          ...s,
          ended_at: endIso,
          paused_at: null,
          pause_duration_minutes: pauseMins,
          duration_minutes: netDuration,
          status: 'ENDED',
          notes: notes !== null ? notes : s.notes,
        });
        syncTaskActualDuration(s.execution_id);
        return updatedSession;
      };

      if (transactionService) {
        return transactionService.executeAtomicOperation(applyEnd);
      }
      return applyEnd();
    },

    getSession(id) {
      const s = executionRepository.findSessionById(id);
      if (!s) throw new NexusError(ERROR_CODES.NOT_FOUND, `Sesión no encontrada: ${id}`);
      return s;
    },

    listSessionsByExecution(executionId) {
      return executionRepository.listSessionsByExecution(executionId);
    },
  };
}

export function createOutcomeService({ executionRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    recordOutcome(input) {
      validateOutcomeInput(input, false);
      if (!executionRepository.findExecutionById(input.execution_id)) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, `Ejecución no encontrada: ${input.execution_id}`);
      }
      const now = nowIso();
      const outcome = {
        id: randomUUID(),
        execution_id: input.execution_id,
        outcome_type: input.outcome_type,
        description: (input.description ?? '').trim(),
        achieved_at: input.achieved_at ?? now,
        evidence_id: input.evidence_id ?? null,
        updated_at: now,
      };
      return executionRepository.insertOutcome(outcome);
    },

    updateOutcome(id, patch) {
      const current = executionRepository.findOutcomeById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Resultado no encontrado: ${id}`);
      validateOutcomeInput(patch, true);
      const updated = {
        ...current,
        outcome_type: patch.outcome_type ?? current.outcome_type,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        evidence_id: patch.evidence_id !== undefined ? patch.evidence_id : current.evidence_id,
        updated_at: nowIso(),
      };
      return executionRepository.updateOutcome(updated);
    },

    getOutcome(id) {
      const o = executionRepository.findOutcomeById(id);
      if (!o) throw new NexusError(ERROR_CODES.NOT_FOUND, `Resultado no encontrado: ${id}`);
      return o;
    },

    listOutcomesByExecution(executionId) {
      return executionRepository.listOutcomesByExecution(executionId);
    },
  };
}

export function createObservationService({ executionRepository, referenceResolver = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createObservation(input) {
      validateObservationInput(input);
      referenceResolver?.assertExists(input.related_entity_type, input.related_entity_id);
      const obs = {
        id: randomUUID(),
        related_entity_type: input.related_entity_type,
        related_entity_id: input.related_entity_id,
        content: input.content.trim(),
        observed_at: input.observed_at ?? nowIso(),
        source_id: input.source_id ?? null,
      };
      return executionRepository.insertObservation(obs);
    },

    getObservation(id) {
      const o = executionRepository.findObservationById(id);
      if (!o) throw new NexusError(ERROR_CODES.NOT_FOUND, `Observación no encontrada: ${id}`);
      return o;
    },

    listObservations(filters = {}) {
      return executionRepository.listObservations(filters);
    },

    relateObservation(observationId, { related_entity_type, related_entity_id }) {
      const base = this.getObservation(observationId);
      return this.createObservation({
        related_entity_type,
        related_entity_id,
        content: `[Ref:${base.id}] ${base.content}`,
        source_id: base.source_id,
      });
    },
  };
}
