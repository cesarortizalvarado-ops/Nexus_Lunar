export const migrationV08Memory = {
  version: 8,
  name: 'memory_personal_domain',
  description: 'Dominio de memoria personal: information_sources, evidences, memory_records, memory_relations, memory_revisions',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS information_sources (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('USER','SYSTEM','IMPORT','CALCULATION','AI_INFERENCE','EXTERNAL_INTEGRATION','CORRECTION')),
      source_reference TEXT,
      description TEXT NOT NULL DEFAULT '',
      recorded_at TEXT NOT NULL,
      reliability REAL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS evidences (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES information_sources(id) ON DELETE RESTRICT,
      evidence_type TEXT NOT NULL,
      reference TEXT,
      description TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      information_type TEXT NOT NULL CHECK(information_type IN (
        'FACT','USER_STATEMENT','PREFERENCE','DECISION','GOAL_REFERENCE','INTENTION',
        'PLAN_REFERENCE','ESTIMATE','INFERENCE','HYPOTHESIS','PREDICTION','UNKNOWN'
      )),
      content TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      confidence REAL,
      source_id TEXT NOT NULL REFERENCES information_sources(id) ON DELETE RESTRICT,
      valid_from TEXT,
      valid_until TEXT,
      recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUPERSEDED','DISPUTED','RETIRED','ARCHIVED')),
      sensitivity TEXT NOT NULL DEFAULT 'PERSONAL' CHECK(sensitivity IN ('PUBLIC','INTERNAL','PERSONAL','SENSITIVE','RESTRICTED')),
      context_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_records(information_type);
    CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_records(status);
    CREATE INDEX IF NOT EXISTS idx_memory_recorded ON memory_records(recorded_at);

    CREATE TABLE IF NOT EXISTS memory_evidences (
      memory_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE RESTRICT,
      evidence_id TEXT NOT NULL REFERENCES evidences(id) ON DELETE RESTRICT,
      attached_at TEXT NOT NULL,
      PRIMARY KEY (memory_record_id, evidence_id)
    );

    CREATE TABLE IF NOT EXISTS memory_relations (
      id TEXT PRIMARY KEY,
      origin_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE RESTRICT,
      target_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE RESTRICT,
      relation_type TEXT NOT NULL CHECK(relation_type IN ('CONFIRMS','CONTRADICTS','UPDATES','COMPLEMENTS','DERIVED_FROM','RELATED_TO')),
      created_at TEXT NOT NULL,
      source_id TEXT REFERENCES information_sources(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_rel_origin ON memory_relations(origin_record_id);
    CREATE INDEX IF NOT EXISTS idx_memory_rel_target ON memory_relations(target_record_id);

    CREATE TABLE IF NOT EXISTS memory_revisions (
      id TEXT PRIMARY KEY,
      memory_record_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE RESTRICT,
      previous_version INTEGER NOT NULL,
      new_version INTEGER NOT NULL,
      previous_snapshot_json TEXT NOT NULL,
      new_snapshot_json TEXT NOT NULL,
      change_type TEXT NOT NULL CHECK(change_type IN ('UPDATE','OUTDATED','CORRECTION_OF_ERROR','PREFERENCE_CHANGED','RETIRED','ARCHIVED')),
      reason TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES information_sources(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_rev_record ON memory_revisions(memory_record_id);
  `,
};
