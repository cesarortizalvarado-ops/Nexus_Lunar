import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { validateActivityInput } from '../../domain/personal/personal-validators.js';

export function createActivityService({ personalRepository, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createActivity(input) {
      validateActivityInput(input, false);
      const now = nowIso();
      const activity = {
        id: randomUUID(),
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        category: (input.category ?? 'general').trim(),
        expected_duration_minutes: input.expected_duration_minutes ?? null,
        status: input.status ?? 'ACTIVE',
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      personalRepository.insertActivity(activity);
      auditService?.recordChange({ entity_type: 'activity', entity_id: activity.id, operation_type: 'activity.create', new_state: activity });
      return activity;
    },

    getActivity(id) {
      const a = personalRepository.findActivityById(id);
      if (!a) throw new NexusError(ERROR_CODES.NOT_FOUND, `Actividad no encontrada: ${id}`, { entity: 'Activity' });
      return a;
    },

    listActivities(filters = {}) {
      return personalRepository.listActivities(filters);
    },

    updateActivity(id, patch) {
      const current = personalRepository.findActivityById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Actividad no encontrada: ${id}`, { entity: 'Activity' });
      validateActivityInput(patch, true);
      const now = nowIso();
      const nextStatus = patch.status ?? current.status;
      const updated = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        category: patch.category !== undefined ? patch.category.trim() : current.category,
        expected_duration_minutes: patch.expected_duration_minutes !== undefined ? patch.expected_duration_minutes : current.expected_duration_minutes,
        status: nextStatus,
        updated_at: now,
        archived_at: nextStatus === 'ARCHIVED' ? (current.archived_at ?? now) : current.archived_at,
      };
      personalRepository.updateActivity(updated);
      return updated;
    },

    changeActivityStatus(id, status) {
      return this.updateActivity(id, { status });
    },

    relateGoal(activityId, goalId) {
      if (!personalRepository.findActivityById(activityId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Actividad no encontrada: ${activityId}`);
      if (!personalRepository.findGoalById(goalId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Objetivo no encontrado: ${goalId}`);
      personalRepository.linkGoalActivity(goalId, activityId, nowIso());
      return { activity_id: activityId, goal_id: goalId, linked: true };
    },

    archiveActivity(id) {
      return this.changeActivityStatus(id, 'ARCHIVED');
    },

    listPriorities() {
      return personalRepository.listPriorities();
    },

    upsertPriority(input) {
      if (!input?.id || !input?.name || !Number.isInteger(Number(input.rank))) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'id, name y rank entero son obligatorios en Priority.');
      }
      return personalRepository.upsertPriority({
        id: input.id,
        name: input.name.trim(),
        rank: Number(input.rank),
        description: (input.description ?? '').trim(),
        configuration: input.configuration ?? {},
      });
    },
  };
}
