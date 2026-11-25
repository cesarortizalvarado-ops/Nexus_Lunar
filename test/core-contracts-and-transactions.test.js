import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { createClock, localDateBoundsToUtc } from '../src/shared/clock.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-b01-test-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('B01.1 — Reloj con zona horaria IANA (America/Mexico_City vs UTC) e instanciación sin E/S (autoInit: false)', () => {
  const dirs = makeTempDirs();
  try {
    // 2026-11-24T05:30:00Z equivale a 2026-11-23 23:30:00 en America/Mexico_City (UTC-6)
    const fixedUtc = new Date('2026-11-24T05:30:00.000Z');
    const clockMx = createClock({ timezone: 'America/Mexico_City', nowFn: () => fixedUtc });
    assert.equal(clockMx.todayDate(), '2026-11-23');
    assert.equal(clockMx.todayDate('UTC'), '2026-11-24');

    const bounds = localDateBoundsToUtc('2026-11-23', 'America/Mexico_City');
    assert.equal(bounds.startUtc, '2026-11-23T06:00:00.000Z');
    assert.equal(bounds.endUtc, '2026-11-24T05:59:59.999Z');

    // autoInit: false no debe crear directorios ni archivos SQLite hasta llamar initialize()
    const lazyCore = createNexusCore({
      dataDir: dirs.dataDir,
      backupDir: dirs.backupDir,
      timezone: 'America/Mexico_City',
      nowFn: () => fixedUtc,
      autoInit: false,
    });
    assert.equal(lazyCore.isInitialized(), false);
    assert.equal(fs.existsSync(dirs.dataDir), false);
    assert.ok(lazyCore.operations.listOperations().length > 100);

    lazyCore.initialize();
    assert.equal(lazyCore.isInitialized(), true);
    assert.equal(fs.existsSync(dirs.dataDir), true);
    lazyCore.shutdown();
  } finally {
    dirs.cleanup();
  }
});

