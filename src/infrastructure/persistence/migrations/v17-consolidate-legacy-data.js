import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../../shared/errors.js';

const RECORD_TYPE_MAP = Object.freeze({
  declaration: 'USER_STATEMENT',
  fact: 'FACT',
  preference: 'PREFERENCE',
  decision: 'DECISION',
  objective: 'GOAL_REFERENCE',
  plan: 'PLAN_REFERENCE',
  estimate: 'ESTIMATE',
  inference: 'INFERENCE',
  hypothesis: 'HYPOTHESIS',
  event: 'FACT',
  note: 'USER_STATEMENT',
});

const TASK_PRIORITY_MAP = Object.freeze({
  urgent: { priority_id: 'prio_critical', urgency: 4 },
  high: { priority_id: 'prio_high', urgency: 3 },
  normal: { priority_id: 'prio_medium', urgency: 2 },
  low: { priority_id: 'prio_low', urgency: 1 },
});

const TASK_STATUS_MAP = Object.freeze({
  pending: 'PENDING',
  in_progress: 'IN_PROGRESS',
  completed: 'COMPLETED',
  blocked: 'BLOCKED',
  cancelled: 'CANCELLED',
});

const EVENT_STATUS_MAP = Object.freeze({
  scheduled: 'CONFIRMED',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
});

function parseLegacyWeekdays(weekdaysRaw) {
  if (!weekdaysRaw) return [];
  try {
    const parsed = JSON.parse(weekdaysRaw);
    if (Array.isArray(parsed)) return parsed.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  } catch {
    // Fallback CSV
  }
  return String(weekdaysRaw)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
}

function parseLegacyFrequency(frequency, weekdaysRaw) {
  const weekdays = parseLegacyWeekdays(weekdaysRaw);
  if (frequency === 'weekly') {
    return weekdays.length > 0 ? { type: 'SPECIFIC_DAYS', weekdays } : { type: 'WEEKLY', weekday: 1 };
  }
  return { type: 'DAILY' };
}

function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row);
}

export const AUDIT_TABLES_DDL = `
  CREATE TABLE IF NOT EXISTS legacy_migration_runs (
    id TEXT PRIMARY KEY,
    migration_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('COMPLETED','CONFLICT_STOPPED')),
    source_count INTEGER NOT NULL,
    migrated_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL,
    conflict_count INTEGER NOT NULL,
    summary_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS legacy_migration_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES legacy_migration_runs(id) ON DELETE RESTRICT,
    legacy_table TEXT NOT NULL,
    legacy_id TEXT NOT NULL,
    target_table TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('MIGRATED','SKIPPED_EQUIVALENT','CONFLICT')),
    reason TEXT NOT NULL,
    details_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_legacy_mig_items_run ON legacy_migration_items(run_id);
  CREATE INDEX IF NOT EXISTS idx_legacy_mig_items_outcome ON legacy_migration_items(outcome);
`;

