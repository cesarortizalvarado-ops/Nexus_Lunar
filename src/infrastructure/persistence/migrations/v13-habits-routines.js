export const migrationV13HabitsRoutines = {
  version: 13,
  name: 'habits_and_routines_domains',
  description: 'Dominios propios de habitos y rutinas con revisiones e historial inmutable sin CASCADE destructivo',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS nl_habits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      purpose TEXT NOT NULL DEFAULT '',
      frequency_json TEXT NOT NULL,
      target TEXT,
      minimum_requirement TEXT,
      preferred_time_window_json TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','COMPLETED','ABANDONED','ARCHIVED')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_nl_habits_status ON nl_habits(status);

    CREATE TABLE IF NOT EXISTS nl_habit_occurrences (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES nl_habits(id) ON DELETE RESTRICT,
      scheduled_date TEXT NOT NULL,
      expected_time_window_json TEXT,
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('COMPLETED','PARTIAL','MISSED','SKIPPED','UNKNOWN')),
      notes TEXT NOT NULL DEFAULT '',
      source_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(habit_id, scheduled_date)
    );
    CREATE INDEX IF NOT EXISTS idx_nl_hab_occ_date ON nl_habit_occurrences(habit_id, scheduled_date);

    CREATE TABLE IF NOT EXISTS nl_habit_revisions (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES nl_habits(id) ON DELETE RESTRICT,
      effective_from TEXT NOT NULL,
      effective_until TEXT,
      previous_configuration_json TEXT NOT NULL,
      new_configuration_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nl_hab_rev ON nl_habit_revisions(habit_id);

    CREATE TABLE IF NOT EXISTS nl_routines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      expected_duration_minutes INTEGER,
      frequency_json TEXT NOT NULL DEFAULT '{"type":"DAILY"}',
      preferred_time_window_json TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','ARCHIVED')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_nl_routines_status ON nl_routines(status);

    CREATE TABLE IF NOT EXISTS nl_routine_steps (
      id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL REFERENCES nl_routines(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      step_order INTEGER NOT NULL,
      estimated_duration_minutes INTEGER,
      required INTEGER NOT NULL DEFAULT 1,
      related_activity_id TEXT,
      related_habit_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REMOVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nl_rsteps_routine ON nl_routine_steps(routine_id, step_order);

    CREATE TABLE IF NOT EXISTS nl_routine_revisions (
      id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL REFERENCES nl_routines(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nl_routine_executions (
      id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL REFERENCES nl_routines(id) ON DELETE RESTRICT,
      routine_version INTEGER NOT NULL,
      scheduled_date TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('STARTED','IN_PROGRESS','PARTIAL','COMPLETED','INTERRUPTED','CANCELLED')),
      steps_snapshot_json TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_nl_rexec_routine ON nl_routine_executions(routine_id, scheduled_date);

    CREATE TABLE IF NOT EXISTS nl_routine_step_executions (
      id TEXT PRIMARY KEY,
      routine_execution_id TEXT NOT NULL REFERENCES nl_routine_executions(id) ON DELETE RESTRICT,
      routine_step_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      required INTEGER NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('PENDING','IN_PROGRESS','COMPLETED','PARTIAL','SKIPPED','MISSED','UNKNOWN')),
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE(routine_execution_id, routine_step_id)
    );
  `,
};
