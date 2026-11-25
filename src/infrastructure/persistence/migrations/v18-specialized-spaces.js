export const migrationV18SpecializedSpaces = {
  version: 18,
  name: 'specialized_spaces_domain',
  description: 'Espacios especializados persistentes: perfil multi-empleo, pagos recurrentes, baselines selladas y ejecucion/revisiones',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS specialized_spaces_profile (
      id TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      biometrics_updated_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS specialized_commitment_payments (
      id TEXT PRIMARY KEY,
      commitment_name TEXT NOT NULL,
      amount REAL NOT NULL,
      period_key TEXT NOT NULL,
      paid_at TEXT NOT NULL,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_specialized_payments_period
      ON specialized_commitment_payments(period_key, commitment_name);

    CREATE TABLE IF NOT EXISTS specialized_weekly_baselines (
      baseline_id TEXT PRIMARY KEY,
      week_start_date TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      integrity_hash TEXT NOT NULL,
      baseline_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS specialized_baseline_executions (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      baseline_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      notes TEXT,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (baseline_id) REFERENCES specialized_weekly_baselines(baseline_id)
    );

    CREATE INDEX IF NOT EXISTS idx_specialized_executions_baseline
      ON specialized_baseline_executions(baseline_id, seq);

    CREATE TABLE IF NOT EXISTS specialized_baseline_revisions (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      baseline_id TEXT NOT NULL,
      original_block_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      new_window_json TEXT,
      reason TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (baseline_id) REFERENCES specialized_weekly_baselines(baseline_id)
    );

    CREATE INDEX IF NOT EXISTS idx_specialized_revisions_baseline
      ON specialized_baseline_revisions(baseline_id, seq);
  `,
};