export function runConsolidateLegacyData(db, { migrationId = 'manual' } = {}) {
  const startedAt = new Date().toISOString();
  db.exec(AUDIT_TABLES_DDL);

  const items = [];
  const tableStats = {};

  function recordOutcome(legacyTable, legacyId, targetTable, outcome, reason, details = {}) {
    if (!tableStats[legacyTable]) {
      tableStats[legacyTable] = { source: 0, migrated: 0, skipped: 0, conflict: 0 };
    }
    tableStats[legacyTable].source += 1;
    if (outcome === 'MIGRATED') tableStats[legacyTable].migrated += 1;
    else if (outcome === 'SKIPPED_EQUIVALENT') tableStats[legacyTable].skipped += 1;
    else if (outcome === 'CONFLICT') tableStats[legacyTable].conflict += 1;

    items.push({
      id: randomUUID(),
      legacy_table: legacyTable,
      legacy_id: String(legacyId),
      target_table: targetTable,
      outcome,
      reason,
      details,
      recorded_at: new Date().toISOString(),
    });
  }

  db.exec('SAVEPOINT sp_v17_legacy_data');

  try {
    // 1. records -> memory_records (+ information_sources)
    if (tableExists(db, 'records')) {
      const rows = db.prepare('SELECT * FROM records ORDER BY created_at ASC, id ASC').all();
      for (const r of rows) {
        const existing = db.prepare('SELECT * FROM memory_records WHERE id = ?').get(r.id);
        const mappedType = RECORD_TYPE_MAP[r.type] ?? 'UNKNOWN';
        const mappedStatus = r.status === 'archived' ? 'ARCHIVED' : 'ACTIVE';
        if (existing) {
          if (existing.content === r.content && existing.summary === r.title) {
            recordOutcome('records', r.id, 'memory_records', 'SKIPPED_EQUIVALENT', 'Registro ya migrado con contenido equivalente.');
          } else {
            recordOutcome('records', r.id, 'memory_records', 'CONFLICT', 'Colisión de ID en memory_records con contenido divergente.', {
              legacy: { title: r.title, content: r.content, type: r.type },
              target: { summary: existing.summary, content: existing.content, information_type: existing.information_type },
            });
          }
          continue;
        }
        const sourceId = `legacy_src_${r.id}`;
        const existingSrc = db.prepare('SELECT id FROM information_sources WHERE id = ?').get(sourceId);
        if (!existingSrc) {
          db.prepare(`
            INSERT INTO information_sources (id, source_type, source_reference, description, recorded_at, reliability, metadata_json)
            VALUES (?, 'IMPORT', ?, 'Fuente migrada desde tabla histórica records (v1)', ?, NULL, ?)
          `).run(sourceId, r.source ?? 'legacy:v1:records', r.created_at, JSON.stringify({ legacy_table: 'records', legacy_source: r.source ?? null }));
        }
        db.prepare(`
          INSERT INTO memory_records (
            id, information_type, content, summary, confidence, source_id, valid_from, valid_until,
            recorded_at, updated_at, status, sensitivity, context_json, version, archived_at
          ) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, 'PERSONAL', ?, 1, ?)
        `).run(
          r.id,
          mappedType,
          r.content,
          r.title,
          sourceId,
          r.created_at,
          r.updated_at,
          mappedStatus,
          JSON.stringify({ migrated_from: 'records', legacy_type: r.type }),
          mappedStatus === 'ARCHIVED' ? r.updated_at : null
        );
        recordOutcome('records', r.id, 'memory_records', 'MIGRATED', 'Migrado íntegramente con fuente de procedencia.');
      }
    }

    // 2. projects -> personal_projects
    if (tableExists(db, 'projects')) {
      const rows = db.prepare('SELECT * FROM projects ORDER BY created_at ASC, id ASC').all();
      for (const p of rows) {
        const existing = db.prepare('SELECT * FROM personal_projects WHERE id = ?').get(p.id);
        const mappedStatus = p.status === 'completed' ? 'COMPLETED' : (p.status === 'archived' ? 'ARCHIVED' : 'ACTIVE');
        if (existing) {
          if (existing.name === p.title && existing.description === (p.description ?? '')) {
            recordOutcome('projects', p.id, 'personal_projects', 'SKIPPED_EQUIVALENT', 'Proyecto ya migrado con datos equivalentes.');
          } else {
            recordOutcome('projects', p.id, 'personal_projects', 'CONFLICT', 'Colisión de ID en personal_projects con datos distintos.', {
              legacy: { title: p.title, description: p.description },
              target: { name: existing.name, description: existing.description },
            });
          }
          continue;
        }
        db.prepare(`
          INSERT INTO personal_projects (
            id, name, description, purpose, priority_id, status, start_date, target_date, completed_at, created_at, updated_at, archived_at
          ) VALUES (?, ?, ?, '', 'prio_medium', ?, NULL, NULL, ?, ?, ?, ?)
        `).run(
          p.id,
          p.title,
          p.description ?? '',
          mappedStatus,
          mappedStatus === 'COMPLETED' ? p.updated_at : null,
          p.created_at,
          p.updated_at,
          mappedStatus === 'ARCHIVED' ? p.updated_at : null
        );
        recordOutcome('projects', p.id, 'personal_projects', 'MIGRATED', 'Proyecto histórico migrado.');
      }
    }

    // 3. tasks -> personal_tasks
    if (tableExists(db, 'tasks')) {
      const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at ASC, id ASC').all();
      for (const t of rows) {
        if (t.project_id) {
          const parentProj = db.prepare('SELECT id FROM personal_projects WHERE id = ?').get(t.project_id);
          if (!parentProj) {
            recordOutcome('tasks', t.id, 'personal_tasks', 'CONFLICT', `Referencia huérfana: project_id '${t.project_id}' no existe en personal_projects.`, {
              legacy: t,
            });
            continue;
          }
        }
        const existing = db.prepare('SELECT * FROM personal_tasks WHERE id = ?').get(t.id);
        const prioSpec = TASK_PRIORITY_MAP[t.priority] ?? TASK_PRIORITY_MAP.normal;
        const mappedStatus = TASK_STATUS_MAP[t.status] ?? 'PENDING';
        if (existing) {
          if (existing.title === t.title && existing.project_id === (t.project_id ?? null)) {
            recordOutcome('tasks', t.id, 'personal_tasks', 'SKIPPED_EQUIVALENT', 'Tarea ya migrada con datos equivalentes.');
          } else {
            recordOutcome('tasks', t.id, 'personal_tasks', 'CONFLICT', 'Colisión de ID en personal_tasks con datos divergentes.', {
              legacy: { title: t.title, project_id: t.project_id, status: t.status },
              target: { title: existing.title, project_id: existing.project_id, status: existing.status },
            });
          }
          continue;
        }
        db.prepare(`
          INSERT INTO personal_tasks (
            id, project_id, title, description, priority_id, urgency, status,
            estimated_duration_minutes, actual_duration_minutes, due_date, planned_start, planned_end,
            completed_at, created_at, updated_at, archived_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, ?, NULL)
        `).run(
          t.id,
          t.project_id ?? null,
          t.title,
          t.description ?? '',
          prioSpec.priority_id,
          prioSpec.urgency,
          mappedStatus,
          t.due_date ?? null,
          mappedStatus === 'COMPLETED' ? t.updated_at : null,
          t.created_at,
          t.updated_at
        );
        recordOutcome('tasks', t.id, 'personal_tasks', 'MIGRATED', 'Tarea histórica migrada.');
      }
    }

    // 4. events -> calendar_events
    if (tableExists(db, 'events')) {
      const rows = db.prepare('SELECT * FROM events ORDER BY start_at ASC, id ASC').all();
      for (const e of rows) {
        let relType = null;
        let relId = null;
        if (e.task_id) {
          if (!db.prepare('SELECT id FROM personal_tasks WHERE id = ?').get(e.task_id)) {
            recordOutcome('events', e.id, 'calendar_events', 'CONFLICT', `Referencia task_id '${e.task_id}' inexistente en personal_tasks.`, { legacy: e });
            continue;
          }
          relType = 'task';
          relId = e.task_id;
        } else if (e.project_id) {
          if (!db.prepare('SELECT id FROM personal_projects WHERE id = ?').get(e.project_id)) {
            recordOutcome('events', e.id, 'calendar_events', 'CONFLICT', `Referencia project_id '${e.project_id}' inexistente en personal_projects.`, { legacy: e });
            continue;
          }
          relType = 'project';
          relId = e.project_id;
        }
        const existing = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(e.id);
        if (existing) {
          if (existing.title === e.title && existing.start_at === e.start_at && existing.end_at === e.end_at) {
            recordOutcome('events', e.id, 'calendar_events', 'SKIPPED_EQUIVALENT', 'Evento ya migrado con horario y título equivalentes.');
          } else {
            recordOutcome('events', e.id, 'calendar_events', 'CONFLICT', 'Colisión de ID en calendar_events con datos distintos.', {
              legacy: { title: e.title, start_at: e.start_at, end_at: e.end_at },
              target: { title: existing.title, start_at: existing.start_at, end_at: existing.end_at },
            });
          }
          continue;
        }
        const mappedStatus = EVENT_STATUS_MAP[e.status] ?? 'CONFIRMED';
        db.prepare(`
          INSERT INTO calendar_events (
            id, title, description, event_type, start_at, end_at, timezone, location, status,
            source_id, related_entity_type, related_entity_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'UTC', ?, ?, NULL, ?, ?, ?, ?)
        `).run(
          e.id,
          e.title,
          e.description ?? '',
          e.type ? String(e.type).toUpperCase() : 'EVENT',
          e.start_at,
          e.end_at,
          e.location ?? null,
          mappedStatus,
          relType,
          relId,
          e.created_at,
          e.updated_at
        );
        recordOutcome('events', e.id, 'calendar_events', 'MIGRATED', 'Evento histórico migrado.');
      }
    }

    // 5. habits -> nl_habits
    if (tableExists(db, 'habits')) {
      const rows = db.prepare('SELECT * FROM habits ORDER BY created_at ASC, id ASC').all();
      for (const h of rows) {
        const existing = db.prepare('SELECT * FROM nl_habits WHERE id = ?').get(h.id);
        if (existing) {
          if (existing.name === h.title && existing.description === (h.description ?? '')) {
            recordOutcome('habits', h.id, 'nl_habits', 'SKIPPED_EQUIVALENT', 'Hábito ya migrado con datos equivalentes.');
          } else {
            recordOutcome('habits', h.id, 'nl_habits', 'CONFLICT', 'Colisión de ID en nl_habits con datos divergentes.', {
              legacy: { title: h.title, description: h.description },
              target: { name: existing.name, description: existing.description },
            });
          }
          continue;
        }
        const freq = parseLegacyFrequency(h.frequency, h.weekdays);
        const startDate = String(h.created_at).slice(0, 10);
        const mappedStatus = h.status === 'archived' ? 'ARCHIVED' : 'ACTIVE';
        const prefWindow = h.reminder_time ? JSON.stringify({ start: h.reminder_time }) : null;
        db.prepare(`
          INSERT INTO nl_habits (
            id, name, description, category, purpose, frequency_json, target, minimum_requirement,
            preferred_time_window_json, start_date, end_date, status, version, created_at, updated_at, archived_at
          ) VALUES (?, ?, ?, 'general', '', ?, NULL, NULL, ?, ?, NULL, ?, 1, ?, ?, ?)
        `).run(
          h.id,
          h.title,
          h.description ?? '',
          JSON.stringify(freq),
          prefWindow,
          startDate,
          mappedStatus,
          h.created_at,
          h.updated_at,
          mappedStatus === 'ARCHIVED' ? h.updated_at : null
        );
        recordOutcome('habits', h.id, 'nl_habits', 'MIGRATED', 'Hábito histórico migrado como dominio propio.');
      }
    }

    // 6. habit_entries -> nl_habit_occurrences
    if (tableExists(db, 'habit_entries')) {
      const rows = db.prepare('SELECT * FROM habit_entries ORDER BY entry_date ASC, id ASC').all();
      for (const he of rows) {
        if (!db.prepare('SELECT id FROM nl_habits WHERE id = ?').get(he.habit_id)) {
          recordOutcome('habit_entries', he.id, 'nl_habit_occurrences', 'CONFLICT', `Hábito padre '${he.habit_id}' inexistente en nl_habits.`, { legacy: he });
          continue;
        }
        const mappedStatus = he.status === 'completed' ? 'COMPLETED' : 'SKIPPED';
        const byId = db.prepare('SELECT * FROM nl_habit_occurrences WHERE id = ?').get(he.id);
        const byNatural = db.prepare('SELECT * FROM nl_habit_occurrences WHERE habit_id = ? AND scheduled_date = ?').get(he.habit_id, he.entry_date);
        const existing = byId ?? byNatural;
        if (existing) {
          if (existing.habit_id === he.habit_id && existing.scheduled_date === he.entry_date && existing.status === mappedStatus) {
            recordOutcome('habit_entries', he.id, 'nl_habit_occurrences', 'SKIPPED_EQUIVALENT', 'Ocurrencia de hábito ya migrada con igual estado.');
          } else {
            recordOutcome('habit_entries', he.id, 'nl_habit_occurrences', 'CONFLICT', 'Colisión de ID o (habit_id, scheduled_date) con estado divergente.', {
              legacy: he,
              target: existing,
            });
          }
          continue;
        }
        db.prepare(`
          INSERT INTO nl_habit_occurrences (
            id, habit_id, scheduled_date, expected_time_window_json, completed_at, status, notes, source_id, version, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'IMPORT_V17', 1, ?, ?)
        `).run(
          he.id,
          he.habit_id,
          he.entry_date,
          mappedStatus === 'COMPLETED' ? he.updated_at : null,
          mappedStatus,
          he.note ?? '',
          he.created_at,
          he.updated_at
        );
        recordOutcome('habit_entries', he.id, 'nl_habit_occurrences', 'MIGRATED', 'Ocurrencia histórica de hábito migrada.');
      }
    }

    // 7. routines -> nl_routines
    if (tableExists(db, 'routines')) {
      const rows = db.prepare('SELECT * FROM routines ORDER BY created_at ASC, id ASC').all();
      for (const r of rows) {
        const existing = db.prepare('SELECT * FROM nl_routines WHERE id = ?').get(r.id);
        if (existing) {
          if (existing.name === r.title && existing.description === (r.description ?? '')) {
            recordOutcome('routines', r.id, 'nl_routines', 'SKIPPED_EQUIVALENT', 'Rutina ya migrada con datos equivalentes.');
          } else {
            recordOutcome('routines', r.id, 'nl_routines', 'CONFLICT', 'Colisión de ID en nl_routines con datos divergentes.', {
              legacy: { title: r.title, description: r.description },
              target: { name: existing.name, description: existing.description },
            });
          }
          continue;
        }
        const freq = parseLegacyFrequency(r.frequency, r.weekdays);
        const mappedStatus = r.status === 'archived' ? 'ARCHIVED' : 'ACTIVE';
        const prefWindow = r.preferred_time ? JSON.stringify({ start: r.preferred_time }) : null;
        db.prepare(`
          INSERT INTO nl_routines (
            id, name, description, category, expected_duration_minutes, frequency_json,
            preferred_time_window_json, status, version, created_at, updated_at, archived_at
          ) VALUES (?, ?, ?, 'general', NULL, ?, ?, ?, 1, ?, ?, ?)
        `).run(
          r.id,
          r.title,
          r.description ?? '',
          JSON.stringify(freq),
          prefWindow,
          mappedStatus,
          r.created_at,
          r.updated_at,
          mappedStatus === 'ARCHIVED' ? r.updated_at : null
        );
        recordOutcome('routines', r.id, 'nl_routines', 'MIGRATED', 'Rutina histórica migrada como dominio propio.');
      }
    }

    // 8. routine_steps -> nl_routine_steps
    if (tableExists(db, 'routine_steps')) {
      const rows = db.prepare('SELECT * FROM routine_steps ORDER BY routine_id ASC, position ASC, id ASC').all();
      for (const s of rows) {
        if (!db.prepare('SELECT id FROM nl_routines WHERE id = ?').get(s.routine_id)) {
          recordOutcome('routine_steps', s.id, 'nl_routine_steps', 'CONFLICT', `Rutina padre '${s.routine_id}' inexistente en nl_routines.`, { legacy: s });
          continue;
        }
        if (s.habit_id && !db.prepare('SELECT id FROM nl_habits WHERE id = ?').get(s.habit_id)) {
          recordOutcome('routine_steps', s.id, 'nl_routine_steps', 'CONFLICT', `Hábito referenciado '${s.habit_id}' inexistente en nl_habits.`, { legacy: s });
          continue;
        }
        const existing = db.prepare('SELECT * FROM nl_routine_steps WHERE id = ?').get(s.id);
        if (existing) {
          if (existing.routine_id === s.routine_id && existing.name === s.title && existing.step_order === s.position) {
            recordOutcome('routine_steps', s.id, 'nl_routine_steps', 'SKIPPED_EQUIVALENT', 'Paso de rutina ya migrado con datos equivalentes.');
          } else {
            recordOutcome('routine_steps', s.id, 'nl_routine_steps', 'CONFLICT', 'Colisión de ID en nl_routine_steps con datos distintos.', {
              legacy: s,
              target: existing,
            });
          }
          continue;
        }
        db.prepare(`
          INSERT INTO nl_routine_steps (
            id, routine_id, name, description, step_order, estimated_duration_minutes, required,
            related_activity_id, related_habit_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?, 'ACTIVE', ?, ?)
        `).run(
          s.id,
          s.routine_id,
          s.title,
          s.description ?? '',
          s.position,
          s.duration_minutes ?? null,
          s.habit_id ?? null,
          s.created_at,
          s.created_at
        );
        recordOutcome('routine_steps', s.id, 'nl_routine_steps', 'MIGRATED', 'Paso de rutina histórico migrado.');
      }
    }

    // 9. routine_runs & routine_step_entries -> nl_routine_executions & nl_routine_step_executions
    if (tableExists(db, 'routine_runs')) {
      const runs = db.prepare('SELECT * FROM routine_runs ORDER BY started_at ASC, id ASC').all();
      for (const run of runs) {
        if (!db.prepare('SELECT id FROM nl_routines WHERE id = ?').get(run.routine_id)) {
          recordOutcome('routine_runs', run.id, 'nl_routine_executions', 'CONFLICT', `Rutina '${run.routine_id}' inexistente en nl_routines.`, { legacy: run });
          continue;
        }
        const existing = db.prepare('SELECT * FROM nl_routine_executions WHERE id = ?').get(run.id);
        const mappedStatus = run.status === 'completed' ? 'COMPLETED' : 'IN_PROGRESS';
        if (existing) {
          if (existing.routine_id === run.routine_id && existing.scheduled_date === run.run_date) {
            recordOutcome('routine_runs', run.id, 'nl_routine_executions', 'SKIPPED_EQUIVALENT', 'Ejecución histórica de rutina ya migrada.');
          } else {
            recordOutcome('routine_runs', run.id, 'nl_routine_executions', 'CONFLICT', 'Colisión de ID en nl_routine_executions.', {
              legacy: run,
              target: existing,
            });
          }
          continue;
        }
        const stepsSnapshot = db.prepare('SELECT * FROM nl_routine_steps WHERE routine_id = ? ORDER BY step_order ASC').all(run.routine_id);
        db.prepare(`
          INSERT INTO nl_routine_executions (
            id, routine_id, routine_version, scheduled_date, started_at, completed_at, status, steps_snapshot_json, notes
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'Migrado desde routine_runs')
        `).run(
          run.id,
          run.routine_id,
          run.run_date,
          run.started_at,
          run.completed_at ?? null,
          mappedStatus,
          JSON.stringify(stepsSnapshot)
        );
        recordOutcome('routine_runs', run.id, 'nl_routine_executions', 'MIGRATED', 'Ejecución histórica de rutina migrada.');

        if (tableExists(db, 'routine_step_entries')) {
          const entries = db.prepare('SELECT * FROM routine_step_entries WHERE run_id = ? ORDER BY id ASC').all(run.id);
          for (const se of entries) {
            const stepMeta = db.prepare('SELECT * FROM nl_routine_steps WHERE id = ?').get(se.step_id);
            if (!stepMeta) {
              recordOutcome('routine_step_entries', se.id, 'nl_routine_step_executions', 'CONFLICT', `Paso '${se.step_id}' inexistente en nl_routine_steps.`, { legacy: se });
              continue;
            }
            const stepStatus = se.status === 'completed' ? 'COMPLETED' : (se.status === 'skipped' ? 'SKIPPED' : 'PENDING');
            db.prepare(`
              INSERT INTO nl_routine_step_executions (
                id, routine_execution_id, routine_step_id, step_name, step_order, required, started_at, completed_at, status, notes
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
            `).run(
              se.id,
              run.id,
              se.step_id,
              stepMeta.name,
              stepMeta.step_order,
              stepMeta.required,
              run.started_at,
              se.completed_at ?? null,
              stepStatus
            );
            recordOutcome('routine_step_entries', se.id, 'nl_routine_step_executions', 'MIGRATED', ' Ejecución histórica de paso migrada.');
          }
        }
      }
    }

    // Verificación estricta de claves foráneas en SQLite
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
    if (fkViolations.length > 0) {
      for (const v of fkViolations) {
        recordOutcome(v.table, String(v.rowid ?? 'unknown'), v.parent, 'CONFLICT', 'Violación detectada en PRAGMA foreign_key_check.', v);
      }
    }
  } catch (unexpectedErr) {
    db.exec('ROLLBACK TO SAVEPOINT sp_v17_legacy_data');
    db.exec('RELEASE SAVEPOINT sp_v17_legacy_data');
    throw unexpectedErr;
  }

  const counts = items.reduce(
    (acc, it) => {
      acc.source += 1;
      if (it.outcome === 'MIGRATED') acc.migrated += 1;
      else if (it.outcome === 'SKIPPED_EQUIVALENT') acc.skipped += 1;
      else if (it.outcome === 'CONFLICT') acc.conflict += 1;
      return acc;
    },
    { source: 0, migrated: 0, skipped: 0, conflict: 0 }
  );

  if (counts.conflict > 0) {
    // Salvaguarda 7: deshacer cualquier escritura en tablas destino, conservar intactas todas las tablas y persistir evidencia del conflicto
    db.exec('ROLLBACK TO SAVEPOINT sp_v17_legacy_data');
    db.exec('RELEASE SAVEPOINT sp_v17_legacy_data');
  } else {
    db.exec('RELEASE SAVEPOINT sp_v17_legacy_data');
  }

  const runId = randomUUID();
  const completedAt = new Date().toISOString();
  const runStatus = counts.conflict > 0 ? 'CONFLICT_STOPPED' : 'COMPLETED';
  const summary = {
    by_table: tableStats,
    totals: counts,
    effective_migrated_persisted: counts.conflict > 0 ? 0 : counts.migrated,
  };

  db.prepare(`
    INSERT INTO legacy_migration_runs (
      id, migration_id, started_at, completed_at, status,
      source_count, migrated_count, skipped_count, conflict_count, summary_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    migrationId,
    startedAt,
    completedAt,
    runStatus,
    counts.source,
    counts.conflict > 0 ? 0 : counts.migrated,
    counts.skipped,
    counts.conflict,
    JSON.stringify(summary)
  );

  const insertItemStmt = db.prepare(`
    INSERT INTO legacy_migration_items (
      id, run_id, legacy_table, legacy_id, target_table, outcome, reason, details_json, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const it of items) {
    insertItemStmt.run(
      it.id,
      runId,
      it.legacy_table,
      it.legacy_id,
      it.target_table,
      it.outcome,
      it.reason,
      JSON.stringify(it.details),
      it.recorded_at
    );
  }

  if (counts.conflict > 0) {
    const err = new NexusError(
      ERROR_CODES.CONFLICT,
      `DP-02 Salvaguarda 7: Migración v17 detenida de forma segura por ${counts.conflict} conflicto(s) de datos. Ninguna fila fue destruida ni sobrescrita.`,
      {
        entity: 'LegacyMigration',
        details: { run_id: runId, counts, conflicts: items.filter(i => i.outcome === 'CONFLICT') },
        remediation: 'Consulta migrationService.getLegacyMigrationReports() para inspeccionar los registros conflictivos o restaura el respaldo pre-migration.',
      }
    );
    err.preserveEvidence = true;
    throw err;
  }

  return { run_id: runId, status: runStatus, counts, summary };
}

export const migrationV17ConsolidateLegacyData = {
  version: 17,
  name: 'consolidate_legacy_v1_v6_data_audited',
  description: 'Consolidacion no destructiva y auditada de datos historicos v1..v6 hacia v8..v13 con deteccion explicita de conflictos (DP-02)',
  reversible: false,
  sql: AUDIT_TABLES_DDL,
  run(db, ctx) {
    return runConsolidateLegacyData(db, ctx);
  },
};
