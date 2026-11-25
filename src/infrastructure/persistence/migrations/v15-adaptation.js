export const migrationV15Adaptation = {
  version: 15,
  name: 'adaptation_and_proactivity_domain',
  description: 'Analisis adaptativo y proactividad: adaptation_observations, adaptation_suggestions, proactive_interventions, proactivity_config',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS adaptation_observations (
      id TEXT PRIMARY KEY,
      observation_type TEXT NOT NULL,
      related_entity_type TEXT,
      related_entity_id TEXT,
      description TEXT NOT NULL,
      evidence_references_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL,
      observed_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK(status IN ('CANDIDATE','CONFIRMED','REJECTED','EXPIRED'))
    );

    CREATE TABLE IF NOT EXISTS adaptation_suggestions (
      id TEXT PRIMARY KEY,
      observation_id TEXT NOT NULL REFERENCES adaptation_observations(id) ON DELETE RESTRICT,
      suggestion_type TEXT NOT NULL,
      proposed_change_json TEXT NOT NULL DEFAULT '{}',
      explanation_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','ACCEPTED','REJECTED','EXPIRED','APPLIED'))
    );

    CREATE TABLE IF NOT EXISTS proactive_interventions (
      id TEXT PRIMARY KEY,
      dedup_key TEXT NOT NULL,
      classification TEXT NOT NULL CHECK(classification IN ('INFO','RECOMMENDATION','WARNING','CONFLICT','PENDING_DECISION','URGENT')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      suggested_action TEXT,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DELIVERED','DISMISSED','RESOLVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_proact_dedup ON proactive_interventions(dedup_key, status);

    CREATE TABLE IF NOT EXISTS proactivity_config (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      max_daily_interactions INTEGER NOT NULL DEFAULT 3,
      minimum_classification TEXT NOT NULL DEFAULT 'RECOMMENDATION',
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO proactivity_config (id, enabled, max_daily_interactions, minimum_classification, updated_at)
    VALUES ('default', 1, 3, 'RECOMMENDATION', '2026-01-01T00:00:00.000Z');
  `,
};
