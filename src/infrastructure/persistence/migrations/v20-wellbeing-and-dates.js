export const migrationV20WellbeingAndDates = {
  version: 20,
  name: 'wellbeing_mood_and_important_dates',
  description: 'Bienestar emocional (mood_entries) y fechas importantes/cumpleaños (important_dates)',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS mood_entries (
      id TEXT PRIMARY KEY,
      entry_date TEXT NOT NULL UNIQUE,
      mood_score INTEGER NOT NULL CHECK(mood_score BETWEEN 1 AND 5),
      energy_level INTEGER NOT NULL CHECK(energy_level BETWEEN 1 AND 5),
      stress_level INTEGER NOT NULL CHECK(stress_level BETWEEN 1 AND 5),
      mood_label TEXT NOT NULL,
      triggers_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mood_entries_date
      ON mood_entries(entry_date);

    CREATE TABLE IF NOT EXISTS important_dates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('birthday', 'anniversary', 'renewal', 'deadline', 'custom')),
      month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
      day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31),
      year INTEGER,
      recurrence TEXT NOT NULL DEFAULT 'ANNUAL' CHECK(recurrence IN ('ANNUAL', 'ONCE')),
      related_person TEXT,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_important_dates_month_day
      ON important_dates(month, day, status);
  `,
};
