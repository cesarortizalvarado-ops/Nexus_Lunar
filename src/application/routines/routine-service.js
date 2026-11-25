import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { validateRoutineInput, validateRoutineStepExecutionStatus } from '../../domain/habits/habit-validators.js';

export function createRoutineService({ habitRoutineRepository, habitService = null, transactionService, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));

  function saveRevisionSnapshot(routine, reason) {
    const steps = habitRoutineRepository.listRoutineSteps(routine.id);
    habitRoutineRepository.insertRoutineRevision({
      id: randomUUID(),
      routine_id: routine.id,
      version: routine.version,
      snapshot: { routine, steps },
      reason,
      created_at: nowIso(),
    });
  }

  return {
    createRoutine(input) {
      validateRoutineInput(input, false);
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        const routine = {
          id: randomUUID(),
          name: input.name.trim(),
          description: (input.description ?? '').trim(),
          category: (input.category ?? 'general').trim(),
          expected_duration_minutes: input.expected_duration_minutes ?? null,
          frequency: input.frequency ?? { type: 'DAILY' },
          preferred_time_window: input.preferred_time_window ?? null,
          status: input.status ?? 'ACTIVE',
          version: 1,
          created_at: now,
          updated_at: now,
          archived_at: null,
        };
        habitRoutineRepository.insertRoutine(routine);
        const steps = [];
        if (Array.isArray(input.steps)) {
          input.steps.forEach((s, idx) => {
            const step = habitRoutineRepository.insertRoutineStep({
              id: randomUUID(),
              routine_id: routine.id,
              name: String(s.name).trim(),
              description: (s.description ?? '').trim(),
              step_order: s.step_order ?? idx + 1,
              estimated_duration_minutes: s.estimated_duration_minutes ?? null,
              required: s.required !== undefined ? Boolean(s.required) : true,
              related_activity_id: s.related_activity_id ?? null,
              related_habit_id: s.related_habit_id ?? null,
              created_at: now,
              updated_at: now,
            });
            steps.push(step);
          });
        }
        saveRevisionSnapshot(routine, 'Creación inicial de rutina');
        auditService?.recordChange({ entity_type: 'routine', entity_id: routine.id, operation_type: 'routine.create', new_state: { routine, steps_count: steps.length } });
        return { ...routine, steps };
      });
    },

    getRoutine(id) {
      const r = habitRoutineRepository.findRoutineById(id);
      if (!r) throw new NexusError(ERROR_CODES.NOT_FOUND, `Rutina no encontrada: ${id}`, { entity: 'Routine' });
      return { ...r, steps: habitRoutineRepository.listRoutineSteps(id) };
    },

    listRoutines(filters = {}) {
      return habitRoutineRepository.listRoutines(filters).map(r => ({
        ...r,
        steps: habitRoutineRepository.listRoutineSteps(r.id),
      }));
    },

    updateRoutine(id, patch, { reason = 'Actualización de rutina' } = {}) {
      const current = habitRoutineRepository.findRoutineById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Rutina no encontrada: ${id}`);
      validateRoutineInput(patch, true);
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        const nextStatus = patch.status ?? current.status;
        const updated = {
          ...current,
          name: patch.name !== undefined ? patch.name.trim() : current.name,
          description: patch.description !== undefined ? patch.description.trim() : current.description,
          category: patch.category !== undefined ? patch.category.trim() : current.category,
          expected_duration_minutes: patch.expected_duration_minutes !== undefined ? patch.expected_duration_minutes : current.expected_duration_minutes,
          frequency: patch.frequency ?? current.frequency,
          preferred_time_window: patch.preferred_time_window !== undefined ? patch.preferred_time_window : current.preferred_time_window,
          status: nextStatus,
          version: current.version + 1,
          updated_at: now,
          archived_at: nextStatus === 'ARCHIVED' ? (current.archived_at ?? now) : current.archived_at,
        };
        habitRoutineRepository.updateRoutine(updated);
        saveRevisionSnapshot(updated, reason);
        return this.getRoutine(id);
      });
    },

    changeRoutineStatus(id, status) { return this.updateRoutine(id, { status }, { reason: `Cambio de estado a ${status}` }); },
    archiveRoutine(id) { return this.changeRoutineStatus(id, 'ARCHIVED'); },

    addRoutineStep(routineId, stepInput) {
      const r = habitRoutineRepository.findRoutineById(routineId);
      if (!r) throw new NexusError(ERROR_CODES.NOT_FOUND, `Rutina no encontrada: ${routineId}`);
      if (!stepInput?.name || !stepInput.name.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en RoutineStep.');
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        const existing = habitRoutineRepository.listRoutineSteps(routineId);
        const step = habitRoutineRepository.insertRoutineStep({
          id: randomUUID(),
          routine_id: routineId,
          name: stepInput.name.trim(),
          description: (stepInput.description ?? '').trim(),
          step_order: stepInput.step_order ?? existing.length + 1,
          estimated_duration_minutes: stepInput.estimated_duration_minutes ?? null,
          required: stepInput.required !== undefined ? Boolean(stepInput.required) : true,
          related_activity_id: stepInput.related_activity_id ?? null,
          related_habit_id: stepInput.related_habit_id ?? null,
          created_at: now,
          updated_at: now,
        });
        const updated = habitRoutineRepository.updateRoutine({ ...r, version: r.version + 1, updated_at: now });
        saveRevisionSnapshot(updated, `Paso añadido: ${step.name}`);
        return step;
      });
    },

    updateRoutineStep(stepId, patch) {
      const step = habitRoutineRepository.findRoutineStepById(stepId);
      if (!step) throw new NexusError(ERROR_CODES.NOT_FOUND, `Paso de rutina no encontrado: ${stepId}`);
      const r = habitRoutineRepository.findRoutineById(step.routine_id);
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        const updatedStep = habitRoutineRepository.updateRoutineStep({
          ...step,
          name: patch.name !== undefined ? patch.name.trim() : step.name,
          description: patch.description !== undefined ? patch.description.trim() : step.description,
          step_order: patch.step_order !== undefined ? Number(patch.step_order) : step.step_order,
          estimated_duration_minutes: patch.estimated_duration_minutes !== undefined ? patch.estimated_duration_minutes : step.estimated_duration_minutes,
          required: patch.required !== undefined ? Boolean(patch.required) : step.required,
          related_activity_id: patch.related_activity_id !== undefined ? patch.related_activity_id : step.related_activity_id,
          related_habit_id: patch.related_habit_id !== undefined ? patch.related_habit_id : step.related_habit_id,
          updated_at: now,
        });
        const updatedRoutine = habitRoutineRepository.updateRoutine({ ...r, version: r.version + 1, updated_at: now });
        saveRevisionSnapshot(updatedRoutine, `Paso actualizado: ${updatedStep.name}`);
        return updatedStep;
      });
    },

    removeRoutineStep(stepId) {
      const step = habitRoutineRepository.findRoutineStepById(stepId);
      if (!step) throw new NexusError(ERROR_CODES.NOT_FOUND, `Paso de rutina no encontrado: ${stepId}`);
      const r = habitRoutineRepository.findRoutineById(step.routine_id);
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        // Baja lógica para no alterar ejecuciones históricas (PLN-009)
        habitRoutineRepository.updateRoutineStep({ ...step, status: 'REMOVED', updated_at: now });
        const updatedRoutine = habitRoutineRepository.updateRoutine({ ...r, version: r.version + 1, updated_at: now });
        saveRevisionSnapshot(updatedRoutine, `Paso retirado: ${step.name}`);
        return { id: stepId, status: 'REMOVED' };
      });
    },

    reorderRoutineSteps(routineId, orderedStepIds) {
      const r = habitRoutineRepository.findRoutineById(routineId);
      if (!r) throw new NexusError(ERROR_CODES.NOT_FOUND, `Rutina no encontrada: ${routineId}`);
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        orderedStepIds.forEach((stepId, idx) => {
          const step = habitRoutineRepository.findRoutineStepById(stepId);
          if (step && step.routine_id === routineId) {
            habitRoutineRepository.updateRoutineStep({ ...step, step_order: idx + 1, updated_at: now });
          }
        });
        const updatedRoutine = habitRoutineRepository.updateRoutine({ ...r, version: r.version + 1, updated_at: now });
        saveRevisionSnapshot(updatedRoutine, 'Reordenamiento de pasos');
        return habitRoutineRepository.listRoutineSteps(routineId);
      });
    },

    startRoutineExecution(routineId, { scheduled_date = todayDate(), notes = '' } = {}) {
      const routine = this.getRoutine(routineId);
      if (routine.status !== 'ACTIVE') {
        throw new NexusError(ERROR_CODES.CONFLICT, `No se puede ejecutar una rutina en estado ${routine.status}.`);
      }
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        // Guarda snapshot inmutable de los pasos vigentes en el momento de la ejecución (NL-MASTER-02 §6.13)
        const exec = habitRoutineRepository.insertRoutineExecution({
          id: randomUUID(),
          routine_id: routine.id,
          routine_version: routine.version,
          scheduled_date,
          started_at: now,
          completed_at: null,
          status: 'IN_PROGRESS',
          steps_snapshot: routine.steps,
          notes: notes.trim(),
        });
        const stepExecs = routine.steps.map(s => habitRoutineRepository.insertRoutineStepExecution({
          id: randomUUID(),
          routine_execution_id: exec.id,
          routine_step_id: s.id,
          step_name: s.name,
          step_order: s.step_order,
          required: s.required,
          started_at: null,
          completed_at: null,
          status: 'PENDING',
          notes: '',
        }));
        return { ...exec, step_executions: stepExecs };
      });
    },

    updateRoutineStepExecution(executionId, stepId, { status, notes = null }) {
      validateRoutineStepExecutionStatus(status);
      const exec = habitRoutineRepository.findRoutineExecutionById(executionId);
      if (!exec) throw new NexusError(ERROR_CODES.NOT_FOUND, `Ejecución de rutina no encontrada: ${executionId}`);
      const steps = habitRoutineRepository.listRoutineStepExecutions(executionId);
      const target = steps.find(s => s.routine_step_id === stepId || s.id === stepId);
      if (!target) throw new NexusError(ERROR_CODES.NOT_FOUND, `Paso no encontrado en ejecución ${executionId}`);

      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        const updatedStep = habitRoutineRepository.updateRoutineStepExecution({
          ...target,
          started_at: target.started_at ?? now,
          completed_at: ['COMPLETED', 'PARTIAL', 'SKIPPED', 'MISSED'].includes(status) ? now : null,
          status,
          notes: notes !== null ? notes : target.notes,
        });

        // Coordinación atómica con HabitService mediante contrato (INV-010: nunca SQL cruzado)
        const snapshotStep = exec.steps_snapshot.find(s => s.id === target.routine_step_id);
        if (snapshotStep?.related_habit_id && habitService && ['COMPLETED', 'PARTIAL', 'SKIPPED'].includes(status)) {
          habitService.recordHabitOccurrence(snapshotStep.related_habit_id, {
            scheduled_date: exec.scheduled_date,
            status,
            notes: `Registrado desde ejecución de rutina ${exec.id}`,
            source_id: 'SYSTEM',
          });
        }

        return updatedStep;
      });
    },

    completeRoutineExecution(executionId, { notes = null } = {}) {
      const exec = habitRoutineRepository.findRoutineExecutionById(executionId);
      if (!exec) throw new NexusError(ERROR_CODES.NOT_FOUND, `Ejecución de rutina no encontrada: ${executionId}`);
      const steps = habitRoutineRepository.listRoutineStepExecutions(executionId);
      const requiredSteps = steps.filter(s => s.required);
      const allRequiredCompleted = requiredSteps.every(s => s.status === 'COMPLETED');
      const anyProgress = steps.some(s => s.status === 'COMPLETED' || s.status === 'PARTIAL');
      // NL-MASTER-02 §6.12: Una ejecución incompleta no debe marcarse COMPLETED; pasos opcionales pueden omitirse
      const nextStatus = allRequiredCompleted && (requiredSteps.length > 0 || anyProgress) ? 'COMPLETED' : 'PARTIAL';

      const updated = habitRoutineRepository.updateRoutineExecution({
        ...exec,
        completed_at: nowIso(),
        status: nextStatus,
        notes: notes !== null ? notes : exec.notes,
      });
      return { ...updated, step_executions: steps };
    },

    interruptRoutineExecution(executionId, { notes = '' } = {}) {
      const exec = habitRoutineRepository.findRoutineExecutionById(executionId);
      if (!exec) throw new NexusError(ERROR_CODES.NOT_FOUND, `Ejecución de rutina no encontrada: ${executionId}`);
      return habitRoutineRepository.updateRoutineExecution({
        ...exec,
        completed_at: nowIso(),
        status: 'INTERRUPTED',
        notes: notes || exec.notes,
      });
    },

    getRoutineExecution(executionId) {
      const exec = habitRoutineRepository.findRoutineExecutionById(executionId);
      if (!exec) throw new NexusError(ERROR_CODES.NOT_FOUND, `Ejecución de rutina no encontrada: ${executionId}`);
      return { ...exec, step_executions: habitRoutineRepository.listRoutineStepExecutions(executionId) };
    },

    listRoutineExecutions(filters = {}) {
      return habitRoutineRepository.listRoutineExecutions(filters);
    },

    getRoutineHistory(routineId) {
      this.getRoutine(routineId);
      return {
        revisions: habitRoutineRepository.listRoutineRevisions(routineId),
        executions: habitRoutineRepository.listRoutineExecutions({ routine_id: routineId }),
      };
    },
  };
}
