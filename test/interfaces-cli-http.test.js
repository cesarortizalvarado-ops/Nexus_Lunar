import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { createCoreHttpServer } from '../src/interfaces/http/http-server.js';
import { runCli } from '../src/interfaces/cli/nexus-cli.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-b06-test-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function execCli(argv, cfg) {
  const stdout = [];
  const stderr = [];
  const code = await runCli(argv, cfg, {
    stdout: s => stdout.push(s),
    stderr: s => stderr.push(s),
  });
  return {
    code,
    outText: stdout.join('\n'),
    errText: stderr.join('\n'),
    json: stdout.length > 0 ? JSON.parse(stdout[0]) : null,
    errJson: stderr.length > 0 ? JSON.parse(stderr[0]) : null,
  };
}

test('B06.1 — CLI unificada sobre OperationDispatcher: backup verify posicional y con --id, comando universal op, idempotencia y módulos', async () => {
  const dirs = makeTempDirs();
  const cfg = { dataDir: dirs.dataDir, backupDir: dirs.backupDir, timezone: 'America/Mexico_City' };

  try {
    // 1. Crear respaldo y verificar tanto con argumento posicional como con --id (resolución del caso Kubuntu)
    const created = await execCli(['backup', 'create', '--reason', 'cli-verify-test'], cfg);
    assert.equal(created.code, 0);
    const backupId = created.json.id;
    assert.ok(backupId.startsWith('bkp_'));

    const missingId = await execCli(['backup', 'verify'], cfg);
    assert.equal(missingId.code, 1);
    assert.equal(missingId.errJson.error, 'VALIDATION_ERROR');
    assert.ok(missingId.errJson.remediation.includes('backup verify <backup_id>'));

    const verifyPositional = await execCli(['backup', 'verify', backupId], cfg);
    assert.equal(verifyPositional.code, 0);
    assert.equal(verifyPositional.json.ok, true);

    const verifyFlag = await execCli(['backup', 'verify', '--id', backupId], cfg);
    assert.equal(verifyFlag.code, 0);
    assert.equal(verifyFlag.json.ok, true);

    // 2. Comando universal `op` con idempotencia y catálogo
    const cat = await execCli(['catalog', '--module', 'personal', '--kind', 'MUTATION'], cfg);
    assert.equal(cat.code, 0);
    assert.ok(cat.json.some(o => o.operation_type === 'tasks.create'));

    const op1 = await execCli([
      'op',
      'tasks.create',
      '--json',
      JSON.stringify({ title: 'Tarea vía contrato universal CLI' }),
      '--idempotency-key',
      'cli-idem-1',
    ], cfg);
    assert.equal(op1.code, 0);

    const op2 = await execCli([
      'op',
      'tasks.create',
      '--json',
      JSON.stringify({ title: 'Duplicado ignorado' }),
      '--idempotency-key',
      'cli-idem-1',
    ], cfg);
    assert.equal(op2.code, 0);
    assert.equal(op2.json.id, op1.json.id);

    // 3. Deshabilitar módulo desde CLI bloquea consultas/mutaciones en CLI preservando datos (INV-013)
    await execCli(['modules', 'disable', 'personal'], cfg);
    const blocked = await execCli(['tasks', 'list'], cfg);
    assert.equal(blocked.code, 1);
    assert.equal(blocked.errJson.error, 'SERVICE_UNAVAILABLE');

    await execCli(['modules', 'enable', 'personal'], cfg);
    const okAgain = await execCli(['tasks', 'list'], cfg);
    assert.equal(okAgain.code, 0);
    assert.equal(okAgain.json.length, 1);
  } finally {
    dirs.cleanup();
  }
});

test('B06.2 — Servidor HTTP y contrato /api/operations: catálogo para clientes futuros, replay idempotente y propuestas autorizadas de IA', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir, timezone: 'America/Mexico_City' });
  const server = createCoreHttpServer(core);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Activos estáticos y /api/operations/catalog
    const indexRes = await fetch(`${base}/`);
    assert.equal(indexRes.status, 200);
    const cssRes = await fetch(`${base}/styles.css`);
    const cssText = await cssRes.text();
    assert.equal((cssText.match(/\.habit-card\{/g) ?? []).length, 1, 'styles.css sin reglas duplicadas');

    const catRes = await fetch(`${base}/api/operations/catalog`);
    const catBody = await catRes.json();
    assert.equal(catRes.status, 200);
    assert.ok(catBody.data.length > 100);

    // 2. POST /api/operations con idempotency_key
    const opRes1 = await fetch(`${base}/api/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': 'http-idem-99' },
      body: JSON.stringify({ operation_type: 'goals.create', payload: { name: 'Objetivo vía HTTP Operations' } }),
    });
    const opBody1 = await opRes1.json();
    assert.equal(opRes1.status, 200);
    assert.equal(opBody1.success, true);

    const opRes2 = await fetch(`${base}/api/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idempotency-key': 'http-idem-99' },
      body: JSON.stringify({ operation_type: 'goals.create', payload: { name: 'Intento duplicado' } }),
    });
    const opBody2 = await opRes2.json();
    assert.equal(opBody2.metadata.idempotent_replay, true);
    assert.equal(opBody2.result.id, opBody1.result.id);

    // 3. INV-011: un actor AI_ASSISTANT sin autorización explícita es rechazado con 403 PERMISSION_DENIED
    const aiDenied = await fetch(`${base}/api/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_type: 'tasks.create',
        source: { actor_type: 'AI_ASSISTANT', actor_id: 'future-assistant' },
        payload: { title: 'Mutación IA sin permiso' },
      }),
    });
    assert.equal(aiDenied.status, 403);
    const aiDeniedBody = await aiDenied.json();
    assert.equal(aiDeniedBody.errors[0].code, 'PERMISSION_DENIED');

    // 4. Flujo contractual completo de propuesta de IA -> validación -> autorización explícita -> ejecución vía OperationDispatcher
    const prop = core.aiOperationService.createOperationProposal({
      operation_type: 'tasks.create',
      target_entity: 'task',
      proposed_changes: { title: 'Tarea propuesta por IA y autorizada por humano' },
      explanation: 'Desglose sugerido',
    });
    core.aiOperationService.validateOperation(prop.id);
    assert.throws(() => core.aiOperationService.executeOperation(prop.id), err => err.code === 'PERMISSION_DENIED');
    core.aiOperationService.requestAuthorization(prop.id, { authorized_by: 'dante' });
    const execAi = core.aiOperationService.executeOperation(prop.id);
    assert.equal(execAi.status, 'EXECUTED');
    assert.equal(execAi.result.title, 'Tarea propuesta por IA y autorizada por humano');
  } finally {
    await new Promise(resolve => server.close(resolve));
    core.shutdown();
    dirs.cleanup();
  }
});
