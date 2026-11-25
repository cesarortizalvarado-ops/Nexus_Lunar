export const migrationV09Personal = {
  version: 9,
  name: 'personal_management_domain',
  description: 'Dominio de gestion personal: priorities, goals, personal_projects, personal_tasks, activities, relaciones N:M y dependencias',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS priorities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      rank INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      configuration_json TEXT NOT NULL DEFAULT '{}'
    );

    INSERT OR IGNORE INTO priorities (id, name, rank, description, configuration_json) VALUES
      ('prio_critical', 'CRITICAL', 1, 'Prioridad crítica', '{"importance":4,"urgency_weight":4}'),
      ('prio_high', 'HIGH', 2, 'Prioridad alta', '{"importance":3,"urgency_weight":3}'),
      ('prio_medium', 'MEDIUM', 3, 'Prioridad media', '{"importance":2,"urgency_weight":2}'),
      ('prio_low', 'LOW', 4, 'Prioridad baja', '{"importance":1,"urgency_weight":1}');

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      desired_outcome TEXT NOT NULL DEFAULT '',
      priority_id TEXT REFERENCES priorities(id) ON DELETE RESTRICT,
      horizon TEXT NOT NULL DEFAULT 'MEDIUM_TERM',
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ON_HOLD','ACHIEVED','PARTIALLY_ACHIEVED','ABANDONED','ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

    CREATE TABLE IF NOT EXISTS goal_outcomes (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
      outcome_summary TEXT NOT NULL,
      evidence_id TEXT,
      source_id TEXT,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personal_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      priority_id TEXT REFERENCES priorities(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'PLANNING' CHECK(status IN ('PLANNING','ACTIVE','PAUSED','BLOCKED','COMPLETED','CANCELLED','ARCHIVED')),
      start_date TEXT,
      target_date TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pprojects_status ON personal_projects(status);

    CREATE TABLE IF NOT EXISTS personal_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES personal_projects(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority_id TEXT REFERENCES priorities(id) ON DELETE RESTRICT,
      urgency INTEGER NOT NULL DEFAULT 2 CHECK(urgency BETWEEN 1 AND 4),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PREPARATION','IN_PROGRESS','WAITING','BLOCKED','COMPLETED','CANCELLED','ARCHIVED')),
      estimated_duration_minutes INTEGER,
      actual_duration_minutes INTEGER,
      due_date TEXT,
      planned_start TEXT,
      planned_end TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ptasks_project ON personal_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_ptasks_status ON personal_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_ptasks_due ON personal_tasks(due_date);

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      expected_duration_minutes INTEGER,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED','ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS goal_projects (
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
      project_id TEXT NOT NULL REFERENCES personal_projects(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, project_id)
    );

    CREATE TABLE IF NOT EXISTS goal_tasks (
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
      task_id TEXT NOT NULL REFERENCES personal_tasks(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, task_id)
    );

    CREATE TABLE IF NOT EXISTS goal_activities (
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (goal_id, activity_id)
    );

    CREATE TABLE IF NOT EXISTS entity_dependencies (
      id TEXT PRIMARY KEY,
      origin_entity_type TEXT NOT NULL,
      origin_entity_id TEXT NOT NULL,
      target_entity_type TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      dependency_type TEXT NOT NULL DEFAULT 'REQUIRES',
      condition TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(origin_entity_type, origin_entity_id, target_entity_type, target_entity_id, dependency_type)
    );
    CREATE INDEX IF NOT EXISTS idx_deps_origin ON entity_dependencies(origin_entity_type, origin_entity_id);
    CREATE INDEX IF NOT EXISTS idx_deps_target ON entity_dependencies(target_entity_type, target_entity_id);
  `,
};
