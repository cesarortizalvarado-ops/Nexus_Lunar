import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { createConfig } from '../src/config.js';
import { createPersistenceService } from '../src/infrastructure/persistence/persistence-service.js';
import { createBackupService } from '../src/infrastructure/persistence/backup-service.js';
import { createMigrationService } from '../src/infrastructure/persistence/migration-service.js';
import { getAllMigrations } from '../src/infrastructure/persistence/migrations/index.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-b02-test-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('B02.1 — Zona horaria local (America/Mexico_City), delegación Project->Task, reprogramación de eventos y acumulación de duración real', () => {
  const dirs = makeTempDirs();
  // 2026-11-24T04:30:00Z = 2026-11-23 22:30:00 en Ciudad de México (lunes)
  const fixedNow = new Date('2026-11-24T04:30:00.000Z');
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => fixedNow,
  });

  try {
    const habit = core.habitService.createHabit({
      name: 'Lectura técnica nocturna',
      frequency: { type: 'SPECIFIC_DAYS', weekdays: [1] }, // Lunes
    });
    assert.equal(habit.start_date, '2026-11-23', 'Debe usar la fecha civil de America/Mexico_City y no 2026-11-24 UTC');

    const occs = core.habitService.getHabitOccurrences(habit.id, { from: '2026-11-23', to: '2026-11-24' });
    assert.equal(occs.length, 1);
    assert.equal(occs[0].scheduled_date, '2026-11-23');
    assert.equal(occs[0].status, 'UNKNOWN'); // PLN-010

    // ProjectService.relateTask delega en TaskService y deja rastro de auditoría en 'task'
    const project = core.projectService.createProject({ name: 'Consolidación B02', status: 'ACTIVE' });
    const task = core.taskService.createTask({ title: 'Sincronizar sesiones', estimated_duration_minutes: 45 });
    core.projectService.relateTask(project.id, task.id);

    const taskHistory = core.auditService.getEntityHistory('task', task.id);
    assert.equal(taskHistory.length, 2, 'Creación + actualización vía TaskService desde ProjectService.relateTask');

    // WorkSession acumula actual_duration_minutes sin alterar estimated_duration_minutes
    const exec = core.executionService.startExecution({
      related_entity_type: 'task',
      related_entity_id: task.id,
      started_at: '2026-11-24T03:00:00.000Z',
    });
    const s1 = core.workSessionService.startSession({ execution_id: exec.id, started_at: '2026-11-24T03:00:00.000Z' });
    core.workSessionService.endSession(s1.id, { ended_at: '2026-11-24T03:35:00.000Z', pause_duration_minutes: 5 });
    const s2 = core.workSessionService.startSession({ execution_id: exec.id, started_at: '2026-11-24T03:45:00.000Z' });
    core.workSessionService.endSession(s2.id, { ended_at: '2026-11-24T04:10:00.000Z' });

    const updatedTask = core.taskService.getTask(task.id);
    assert.equal(updatedTask.estimated_duration_minutes, 45, 'estimated_duration_minutes no debe sobrescribirse');
    assert.equal(updatedTask.actual_duration_minutes, 55, '30 min + 25 min acumulados exactamente');

    // CalendarService.rescheduleEvent conserva historial y zona horaria
    const createdEv = core.calendarService.createEvent({
      title: 'Revisión técnica',
      start_at: '2026-11-24T15:00:00.000Z',
      end_at: '2026-11-24T16:00:00.000Z',
      related_entity_type: 'project',
      related_entity_id: project.id,
    });
    assert.equal(createdEv.event.timezone, 'America/Mexico_City');
    const resched = core.calendarService.rescheduleEvent(createdEv.event.id, {
      start_at: '2026-11-24T17:00:00.000Z',
      end_at: '2026-11-24T18:00:00.000Z',
      reason: 'Cambio de bloque matutino',
    });
    assert.equal(resched.previous_schedule.start_at, '2026-11-24T15:00:00.000Z');
    assert.equal(resched.event.start_at, '2026-11-24T17:00:00.000Z');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('B02.2 — Integridad referencial polimórfica (DB-002) y atomicidad en Rutinas↔Hábitos, IA y CIO', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  try {
    // Rechazo de referencias polimórficas inexistentes
    assert.throws(
      () => core.calendarService.createEvent({
        title: 'Evento huérfano',
        start_at: '2026-11-24T10:00:00.000Z',
        end_at: '2026-11-24T11:00:00.000Z',
        related_entity_type: 'task',
        related_entity_id: 'no-existe',
      }),
      err => err.code === 'NOT_FOUND'
    );
    assert.throws(
      () => core.executionService.startExecution({ related_entity_type: 'task', related_entity_id: 'no-existe' }),
      err => err.code === 'NOT_FOUND'
    );
    assert.throws(
      () => core.observationService.createObservation({ related_entity_type: 'goal', related_entity_id: 'no-existe', content: 'Nota' }),
      err => err.code === 'NOT_FOUND'
    );

    const acc = core.financialAccountService.createAccount({ name: 'Principal', currency: 'MXN' });
    assert.throws(
      () => core.financialTransactionService.recordExpense({
        account_id: acc.id,
        amount: 120.5,
        related_entity_type: 'project',
        related_entity_id: 'proyecto-fantasma',
      }),
      err => err.code === 'NOT_FOUND'
    );

    // Atomicidad en RoutineService.updateRoutineStepExecution -> HabitService.recordHabitOccurrence
    const routine = core.routineService.createRoutine({
      name: 'Rutina matutina',
      steps: [{ name: 'Paso con hábito roto', related_habit_id: 'habito-eliminado-o-invalido' }],
    });
    const rExec = core.routineService.startRoutineExecution(routine.id, { scheduled_date: '2026-11-24' });
    assert.throws(
      () => core.routineService.updateRoutineStepExecution(rExec.id, rExec.step_executions[0].id, { status: 'COMPLETED' }),
      err => err.code === 'NOT_FOUND'
    );
    const reloadedExec = core.routineService.getRoutineExecution(rExec.id);
    assert.equal(reloadedExec.step_executions[0].status, 'PENDING', 'El paso debe permanecer PENDING tras el ROLLBACK');

    // CIO registra fuente + memoria HYPOTHESIS atómicamente
    const mem = core.cioBridge.receiveExternalSignal({
      external_reference: 'cio://signal/42',
      summary: 'Señal contextual',
      content: 'Posible variación de horario de transporte',
    });
    assert.equal(mem.information_type, 'HYPOTHESIS');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('B02.3 (DP-02) — Migración v6 -> v17 íntegra, no destructiva, con respaldo previo y reporte auditable', () => {
  const dirs = makeTempDirs();
  const cfg = createConfig({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  const persistence = createPersistenceService(cfg);
  persistence.initializeStorage();
  const backupService = createBackupService({ config: cfg, persistenceService: persistence });

  try {
    // 1. Construir una base histórica real en versión v6
    const allMigs = getAllMigrations();
    const migV6Only = createMigrationService({
      persistenceService: persistence,
      backupService,
      migrations: allMigs.filter(m => m.version <= 6),
    });
    migV6Only.executeMigration({ skipPreBackup: true });
    assert.equal(persistence.getSchemaVersion(), 6);

    const db = persistence.getDatabase();
    const ts = '2026-10-01T10:00:00.000Z';
    db.prepare('INSERT INTO records (id, type, title, content, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'rec_legacy_1', 'fact', 'Ciudad de residencia', 'Vive en Querétaro', 'user_note', 'active', ts, ts
    );
    db.prepare('INSERT INTO projects (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'proj_legacy_1', 'Proyecto Histórico v6', 'Descripción legada', 'active', ts, ts
    );
    db.prepare('INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'task_legacy_1', 'proj_legacy_1', 'Tarea heredada urgente', 'Detalle', 'in_progress', 'urgent', '2026-12-01', ts, ts
    );
    db.prepare('INSERT INTO events (id, project_id, task_id, title, description, type, status, start_at, end_at, location, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'ev_legacy_1', 'proj_legacy_1', 'task_legacy_1', 'Cita heredada', '', 'commitment', 'scheduled', '2026-12-01T15:00:00.000Z', '2026-12-01T16:00:00.000Z', 'Oficina', ts, ts
    );
    db.prepare('INSERT INTO habits (id, title, description, frequency, weekdays, reminder_time, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'hab_legacy_1', 'Hidratación', '2L agua', 'daily', '0,1,2,3,4,5,6', '08:00', 'active', ts, ts
    );
    db.prepare('INSERT INTO habit_entries (id, habit_id, entry_date, status, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'he_legacy_1', 'hab_legacy_1', '2026-10-01', 'completed', 'Cumplido', ts, ts
    );
    db.prepare('INSERT INTO routines (id, title, description, frequency, weekdays, preferred_time, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'rou_legacy_1', 'Cierre nocturno', 'Ordenar escritorio', 'daily', '1,2,3,4,5', '21:30', 'active', ts, ts
    );
    db.prepare('INSERT INTO routine_steps (id, routine_id, position, title, description, habit_id, task_id, duration_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'rstep_legacy_1', 'rou_legacy_1', 1, 'Revisar agua', '', 'hab_legacy_1', null, 5, ts
    );
    db.prepare('INSERT INTO routine_runs (id, routine_id, run_date, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'rrun_legacy_1', 'rou_legacy_1', '2026-10-01', 'completed', ts, '2026-10-01T10:10:00.000Z'
    );
    db.prepare('INSERT INTO routine_step_entries (id, run_id, step_id, status, completed_at) VALUES (?, ?, ?, ?, ?)').run(
      'rse_legacy_1', 'rrun_legacy_1', 'rstep_legacy_1', 'completed', '2026-10-01T10:05:00.000Z'
    );

    persistence.shutdownStorage();

    // 2. Iniciar el núcleo completo (ejecuta automáticamente respaldo pre-migration + migraciones v7..v20)
    const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
    assert.equal(core.persistenceService.getSchemaVersion(), 20);

    // Verificar respaldo previo automático íntegro
    const backups = core.backupService.listBackups();
    assert.ok(backups.length >= 1, 'Debe haberse creado respaldo pre-migration automáticamente');
    const verifyRes = core.backupService.verifyBackup(backups[0].id);
    assert.equal(verifyRes.ok, true);

    // Verificar reporte de evidencia de migración v17
    const reports = core.migrationService.getLegacyMigrationReports();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].status, 'COMPLETED');
    assert.equal(reports[0].source_count, 10);
    assert.equal(reports[0].migrated_count, 10);
    assert.equal(reports[0].skipped_count, 0);
    assert.equal(reports[0].conflict_count, 0);

    // Verificar tablas históricas intactas (Salvaguarda 2)
    const legacyRecordsCount = core.persistenceService.getReadDatabase().prepare('SELECT COUNT(*) AS c FROM records').get().c;
    assert.equal(legacyRecordsCount, 1);

    // Verificar acceso desde los nuevos servicios de dominio
    assert.equal(core.memoryService.getMemory('rec_legacy_1').content, 'Vive en Querétaro');
    assert.equal(core.projectService.getProject('proj_legacy_1').name, 'Proyecto Histórico v6');
    assert.equal(core.taskService.getTask('task_legacy_1').priority_id, 'prio_critical');
    assert.equal(core.calendarService.getEvent('ev_legacy_1').event.related_entity_id, 'task_legacy_1');
    assert.equal(core.habitService.getHabit('hab_legacy_1').name, 'Hidratación');
    assert.equal(core.routineService.getRoutine('rou_legacy_1').steps.length, 1);
    assert.equal(core.routineService.getRoutineExecution('rrun_legacy_1').step_executions.length, 1);

    core.shutdown();
  } finally {
    dirs.cleanup();
  }
});

test('B02.4 (DP-02) — Migración v16 -> v17: detección explícita de conflicto sin destruir datos y reintento limpio tras resolver', () => {
  const dirs = makeTempDirs();
  const cfg = createConfig({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  const persistence = createPersistenceService(cfg);
  persistence.initializeStorage();
  const backupService = createBackupService({ config: cfg, persistenceService: persistence });
  const allMigs = getAllMigrations();

  try {
    // 1. Preparar base en versión v16 que conserva datos en tablas heredadas
    const migV16 = createMigrationService({
      persistenceService: persistence,
      backupService,
      migrations: allMigs.filter(m => m.version <= 16),
    });
    migV16.executeMigration({ skipPreBackup: true });
    assert.equal(persistence.getSchemaVersion(), 16);

    const db = persistence.getDatabase();
    const ts = '2026-11-01T12:00:00.000Z';

    // Proyecto equivalente en ambas tablas (debe contarse como SKIPPED_EQUIVALENT)
    db.prepare('INSERT INTO projects (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'proj_shared', 'Proyecto Compartido', 'Igual descripción', 'active', ts, ts
    );
    db.prepare(`
      INSERT INTO personal_projects (id, name, description, purpose, priority_id, status, created_at, updated_at)
      VALUES ('proj_shared', 'Proyecto Compartido', 'Igual descripción', '', 'prio_medium', 'ACTIVE', ?, ?)
    `).run(ts, ts);

    // Tarea con MISMO ID pero título conflictivo entre tasks y personal_tasks + 1 tarea nueva válida
    db.prepare('INSERT INTO tasks (id, project_id, title, description, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'task_conflict', 'proj_shared', 'Título Antiguo Diferente', '', 'pending', 'normal', ts, ts
    );
    db.prepare(`
      INSERT INTO personal_tasks (id, project_id, title, description, priority_id, urgency, status, created_at, updated_at)
      VALUES ('task_conflict', 'proj_shared', 'Título Nuevo En v16', '', 'prio_medium', 2, 'PENDING', ?, ?)
    `).run(ts, ts);
    db.prepare('INSERT INTO tasks (id, project_id, title, description, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'task_clean_v16', 'proj_shared', 'Tarea Limpia Por Migrar', '', 'pending', 'high', ts, ts
    );

    // 2. Ejecutar migración hacia v17 -> debe detenerse con CONFLICT sin migrar parcialmente ni destruir nada
    const migFull = createMigrationService({ persistenceService: persistence, backupService, migrations: allMigs });
    assert.throws(
      () => migFull.executeMigration(),
      err => err.code === 'CONFLICT'
    );

    assert.equal(persistence.getSchemaVersion(), 16, 'La versión permanece en 16 al abortar v17');
    assert.equal(persistence.isRecoveryMode(), false, 'No bloquea la base v16 completa (Salvaguarda 7)');
    assert.equal(db.prepare('SELECT title FROM personal_tasks WHERE id = ?').get('task_conflict').title, 'Título Nuevo En v16');
    assert.equal(db.prepare('SELECT id FROM personal_tasks WHERE id = ?').get('task_clean_v16'), undefined, 'El savepoint revirtió escrituras parciales');

    const reportsAfterConflict = migFull.getLegacyMigrationReports();
    assert.equal(reportsAfterConflict.length, 1);
    assert.equal(reportsAfterConflict[0].status, 'CONFLICT_STOPPED');
    assert.equal(reportsAfterConflict[0].source_count, 3);
    assert.equal(reportsAfterConflict[0].migrated_count, 0);
    assert.equal(reportsAfterConflict[0].skipped_count, 1);
    assert.equal(reportsAfterConflict[0].conflict_count, 1);

    // 3. Resolver conflicto alineando la fila histórica (o renombrando) y reintentar explícitamente
    db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run('Título Nuevo En v16', 'task_conflict');
    const retryRes = migFull.executeMigration({ retryResolvedConflict: true });
    assert.equal(retryRes.current_version, 20);

    const reportsAfterFix = migFull.getLegacyMigrationReports();
    assert.equal(reportsAfterFix.length, 2);
    assert.equal(reportsAfterFix[0].status, 'COMPLETED');
    assert.equal(reportsAfterFix[0].source_count, 3);
    assert.equal(reportsAfterFix[0].migrated_count, 1);
    assert.equal(reportsAfterFix[0].skipped_count, 2);
    assert.equal(reportsAfterFix[0].conflict_count, 0);
    assert.equal(db.prepare('SELECT title FROM personal_tasks WHERE id = ?').get('task_clean_v16').title, 'Tarea Limpia Por Migrar');
  } finally {
    persistence.shutdownStorage();
    dirs.cleanup();
  }
});
