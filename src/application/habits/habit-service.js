import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { addDays } from '../../shared/clock.js';
import {
  validateHabitInput,
  validateHabitFrequency,
  validateHabitOccurrenceInput,
  isHabitScheduledOnDate,
} from '../../domain/habits/habit-validators.js';

export function createHabitService({ habitRoutineRepository, transactionService, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));

  return {
    createHabit(input) {
      validateHabitInput(input, false);
      const now = nowIso();
      const habit = {
        id: randomUUID(),
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        category: (input.category ?? 'general').trim(),
        purpose: (input.purpose ?? '').trim(),
        frequency: input.frequency,
        target: input.target ?? null,
        minimum_requirement: input.minimum_requirement ?? null,
        preferred_time_window: input.preferred_time_window ?? null,
        start_date: input.start_date ?? todayDate(),
        end_date: input.end_date ?? null,
        status: input.status ?? 'ACTIVE',
        version: 1,
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      habitRoutineRepository.insertHabit(habit);
      auditService?.recordChange({ entity_type: 'habit', entity_id: habit.id, operation_type: 'habit.create', new_state: habit });
      return habit;
    },

    getHabit(id) {
      const h = habitRoutineRepository.findHabitById(id);
      if (!h) throw new NexusError(ERROR_CODES.NOT_FOUND, `Hábito no encontrado: ${id}`, { entity: 'Habit' });
      return h;
    },

    listHabits(filters = {}) {
      return habitRoutineRepository.listHabits(filters);
    },

    updateHabit(id, patch, { authorizedBy = null, reason = 'Actualización de hábito' } = {}) {
      const current = this.getHabit(id);
      validateHabitInput(patch, true);
      if (patch.frequency !== undefined) {
        return this.updateHabitFrequency(id, {
          frequency: patch.frequency,
          effective_from: patch.effective_from ?? todayDate(),
          reason,
          authorized_by: authorizedBy,
        });
      }
      const now = nowIso();
      const nextStatus = patch.status ?? current.status;
      const updated = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        category: patch.category !== undefined ? patch.category.trim() : current.category,
        purpose: patch.purpose !== undefined ? patch.purpose.trim() : current.purpose,
        target: patch.target !== undefined ? patch.target : current.target,
        minimum_requirement: patch.minimum_requirement !== undefined ? patch.minimum_requirement : current.minimum_requirement,
        preferred_time_window: patch.preferred_time_window !== undefined ? patch.preferred_time_window : current.preferred_time_window,
        end_date: patch.end_date !== undefined ? patch.end_date : current.end_date,
        status: nextStatus,
        version: current.version + 1,
        updated_at: now,
        archived_at: nextStatus === 'ARCHIVED' ? (current.archived_at ?? now) : current.archived_at,
      };
      habitRoutineRepository.updateHabit(updated);
      auditService?.recordChange({ entity_type: 'habit', entity_id: id, operation_type: 'habit.update', previous_state: current, new_state: updated, reason });
      return updated;
    },

    changeHabitStatus(id, status) { return this.updateHabit(id, { status }); },
    pauseHabit(id) { return this.changeHabitStatus(id, 'PAUSED'); },
    resumeHabit(id) { return this.changeHabitStatus(id, 'ACTIVE'); },
    archiveHabit(id) { return this.changeHabitStatus(id, 'ARCHIVED'); },

    createHabitRevision(id, { previous_configuration, new_configuration, effective_from, effective_until = null, reason, authorized_by }) {
      if (!authorized_by) {
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'PLN-011: Los cambios persistentes de configuración de un hábito requieren autorización del usuario.');
      }
      return habitRoutineRepository.insertHabitRevision({
        id: randomUUID(),
        habit_id: id,
        effective_from,
        effective_until,
        previous_configuration,
        new_configuration,
        reason,
        authorized_by,
        created_at: nowIso(),
      });
    },

    updateHabitFrequency(id, { frequency, effective_from = todayDate(), reason = 'Cambio de frecuencia autorizado', authorized_by = null } = {}) {
      const current = this.getHabit(id);
      validateHabitFrequency(frequency);
      if (!authorized_by) {
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'PLN-011: Cambiar la frecuencia de un hábito requiere autorización explícita del usuario (authorized_by).');
      }
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        const prevConfig = { frequency: current.frequency, target: current.target, minimum_requirement: current.minimum_requirement };
        const newConfig = { frequency, target: current.target, minimum_requirement: current.minimum_requirement };
        // Nunca modifica ocurrencias históricas anteriores a effective_from
        this.createHabitRevision(id, {
          previous_configuration: prevConfig,
          new_configuration: newConfig,
          effective_from,
          reason,
          authorized_by,
        });
        const updated = { ...current, frequency, version: current.version + 1, updated_at: now };
        habitRoutineRepository.updateHabit(updated);
        auditService?.recordChange({
          entity_type: 'habit',
          entity_id: id,
          operation_type: 'habit.frequency_change',
          previous_state: prevConfig,
          new_state: newConfig,
          source_id: authorized_by,
          reason,
        });
        return updated;
      });
    },

    recordHabitOccurrence(habitId, input) {
      const h = this.getHabit(habitId);
      validateHabitOccurrenceInput(input);
      const now = nowIso();
      const occ = {
        id: randomUUID(),
        habit_id: h.id,
        scheduled_date: input.scheduled_date,
        expected_time_window: input.expected_time_window ?? h.preferred_time_window ?? null,
        completed_at: input.status === 'COMPLETED' || input.status === 'PARTIAL' ? (input.completed_at ?? now) : null,
        status: input.status,
        notes: (input.notes ?? '').trim(),
        source_id: input.source_id ?? 'USER',
        version: 1,
        created_at: now,
        updated_at: now,
      };
      return habitRoutineRepository.upsertHabitOccurrence(occ);
    },

    correctHabitOccurrence(habitId, scheduledDateOrOpts, maybeOpts = null) {
      const opts = typeof scheduledDateOrOpts === 'object' && scheduledDateOrOpts !== null
        ? scheduledDateOrOpts
        : { ...(maybeOpts ?? {}), scheduled_date: scheduledDateOrOpts };
      const scheduledDate = opts.scheduled_date;
      const { status, notes, reason, source_id = 'USER' } = opts;
      if (!reason || !reason.trim()) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'reason es obligatorio para corregir una ocurrencia de hábito.');
      }
      return transactionService.executeAtomicOperation(() => {
        const existing = habitRoutineRepository.findHabitOccurrence(habitId, scheduledDate);
        const updated = this.recordHabitOccurrence(habitId, {
          scheduled_date: scheduledDate,
          status,
          notes: notes ?? existing?.notes ?? '',
          source_id,
        });
        auditService?.recordChange({
          entity_type: 'habit_occurrence',
          entity_id: updated.id,
          operation_type: 'habit.occurrence_correct',
          previous_state: existing,
          new_state: updated,
          source_id,
          reason,
        });
        return updated;
      });
    },

    getHabitOccurrences(habitId, { from = null, to = null, fillUnknown = true } = {}) {
      const h = this.getHabit(habitId);
      const recorded = habitRoutineRepository.listHabitOccurrences(habitId, { from, to });
      if (!fillUnknown || !from || !to) return recorded;

      const tz = clock?.timezone ?? 'UTC';
      const revisions = habitRoutineRepository.listHabitRevisions(habitId)
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from));

      function frequencyForDate(dateStr) {
        let freq = h.frequency;
        for (const rev of revisions) {
          if (dateStr < rev.effective_from && rev.previous_configuration?.frequency) {
            return rev.previous_configuration.frequency;
          }
          if (dateStr >= rev.effective_from && (!rev.effective_until || dateStr <= rev.effective_until) && rev.new_configuration?.frequency) {
            freq = rev.new_configuration.frequency;
          }
        }
        return freq;
      }

      // PLN-010: Ausencia de registro equivale a UNKNOWN, nunca a MISSED
      const byDate = new Map(recorded.map(o => [o.scheduled_date, o]));
      const result = [];
      let cursor = from;
      while (cursor <= to) {
        if (byDate.has(cursor)) {
          result.push(byDate.get(cursor));
        } else if ((!h.end_date || cursor <= h.end_date) && isHabitScheduledOnDate(frequencyForDate(cursor), cursor, h.start_date, tz)) {
          result.push({
            id: null,
            habit_id: habitId,
            scheduled_date: cursor,
            status: 'UNKNOWN',
            notes: '',
            unrecorded: true,
          });
        }
        cursor = addDays(cursor, 1);
      }
      return result;
    },

    getHabitHistory(habitId) {
      this.getHabit(habitId);
      return {
        revisions: habitRoutineRepository.listHabitRevisions(habitId),
        occurrences: habitRoutineRepository.listHabitOccurrences(habitId),
      };
    },

    calculateHabitStatistics(habitId, { from = addDays(todayDate(), -30), to = todayDate() } = {}) {
      const occs = this.getHabitOccurrences(habitId, { from, to, fillUnknown: true });
      const counts = { COMPLETED: 0, PARTIAL: 0, MISSED: 0, SKIPPED: 0, UNKNOWN: 0 };
      for (const o of occs) counts[o.status] = (counts[o.status] ?? 0) + 1;
      const known = counts.COMPLETED + counts.PARTIAL + counts.MISSED + counts.SKIPPED;
      return {
        habit_id: habitId,
        period: { from, to },
        total_scheduled: occs.length,
        counts,
        known_occurrences: known,
        completion_rate_of_known: known > 0 ? Number(((counts.COMPLETED + counts.PARTIAL * 0.5) / known).toFixed(4)) : null,
      };
    },
  };
}
