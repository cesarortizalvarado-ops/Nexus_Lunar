import { migrationV08Memory } from './v08-memory.js';
import { migrationV09Personal } from './v09-personal.js';
import { migrationV10TimeExecution } from './v10-time-execution.js';
import { migrationV11FinanceInventory } from './v11-finance-inventory.js';
import { migrationV12Knowledge } from './v12-knowledge.js';
import { migrationV13HabitsRoutines } from './v13-habits-routines.js';
import { migrationV14Planning } from './v14-planning.js';
import { migrationV15Adaptation } from './v15-adaptation.js';
import { migrationV16AIPrepared } from './v16-ai-prepared.js';
import { migrationV17ConsolidateLegacyData } from './v17-consolidate-legacy-data.js';
import { migrationV18SpecializedSpaces } from './v18-specialized-spaces.js';

export const BASE_MIGRATIONS = [
  {
    version: 1,
    name: 'create_records',
    description: 'Esquema legado v1: tabla records',
    reversible: false,
    sql: `
      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('declaration','fact','preference','decision','objective','plan','estimate','inference','hypothesis','event','note')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_records_type ON records(type);
      CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
      CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at);
    `,
  },
  {
    version: 2,
    name: 'create_projects_and_tasks',
    description: 'Esquema legado v2: projects y tasks',
    reversible: false,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','blocked','cancelled')),
        priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
        due_date TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
    `,
  },
  {
    version: 3,
    name: 'create_calendar_events',
    description: 'Esquema legado v3: events',
    reversible: false,
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
        task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'commitment' CHECK(type IN ('commitment','planned_block','reminder')),
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        location TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(end_at > start_at)
      );
      CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
      CREATE INDEX IF NOT EXISTS idx_events_end_at ON events(end_at);
      CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    `,
  },
  {
    version: 4,
    name: 'create_habits',
    description: 'Esquema legado v4: habits y habit_entries',
    reversible: false,
    sql: `
      CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly')),
        weekdays TEXT NOT NULL,
        reminder_time TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS habit_entries (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        entry_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('completed','skipped')),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(habit_id, entry_date)
      );
    `,
  },
  {
    version: 5,
    name: 'create_routines',
    description: 'Esquema legado v5: routines, routine_steps, routine_runs, routine_step_entries',
    reversible: false,
    sql: `
      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly')),
        weekdays TEXT NOT NULL,
        preferred_time TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS routine_steps (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        habit_id TEXT REFERENCES habits(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        duration_minutes INTEGER,
        created_at TEXT NOT NULL,
        UNIQUE(routine_id, position)
      );
      CREATE TABLE IF NOT EXISTS routine_runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        run_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(routine_id, run_date)
      );
      CREATE TABLE IF NOT EXISTS routine_step_entries (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES routine_steps(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','skipped')),
        completed_at TEXT,
        UNIQUE(run_id, step_id)
      );
    `,
  },
  {
    version: 6,
    name: 'track_routine_step_effects',
    description: 'Esquema legado v6: routine_step_effects',
    reversible: false,
    sql: `
      CREATE TABLE IF NOT EXISTS routine_step_effects (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES routine_runs(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES routine_steps(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK(target_type IN ('habit','task')),
        target_id TEXT NOT NULL,
        previous_status TEXT,
        previous_note TEXT,
        applied_status TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        UNIQUE(run_id, step_id, target_type)
      );
    `,
  },
  {
    version: 7,
    name: 'core_transversal_tables',
    description: 'Tablas transversales NL-MASTER-02 y NL-MASTER-05: modulos, eventos, auditoria, relaciones, idempotencia, archivos, seguridad y respaldos',
    reversible: false,
    sql: `
      CREATE TABLE IF NOT EXISTS system_modules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('AVAILABLE','DISABLED','PREPARING','DEGRADED','ERROR')),
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        configuration_json TEXT NOT NULL DEFAULT '{}',
        optional INTEGER NOT NULL DEFAULT 0,
        registered_at TEXT NOT NULL,
        activated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS system_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        source TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        correlation_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_system_events_type ON system_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_system_events_occurred ON system_events(occurred_at);

      CREATE TABLE IF NOT EXISTS audit_records (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        previous_state_json TEXT,
        new_state_json TEXT,
        occurred_at TEXT NOT NULL,
        source_id TEXT NOT NULL,
        reason TEXT,
        outcome TEXT NOT NULL DEFAULT 'SUCCESS',
        correlation_id TEXT,
        is_security_event INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_records(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_records(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_audit_security ON audit_records(is_security_event);

      CREATE TABLE IF NOT EXISTS domain_relations (
        id TEXT PRIMARY KEY,
        source_entity_type TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_type TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        source_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RETIRED'))
      );
      CREATE INDEX IF NOT EXISTS idx_domain_relations_source ON domain_relations(source_entity_type, source_entity_id);
      CREATE INDEX IF NOT EXISTS idx_domain_relations_target ON domain_relations(target_entity_type, target_entity_id);
      CREATE INDEX IF NOT EXISTS idx_domain_relations_type ON domain_relations(relation_type);

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        operation_type TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stored_files (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        internal_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        source_id TEXT,
        location TEXT NOT NULL,
        is_temporary INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED','DELETED')),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS backup_history (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        location TEXT NOT NULL,
        reason TEXT NOT NULL,
        app_version TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS restore_history (
        id TEXT PRIMARY KEY,
        backup_id TEXT NOT NULL,
        backup_file TEXT NOT NULL,
        pre_restore_backup_id TEXT,
        authorized_by TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('COMPLETED','FAILED','ROLLED_BACK')),
        error_message TEXT,
        executed_at TEXT NOT NULL
      );
    `,
  },
];

export function getAllMigrations(extraMigrations = []) {
  return [...BASE_MIGRATIONS, migrationV08Memory, migrationV09Personal, migrationV10TimeExecution, migrationV11FinanceInventory, migrationV12Knowledge, migrationV13HabitsRoutines, migrationV14Planning, migrationV15Adaptation, migrationV16AIPrepared, migrationV17ConsolidateLegacyData, migrationV18SpecializedSpaces, ...extraMigrations].sort((a, b) => a.version - b.version);
}
