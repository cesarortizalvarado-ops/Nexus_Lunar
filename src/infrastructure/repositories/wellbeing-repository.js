function hydrateMood(row) {
  if (!row) return null;
  let triggers = [];
  if (row.triggers_json) {
    try {
      triggers = JSON.parse(row.triggers_json);
    } catch {
      triggers = [];
    }
  }
  return {
    ...row,
    triggers: Array.isArray(triggers) ? triggers : [],
  };
}

export function createWellbeingRepository(persistenceService) {
  return {
    upsertMoodEntry(entry) {
      const db = persistenceService.getDatabase();
      const existing = db
        .prepare('SELECT id, created_at FROM mood_entries WHERE entry_date = ?')
        .get(entry.entry_date);
      const triggersJson = JSON.stringify(entry.triggers ?? []);

      if (existing) {
        db.prepare(`
          UPDATE mood_entries
          SET mood_score = ?, energy_level = ?, stress_level = ?, mood_label = ?, triggers_json = ?, notes = ?, updated_at = ?
          WHERE entry_date = ?
        `).run(
          entry.mood_score,
          entry.energy_level,
          entry.stress_level,
          entry.mood_label,
          triggersJson,
          entry.notes ?? '',
          entry.updated_at,
          entry.entry_date
        );
        return this.findMoodByDate(entry.entry_date);
      }

      db.prepare(`
        INSERT INTO mood_entries (
          id, entry_date, mood_score, energy_level, stress_level, mood_label, triggers_json, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id,
        entry.entry_date,
        entry.mood_score,
        entry.energy_level,
        entry.stress_level,
        entry.mood_label,
        triggersJson,
        entry.notes ?? '',
        entry.created_at,
        entry.updated_at
      );
      return this.findMoodByDate(entry.entry_date);
    },

    findMoodByDate(entryDate) {
      const row = persistenceService
        .getReadDatabase()
        .prepare('SELECT * FROM mood_entries WHERE entry_date = ?')
        .get(entryDate);
      return hydrateMood(row ?? null);
    },

    listMoodEntries({ from = null, to = null } = {}) {
      return persistenceService
        .getReadDatabase()
        .prepare(`
          SELECT * FROM mood_entries
          WHERE (? IS NULL OR entry_date >= ?)
            AND (? IS NULL OR entry_date <= ?)
          ORDER BY entry_date ASC
        `)
        .all(from, from, to, to)
        .map(hydrateMood);
    },

    insertImportantDate(item) {
      persistenceService
        .getDatabase()
        .prepare(`
          INSERT INTO important_dates (
            id, title, category, month, day, year, recurrence, related_person, notes, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          item.id,
          item.title,
          item.category,
          item.month,
          item.day,
          item.year ?? null,
          item.recurrence,
          item.related_person ?? null,
          item.notes ?? '',
          item.status,
          item.created_at,
          item.updated_at
        );
      return this.findImportantDateById(item.id);
    },

    updateImportantDate(item) {
      persistenceService
        .getDatabase()
        .prepare(`
          UPDATE important_dates
          SET title = ?, category = ?, month = ?, day = ?, year = ?, recurrence = ?, related_person = ?, notes = ?, status = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          item.title,
          item.category,
          item.month,
          item.day,
          item.year ?? null,
          item.recurrence,
          item.related_person ?? null,
          item.notes ?? '',
          item.status,
          item.updated_at,
          item.id
        );
      return this.findImportantDateById(item.id);
    },

    findImportantDateById(id) {
      return (
        persistenceService
          .getReadDatabase()
          .prepare('SELECT * FROM important_dates WHERE id = ?')
          .get(id) ?? null
      );
    },

    listImportantDates({ month = null, category = null, status = 'ACTIVE' } = {}) {
      const parsedMonth = month !== null && month !== undefined && month !== '' ? Number(month) : null;
      return persistenceService
        .getReadDatabase()
        .prepare(`
          SELECT * FROM important_dates
          WHERE (? IS NULL OR month = ?)
            AND (? IS NULL OR category = ?)
            AND (? IS NULL OR status = ?)
          ORDER BY month ASC, day ASC, title ASC
        `)
        .all(parsedMonth, parsedMonth, category ?? null, category ?? null, status ?? null, status ?? null);
    },
  };
}
