export const migrationV14Planning = {
  version: 14,
  name: 'planning_and_daily_review_domain',
  description: 'Dominio de planificacion determinista: plans, plan_versions, plan_items, planning_proposals, planning_conflicts, daily_reviews',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      plan_type TEXT NOT NULL CHECK(plan_type IN ('WEEKLY','DAILY','PROJECT','CUSTOM')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','SUPERSEDED','COMPLETED','ARCHIVED')),
      current_version_id TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_versions (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
      version_number INTEGER NOT NULL,
      parent_version_id TEXT REFERENCES plan_versions(id) ON DELETE RESTRICT,
      proposal_id TEXT,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(approval_status IN ('DRAFT','APPROVED','REJECTED','SUPERSEDED')),
      change_summary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'PLANNING_ENGINE',
      UNIQUE(plan_id, version_number)
    );
    CREATE INDEX IF NOT EXISTS idx_plan_versions_plan ON plan_versions(plan_id);

    CREATE TABLE IF NOT EXISTS plan_items (
      id TEXT PRIMARY KEY,
      plan_version_id TEXT NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,
      related_entity_type TEXT NOT NULL CHECK(related_entity_type IN ('task','habit','routine','activity','commitment','calendar_event','buffer')),
      related_entity_id TEXT,
      title TEXT NOT NULL,
      planned_start TEXT,
      planned_end TEXT,
      duration_minutes INTEGER,
      priority_tier TEXT NOT NULL DEFAULT 'IMPORTANT' CHECK(priority_tier IN ('ESSENTIAL','IMPORTANT','COMPLEMENTARY','OPTIONAL')),
      flexibility TEXT NOT NULL DEFAULT 'FLEXIBLE' CHECK(flexibility IN ('FIXED','FLEXIBLE','BUFFER','OPTIONAL')),
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','RESCHEDULED','DEFERRED','CANCELLED')),
      explanation TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_plan_items_version ON plan_items(plan_version_id);

    CREATE TABLE IF NOT EXISTS planning_proposals (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
      generated_at TEXT NOT NULL,
      proposal_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(proposal_status IN ('DRAFT','PRESENTED','ACCEPTED','REJECTED','SUPERSEDED')),
      reliable INTEGER NOT NULL DEFAULT 1,
      generation_context_json TEXT NOT NULL DEFAULT '{}',
      proposed_items_json TEXT NOT NULL DEFAULT '[]',
      explanation_json TEXT NOT NULL DEFAULT '{}',
      conflict_summary_json TEXT NOT NULL DEFAULT '[]',
      missing_information_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_proposals_plan ON planning_proposals(plan_id);

    CREATE TABLE IF NOT EXISTS planning_conflicts (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES planning_proposals(id) ON DELETE RESTRICT,
      conflict_type TEXT NOT NULL,
      related_entities_json TEXT NOT NULL DEFAULT '[]',
      severity TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      description TEXT NOT NULL,
      suggested_resolution TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED'))
    );

    CREATE TABLE IF NOT EXISTS daily_reviews (
      id TEXT PRIMARY KEY,
      review_date TEXT NOT NULL UNIQUE,
      planned_summary_json TEXT NOT NULL DEFAULT '[]',
      executed_summary_json TEXT NOT NULL DEFAULT '[]',
      missing_results_json TEXT NOT NULL DEFAULT '[]',
      corrections_json TEXT NOT NULL DEFAULT '[]',
      obstacles_json TEXT NOT NULL DEFAULT '[]',
      context_changes_json TEXT NOT NULL DEFAULT '[]',
      summary_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
  `,
};
