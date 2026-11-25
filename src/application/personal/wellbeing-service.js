import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import {
  validateImportantDateInput,
  validateMoodEntryInput,
} from '../../domain/personal/wellbeing-validators.js';

export function createWellbeingService({ wellbeingRepository, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));

  return {
    recordMoodEntry(input) {
      const normalized = validateMoodEntryInput(input);
      const entry_date = normalized.entry_date ?? todayDate();
      const existing = wellbeingRepository.findMoodByDate(entry_date);
      const now = nowIso();

      const saved = wellbeingRepository.upsertMoodEntry({
        id: existing?.id ?? randomUUID(),
        entry_date,
        mood_score: normalized.mood_score,
        energy_level: normalized.energy_level,
        stress_level: normalized.stress_level,
        mood_label: normalized.mood_label,
        triggers: normalized.triggers,
        notes: normalized.notes,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });

      auditService?.recordChange({
        entity_type: 'mood_entry',
        entity_id: saved.id,
        operation_type: existing ? 'wellbeing.mood.update' : 'wellbeing.mood.record',
        previous_state: existing,
        new_state: saved,
      });

      return saved;
    },

    listMoodEntries({ from = null, to = null } = {}) {
      return wellbeingRepository.listMoodEntries({ from, to });
    },

    createImportantDate(input) {
      validateImportantDateInput(input, false);
      const now = nowIso();
      const created = wellbeingRepository.insertImportantDate({
        id: randomUUID(),
        title: input.title.trim(),
        category: input.category,
        month: Number(input.month),
        day: Number(input.day),
        year: input.year !== undefined && input.year !== null && input.year !== '' ? Number(input.year) : null,
        recurrence: input.recurrence ?? 'ANNUAL',
        related_person: input.related_person ? String(input.related_person).trim() : null,
        notes: input.notes !== undefined && input.notes !== null ? String(input.notes).trim() : '',
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      });

      auditService?.recordChange({
        entity_type: 'important_date',
        entity_id: created.id,
        operation_type: 'wellbeing.dates.create',
        new_state: created,
      });

      return created;
    },

    updateImportantDate(id, patch) {
      const current = wellbeingRepository.findImportantDateById(id);
      if (!current) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, `Fecha importante no encontrada: ${id}`, {
          entity: 'ImportantDate',
        });
      }
      validateImportantDateInput(patch, true);

      const merged = {
        ...current,
        title: patch.title !== undefined ? patch.title.trim() : current.title,
        category: patch.category !== undefined ? patch.category : current.category,
        month: patch.month !== undefined ? Number(patch.month) : current.month,
        day: patch.day !== undefined ? Number(patch.day) : current.day,
        year:
          patch.year !== undefined
            ? (patch.year === null || patch.year === '' ? null : Number(patch.year))
            : current.year,
        recurrence: patch.recurrence !== undefined ? patch.recurrence : current.recurrence,
        related_person:
          patch.related_person !== undefined
            ? (patch.related_person ? String(patch.related_person).trim() : null)
            : current.related_person,
        notes: patch.notes !== undefined ? String(patch.notes ?? '').trim() : current.notes,
        status: patch.status !== undefined ? patch.status : current.status,
        updated_at: nowIso(),
      };

      // Validar coherencia completa tras el merge (ej. cambio de mes vs día, o ONCE sin año)
      validateImportantDateInput(merged, false);

      const updated = wellbeingRepository.updateImportantDate(merged);
      auditService?.recordChange({
        entity_type: 'important_date',
        entity_id: id,
        operation_type: 'wellbeing.dates.update',
        previous_state: current,
        new_state: updated,
      });

      return updated;
    },

    archiveImportantDate(id) {
      const current = wellbeingRepository.findImportantDateById(id);
      if (!current) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, `Fecha importante no encontrada: ${id}`, {
          entity: 'ImportantDate',
        });
      }
      const updated = wellbeingRepository.updateImportantDate({
        ...current,
        status: 'ARCHIVED',
        updated_at: nowIso(),
      });
      auditService?.recordChange({
        entity_type: 'important_date',
        entity_id: id,
        operation_type: 'wellbeing.dates.archive',
        previous_state: current,
        new_state: updated,
      });
      return updated;
    },

    listImportantDates(filters = {}) {
      return wellbeingRepository.listImportantDates(filters);
    },
  };
}
