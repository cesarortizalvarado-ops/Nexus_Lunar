import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { GOAL_TRANSITIONS, assertTransition, validateGoalInput } from '../../domain/personal/personal-validators.js';

export function createGoalService({ personalRepository, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createGoal(input) {
      validateGoalInput(input, false);
      const now = nowIso();
      const goal = {
        id: randomUUID(),
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        desired_outcome: (input.desired_outcome ?? '').trim(),
        priority_id: input.priority_id ?? 'prio_medium',
        horizon: input.horizon ?? 'MEDIUM_TERM',
        target_date: input.target_date ?? null,
        status: input.status ?? 'ACTIVE',
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      personalRepository.insertGoal(goal);
      auditService?.recordChange({ entity_type: 'goal', entity_id: goal.id, operation_type: 'goal.create', new_state: goal });
      return goal;
    },

    getGoal(id) {
      const g = personalRepository.findGoalById(id);
      if (!g) throw new NexusError(ERROR_CODES.NOT_FOUND, `Objetivo no encontrado: ${id}`, { entity: 'Goal' });
      return {
        ...g,
        projects: personalRepository.listProjectsForGoal(id),
        tasks: personalRepository.listTasksForGoal(id),
        outcomes: personalRepository.listGoalOutcomes(id),
      };
    },

    listGoals(filters = {}) {
      return personalRepository.listGoals(filters);
    },

    updateGoal(id, patch) {
      const current = personalRepository.findGoalById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Objetivo no encontrado: ${id}`, { entity: 'Goal' });
      validateGoalInput(patch, true);
      if (patch.status !== undefined) assertTransition(GOAL_TRANSITIONS, current.status, patch.status, 'Goal');
      const now = nowIso();
      const updated = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        desired_outcome: patch.desired_outcome !== undefined ? patch.desired_outcome.trim() : current.desired_outcome,
        priority_id: patch.priority_id !== undefined ? patch.priority_id : current.priority_id,
        horizon: patch.horizon !== undefined ? patch.horizon : current.horizon,
        target_date: patch.target_date !== undefined ? patch.target_date : current.target_date,
        status: patch.status ?? current.status,
        updated_at: now,
        archived_at: (patch.status ?? current.status) === 'ARCHIVED' ? (current.archived_at ?? now) : current.archived_at,
      };
      personalRepository.updateGoal(updated);
      auditService?.recordChange({ entity_type: 'goal', entity_id: id, operation_type: 'goal.update', previous_state: current, new_state: updated });
      return updated;
    },

    changeGoalStatus(id, status, { reason = null } = {}) {
      const res = this.updateGoal(id, { status });
      if (reason) auditService?.recordChange({ entity_type: 'goal', entity_id: id, operation_type: 'goal.status_change', new_state: { status }, reason });
      return res;
    },

    relateProject(goalId, projectId) {
      if (!personalRepository.findGoalById(goalId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Objetivo no encontrado: ${goalId}`);
      if (!personalRepository.findProjectById(projectId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Proyecto no encontrado: ${projectId}`);
      personalRepository.linkGoalProject(goalId, projectId, nowIso());
      return { goal_id: goalId, project_id: projectId, linked: true };
    },

    relateTask(goalId, taskId) {
      if (!personalRepository.findGoalById(goalId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Objetivo no encontrado: ${goalId}`);
      if (!personalRepository.findTaskById(taskId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Tarea no encontrada: ${taskId}`);
      personalRepository.linkGoalTask(goalId, taskId, nowIso());
      return { goal_id: goalId, task_id: taskId, linked: true };
    },

    recordGoalOutcome(goalId, { outcome_summary, evidence_id = null, source_id = null } = {}) {
      if (!personalRepository.findGoalById(goalId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Objetivo no encontrado: ${goalId}`);
      if (!outcome_summary || !outcome_summary.trim()) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'outcome_summary es obligatorio.', { field: 'outcome_summary' });
      }
      const outcome = {
        id: randomUUID(),
        goal_id: goalId,
        outcome_summary: outcome_summary.trim(),
        evidence_id,
        source_id,
        recorded_at: nowIso(),
      };
      personalRepository.insertGoalOutcome(outcome);
      return outcome;
    },

    archiveGoal(id) {
      return this.changeGoalStatus(id, 'ARCHIVED', { reason: 'Archivado por usuario' });
    },
  };
}
