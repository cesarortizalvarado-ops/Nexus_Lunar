export const migrationV10TimeExecution = {
  version: 10,
  name: 'time_and_execution_domains',
  description: 'Dominios de tiempo y ejecucion: calendar_events, commitments, availability_windows, time_blocks, executions, work_sessions, outcomes, observations',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT 'EVENT',
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      location TEXT,
      status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','CONFIRMED','CANCELLED','COMPLETED')),
      source_id TEXT,
      related_entity_type TEXT,
      related_entity_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(end_at > start_at)
    );
    CREATE INDEX IF NOT EXISTS idx_cal_events_range ON calendar_events(start_at, end_at);
    CREATE INDEX IF NOT EXISTS idx_cal_events_status ON calendar_events(status);

    CREATE TABLE IF NOT EXISTS commitments (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      commitment_type TEXT NOT NULL DEFAULT 'OBLIGATION',
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CONFIRMED','COMPLETED','CANCELLED')),
      importance INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
      source_id TEXT,
      related_entity_type TEXT,
      related_entity_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments(due_at);

    CREATE TABLE IF NOT EXISTS availability_windows (
      id TEXT PRIMARY KEY,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      availability_type TEXT NOT NULL CHECK(availability_type IN ('CONFIRMED','POTENTIAL','RESERVED','UNAVAILABLE','UNKNOWN')),
      confidence REAL,
      source_id TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(end_at > start_at)
    );
    CREATE INDEX IF NOT EXISTS idx_avail_range ON availability_windows(start_at, end_at);

    CREATE TABLE IF NOT EXISTS time_blocks (
      id TEXT PRIMARY KEY,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      block_type TEXT NOT NULL DEFAULT 'FLEXIBLE' CHECK(block_type IN ('FIXED','FLEXIBLE','BUFFER','OPTIONAL')),
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','ACTIVE','COMPLETED','MOVED','REMOVED')),
      related_entity_type TEXT,
      related_entity_id TEXT,
      plan_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(end_at > start_at)
    );
    CREATE INDEX IF NOT EXISTS idx_timeblocks_range ON time_blocks(start_at, end_at);

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      related_entity_type TEXT NOT NULL,
      related_entity_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      execution_status TEXT NOT NULL CHECK(execution_status IN ('STARTED','PAUSED','COMPLETED','INTERRUPTED','CANCELLED')),
      source_id TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exec_entity ON executions(related_entity_type, related_entity_id);

    CREATE TABLE IF NOT EXISTS work_sessions (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      paused_at TEXT,
      duration_minutes INTEGER,
      pause_duration_minutes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','ENDED')),
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_exec ON work_sessions(execution_id);

    CREATE TABLE IF NOT EXISTS outcomes (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
      outcome_type TEXT NOT NULL CHECK(outcome_type IN ('SUCCESS','PARTIAL','DIFFERENT','FAILED','UNKNOWN')),
      description TEXT NOT NULL DEFAULT '',
      achieved_at TEXT NOT NULL,
      evidence_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outcomes_exec ON outcomes(execution_id);

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      related_entity_type TEXT NOT NULL,
      related_entity_id TEXT NOT NULL,
      content TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      source_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_obs_entity ON observations(related_entity_type, related_entity_id);
  `,
};
