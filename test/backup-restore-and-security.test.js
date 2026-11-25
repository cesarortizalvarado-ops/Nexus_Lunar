import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { createCoreHttpServer } from '../src/interfaces/http/http-server.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-b03-test-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function rawHttpRequest(port, { method = 'GET', reqPath = '/health', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: reqPath, headers },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('B03.1 — Archivos anidados, verificación SHA-256 recursiva, restauración sin huérfanos y preservación en pre-restore', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  try {
    // Rechazo de path traversal en subDir
    assert.throws(
      () => core.fileStorageService.storeFile({ originalName: 'mal.txt', subDir: '../escape', content: 'x' }),
      err => err.code === 'VALIDATION_ERROR'
    );

    const fileA = core.fileStorageService.storeFile({
      originalName: 'contrato.md',
      subDir: 'documentos/2026/contratos',
      content: '# Contrato A íntegro\n',
      mimeType: 'text/markdown',
    });
    assert.ok(fileA.internal_name.startsWith('documentos/2026/contratos/'));

    const healthBefore = core.storageHealthService.inspectStorage();
    assert.equal(healthBefore.files_integrity.ok, true);
    assert.equal(healthBefore.files_integrity.tracked_active_count, 1);

    // Crear respaldo con archivo anidado A
    const bkp1 = core.backupService.createBackup({ reason: 'milestone-a' });
    const ver1 = core.backupService.verifyBackup(bkp1.id);
    assert.equal(ver1.ok, true);
    assert.equal(ver1.files_verified, 1);
    assert.ok(bkp1.files[0].name.startsWith('documentos/2026/contratos/'));

    // Crear archivo B posterior al respaldo
    const fileB = core.fileStorageService.storeFile({
      originalName: 'posterior.txt',
      subDir: 'notas/posteriores',
      content: 'Archivo creado después del backup bkp1',
    });
    assert.equal(core.fileStorageService.listFiles().length, 2);

    // DB-007: sin autorización debe rechazarse
    assert.throws(
      () => core.restoreService.restoreBackup(bkp1.id, {}),
      err => err.code === 'PERMISSION_DENIED'
    );

    // Autorizar y restaurar bkp1
    const auth = core.restoreService.requestRestoreAuthorization(bkp1.id, { requestedBy: 'dante' });
    const restoreRes = core.restoreService.restoreBackup(bkp1.id, { authorizationToken: auth.token });
    assert.equal(restoreRes.verified.ok, true);
    assert.ok(restoreRes.pre_restore_backup_id);

    // A sigue íntegro; B ya no queda huérfano en filesDir, pero sí quedó resguardado en el respaldo pre-restore
    const readA = core.fileStorageService.readFileContent(fileA.id);
    assert.equal(readA.content.toString('utf8'), '# Contrato A íntegro\n');
    assert.equal(fs.existsSync(fileB.location), false, 'El archivo posterior no debe quedar como huérfano en filesDir');

    const healthAfter = core.storageHealthService.inspectStorage();
    assert.equal(healthAfter.files_integrity.ok, true);
    assert.equal(healthAfter.files_integrity.orphan_files.length, 0);

    const preRestoreMeta = core.backupService.getBackup(restoreRes.pre_restore_backup_id);
    assert.equal(preRestoreMeta.files.length, 2, 'El respaldo pre-restore conserva tanto A como B');
    assert.equal(core.backupService.verifyBackup(restoreRes.pre_restore_backup_id).ok, true);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('B03.2 — RestoreService rechaza respaldos con schema_version futura incompatible', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  try {
    const bkp = core.backupService.createBackup({ reason: 'future-test' });
    const manifestPath = path.join(dirs.backupDir, bkp.id, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.schema_version = 999;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const val = core.restoreService.validateRestore(bkp.id);
    assert.equal(val.valid, false);
    assert.ok(val.errors.some(e => e.includes('v999')));

    assert.throws(
      () => core.restoreService.restoreBackup(bkp.id, { confirmed: true, authorizedBy: 'dante' }),
      err => err.code === 'INTEGRITY_ERROR'
    );
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('B03.3 — Seguridad HTTP loopback: rechazo de Host externo, Origin externo y Sec-Fetch-Site cross-site + cabeceras CSP', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  const server = createCoreHttpServer(core);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    // 1. Petición local legítima incluye CSP y X-Frame-Options: DENY
    const okRes = await rawHttpRequest(port, {
      method: 'GET',
      reqPath: '/health',
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.headers['x-frame-options'], 'DENY');
    assert.ok(okRes.headers['content-security-policy'].includes("default-src 'self'"));

    // 2. DNS rebinding simulado: Host externo -> 403
    const badHost = await rawHttpRequest(port, {
      method: 'GET',
      reqPath: '/api/tasks',
      headers: { Host: 'evil-rebind.attacker.com' },
    });
    assert.equal(badHost.statusCode, 403);

    // 3. CSRF navegador desde Origin externo -> 403
    const badOrigin = await rawHttpRequest(port, {
      method: 'POST',
      reqPath: '/api/tasks',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: 'https://malicious.site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Intento CSRF' }),
    });
    assert.equal(badOrigin.statusCode, 403);
    assert.equal(core.taskService.listTasks().length, 0);

    // 4. Sec-Fetch-Site: cross-site -> 403
    const badFetchSite = await rawHttpRequest(port, {
      method: 'POST',
      reqPath: '/api/tasks',
      headers: {
        Host: `127.0.0.1:${port}`,
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Intento cross-site' }),
    });
    assert.equal(badFetchSite.statusCode, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    core.shutdown();
    dirs.cleanup();
  }
});