test('B01.2 — TransactionService rechaza promesas en executeAtomicOperation haciendo ROLLBACK y serializa executeAtomicOperationAsync', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  try {
    assert.throws(
      () =>
        core.transactionService.executeAtomicOperation(() => {
          core.taskService.createTask({ title: 'Tarea dentro de callback async inválido' });
          return Promise.resolve('bad');
        }),
      err => err.code === 'INTEGRITY_ERROR'
    );
    assert.equal(core.taskService.listTasks().length, 0, 'El ROLLBACK debió deshacer la inserción antes de resolver la promesa');
    assert.equal(core.transactionService.getDepth(), 0);

    // Concurrencia serializada en executeAtomicOperationAsync + SAVEPOINT anidado
    const [t1, t2] = await Promise.all([
      core.transactionService.executeAtomicOperationAsync(async () => {
        await new Promise(r => setTimeout(r, 10));
        return core.transactionService.executeAtomicOperation(() =>
          core.taskService.createTask({ title: 'Async Task 1' })
        );
      }),
      core.transactionService.executeAtomicOperationAsync(async () => {
        return core.taskService.createTask({ title: 'Async Task 2' });
      }),
    ]);
    assert.ok(t1.id && t2.id);
    assert.equal(core.taskService.listTasks().length, 2);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('B01.3 — Un fallo en AuditService revierte atómicamente la mutación de negocio (sin catch silencioso)', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  try {
    const db = core.persistenceService.getDatabase();
    db.exec(`
      CREATE TRIGGER fail_audit_test
      BEFORE INSERT ON audit_records
      WHEN NEW.operation_type = 'products.test_fail_audit'
      BEGIN
        SELECT RAISE(ABORT, 'simulated_audit_failure');
      END;
    `);

    const resp = core.dispatcher.execute(
      { operation_type: 'products.test_fail_audit', payload: { name: 'Café en grano', unit: 'kg' } },
      req => core.productService.createProduct(req.payload),
      { kind: 'MUTATION', action: 'CREATE', module_id: 'inventory' }
    );
    assert.equal(resp.success, false);
    assert.equal(resp.errors[0].code, 'PERSISTENCE_ERROR');
    assert.equal(core.productService.listProducts().length, 0, 'El producto no debe persistir si falla su auditoría');

    db.exec('DROP TRIGGER fail_audit_test;');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('B01.4 — OperationDispatcher: semántica QUERY vs MUTATION, idempotencia sin duplicados, INV-013 (disableModule) y RelationService', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  try {
    const auditBeforeQuery = core.auditService.getOperationHistory().length;
    const listResp = core.executeOperation({ operation_type: 'tasks.list' });
    assert.equal(listResp.success, true);
    assert.equal(listResp.metadata.kind, 'QUERY');
    assert.equal(core.auditService.getOperationHistory().length, auditBeforeQuery, 'Las consultas QUERY no contaminan audit_records');

    // Mutación con idempotency_key: crea 1 tarea, 1 registro de auditoría (sin duplicado) y 1 evento
    const createResp1 = core.executeOperation({
      operation_type: 'tasks.create',
      idempotency_key: 'idem-task-001',
      payload: { title: 'Consolidar frontera de aplicación' },
    });
    assert.equal(createResp1.success, true);
    const createdTaskId = createResp1.result.id;

    const taskAudits = core.auditService.getEntityHistory('task', createdTaskId);
    assert.equal(taskAudits.length, 1, 'No debe duplicarse la auditoría entre servicio y dispatcher');
    const opAudits = core.auditService.getOperationHistory({ operation_type: 'tasks.create' });
    assert.equal(opAudits.length, 0, 'Dispatcher no añade un segundo registro genérico cuando TaskService ya registró recordChange');

    const replayResp = core.executeOperation({
      operation_type: 'tasks.create',
      idempotency_key: 'idem-task-001',
      payload: { title: 'Intento duplicado' },
    });
    assert.equal(replayResp.success, true);
    assert.equal(replayResp.metadata.idempotent_replay, true);
    assert.equal(replayResp.result.id, createdTaskId);
    assert.equal(core.taskService.listTasks().length, 1);

    // Reutilizar la misma idempotency_key en otra operación distinta produce CONFLICT
    const conflictIdem = core.executeOperation({
      operation_type: 'goals.create',
      idempotency_key: 'idem-task-001',
      payload: { name: 'Objetivo X' },
    });
    assert.equal(conflictIdem.success, false);
    assert.equal(conflictIdem.errors[0].code, 'CONFLICT');

    // RelationService valida existencia real (DB-002)
    const missingRel = core.executeOperation({
      operation_type: 'relations.create',
      payload: {
        source_entity_type: 'task',
        source_entity_id: createdTaskId,
        target_entity_type: 'goal',
        target_entity_id: 'goal-inexistente',
        relation_type: 'CONTRIBUTES_TO',
      },
    });
    assert.equal(missingRel.success, false);
    assert.equal(missingRel.errors[0].code, 'NOT_FOUND');

    // INV-013: Deshabilitar módulo bloquea operaciones pero conserva intactos sus datos
    const disResp = core.executeOperation({ operation_type: 'modules.disable', payload: { id: 'personal' } });
    assert.equal(disResp.success, true);

    const blockedList = core.executeOperation({ operation_type: 'tasks.list' });
    assert.equal(blockedList.success, false);
    assert.equal(blockedList.errors[0].code, 'SERVICE_UNAVAILABLE');

    const enResp = core.executeOperation({ operation_type: 'modules.enable', payload: { id: 'personal' } });
    assert.equal(enResp.success, true);

    const restoredList = core.executeOperation({ operation_type: 'tasks.list' });
    assert.equal(restoredList.success, true);
    assert.equal(restoredList.result.length, 1);
    assert.equal(restoredList.result[0].id, createdTaskId);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});
