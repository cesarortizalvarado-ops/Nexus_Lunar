import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import { createNexusCore } from '../src/core/nexus-core.js';
import {
  assertHttpMethodOperationCompatibility,
  createCoreHttpServer,
  getHttpRouteDefinitions,
} from '../src/interfaces/http/http-server.js';

function quoteSqlIdent(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function encodeCanonicalCell(value) {
  if (value === null || value === undefined) {
    return { t: 'null', v: null };
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { t: 'float', v: 'NaN' };
    if (Object.is(value, -0)) return { t: 'float', v: '-0' };
    return { t: Number.isInteger(value) ? 'int' : 'float', v: String(value) };
  }
  if (typeof value === 'bigint') {
    return { t: 'bigint', v: value.toString() };
  }
  if (typeof value === 'string') {
    return { t: 'text', v: value };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { t: 'blob', v: Buffer.from(value).toString('hex') };
  }
  return { t: typeof value, v: JSON.stringify(value) };
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Captura consistente, determinista y completa del contenido de todas las tablas de aplicación en SQLite.
 *
 * - Excluye únicamente tablas internas `sqlite_%` (catálogo interno de SQLite como `sqlite_sequence` / `sqlite_stat*`
 *   que no representan entidades funcionales del dominio).
 * - Detecta tablas `WITHOUT ROWID`, claves primarias simples y claves primarias compuestas mediante `PRAGMA table_info`.
 * - No presupone existencia de `rowid`: ordena canónicamente por las columnas de clave primaria cuando existen
 *   (100% de las 92 tablas del esquema v17 y toda tabla `WITHOUT ROWID`), con respaldo determinista para tablas sin PK.
 * - Ejecuta la lectura dentro de una transacción `BEGIN DEFERRED ... ROLLBACK` (cuando no hay transacción activa)
 *   para garantizar consistencia instantánea entre tablas sin escribir nada en disco ni alterar el estado del sistema.
 */
export function captureDatabaseSnapshot(db) {
  const startedReadTx = !db.isTransaction;
  if (startedReadTx) {
    db.exec('BEGIN DEFERRED');
  }

  try {
    const catalogRows = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `).all();

    const tables = {};
    const globalHashLines = [];

    for (const entry of catalogRows) {
      const tableName = entry.name;
      const createSql = entry.sql ?? '';
      const withoutRowid = /\bWITHOUT\s+ROWID\b/i.test(createSql);
      const quotedTable = quoteSqlIdent(tableName);

      const pragmaCols = db.prepare(`PRAGMA table_info(${quotedTable})`).all();
      const orderedCols = [...pragmaCols].sort((a, b) => a.cid - b.cid);
      const colNames = orderedCols.map(c => c.name);
      const pkCols = orderedCols
        .filter(c => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map(c => c.name);

      let selectSql;
      let includeSyntheticRowid = false;
      if (pkCols.length > 0) {
        const selectList = colNames.map(quoteSqlIdent).join(', ');
        const orderByList = pkCols.map(c => `${quoteSqlIdent(c)} ASC`).join(', ');
        selectSql = `SELECT ${selectList} FROM ${quotedTable} ORDER BY ${orderByList}`;
      } else if (!withoutRowid) {
        includeSyntheticRowid = true;
        const selectList = ['rowid AS "__sqlite_rowid__"', ...colNames.map(quoteSqlIdent)].join(', ');
        selectSql = `SELECT ${selectList} FROM ${quotedTable} ORDER BY "__sqlite_rowid__" ASC`;
      } else {
        const selectList = colNames.map(quoteSqlIdent).join(', ');
        const orderByList = colNames.map(c => `${quoteSqlIdent(c)} ASC`).join(', ');
        selectSql = `SELECT ${selectList} FROM ${quotedTable}${orderByList ? ` ORDER BY ${orderByList}` : ''}`;
      }

      const rawRows = db.prepare(selectSql).all();
      const canonicalRows = rawRows.map(row => {
        const encoded = {};
        if (includeSyntheticRowid) {
          encoded.__sqlite_rowid__ = encodeCanonicalCell(row.__sqlite_rowid__);
        }
        for (const col of colNames) {
          encoded[col] = encodeCanonicalCell(row[col]);
        }
        return encoded;
      });

      const tableCanonicalPayload = JSON.stringify({
        table: tableName,
        without_rowid: withoutRowid,
        primary_key: pkCols,
        columns: colNames,
        rows: canonicalRows,
      });
      const tableSha256 = sha256Hex(tableCanonicalPayload);

      tables[tableName] = {
        row_count: canonicalRows.length,
        without_rowid: withoutRowid,
        primary_key: pkCols,
        columns: colNames,
        sha256: tableSha256,
        rows: canonicalRows,
      };
      globalHashLines.push(`${tableName}:${tableSha256}`);
    }

    return {
      table_count: catalogRows.length,
      excluded_internal_pattern: 'sqlite_%',
      sha256: sha256Hex(globalHashLines.join('\n')),
      tables,
    };
  } finally {
    if (startedReadTx && db.isTransaction) {
      db.exec('ROLLBACK');
    }
  }
}

export function diffDatabaseSnapshots(before, after) {
  const beforeNames = new Set(Object.keys(before.tables));
  const afterNames = new Set(Object.keys(after.tables));

  const addedTables = [...afterNames].filter(n => !beforeNames.has(n));
  const removedTables = [...beforeNames].filter(n => !afterNames.has(n));
  const modifiedTables = [];

  for (const name of [...beforeNames].filter(n => afterNames.has(n))) {
    const bTable = before.tables[name];
    const aTable = after.tables[name];
    if (bTable.sha256 !== aTable.sha256) {
      modifiedTables.push({
        table: name,
        before_count: bTable.row_count,
        after_count: aTable.row_count,
        before_sha256: bTable.sha256,
        after_sha256: aTable.sha256,
      });
    }
  }

  return {
    identical: before.sha256 === after.sha256 && addedTables.length === 0 && removedTables.length === 0 && modifiedTables.length === 0,
    added_tables: addedTables,
    removed_tables: removedTables,
    modified_tables: modifiedTables,
  };
}

export function assertDatabaseSnapshotsEqual(after, before, message = 'El estado persistente de SQLite no debe modificarse') {
  const diff = diffDatabaseSnapshots(before, after);
  assert.equal(
    diff.identical,
    true,
    `${message}. Diferencias detectadas: ${JSON.stringify(diff)}`
  );
  assert.equal(after.sha256, before.sha256, message);
}

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-sec-http-001-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function sendRawHttp(port, { method = 'GET', reqPath = '/health', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payloadStr = body === null
      ? null
      : (typeof body === 'string' ? body : JSON.stringify(body));
    const finalHeaders = {
      Host: `127.0.0.1:${port}`,
      ...(payloadStr !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payloadStr) } : {}),
      ...headers,
    };
    const req = http.request(
      { host: '127.0.0.1', port, method, path: reqPath, headers: finalHeaders },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* non-json */ }
          resolve({ statusCode: res.statusCode, headers: res.headers, rawBody: data, json });
        });
      }
    );
    req.on('error', reject);
    if (payloadStr !== null) req.write(payloadStr);
    req.end();
  });
}

const isDirectTestEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectTestEntry) {
  test('NL-SEC-HTTP-001 · Casos 1 a 4 — Separación estricta GET (consulta pura) vs POST (generación explícita) en /api/planning/review y bloqueo cross-site', async () => {
    const dirs = makeTempDirs();
    const core = createNexusCore({
      dataDir: dirs.dataDir,
      backupDir: dirs.backupDir,
      timezone: 'America/Mexico_City',
      nowFn: () => new Date('2026-11-24T18:00:00.000Z'),
    });
    const db = core.persistenceService.getReadDatabase();
    const server = createCoreHttpServer(core);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      // === Caso 2: GET sin revisión existente -> devuelve 404 NOT_FOUND y NO escribe en SQLite ===
      const beforeCase2 = captureDatabaseSnapshot(db);
      assert.ok(beforeCase2.table_count >= 90, 'El snapshot debe cubrir todas las tablas de aplicación del esquema v17');
      const resCase2 = await sendRawHttp(port, {
        method: 'GET',
        reqPath: '/api/planning/review?date=2026-11-25',
      });
      assert.equal(resCase2.statusCode, 404);
      assert.equal(resCase2.json?.error?.code, 'NOT_FOUND');
      assert.equal(
        db.prepare('SELECT * FROM daily_reviews WHERE review_date = ?').get('2026-11-25'),
        undefined,
        'Caso 2: GET nunca debe crear un registro en daily_reviews cuando no existe'
      );
      assertDatabaseSnapshotsEqual(captureDatabaseSnapshot(db), beforeCase2, 'Caso 2: ninguna tabla persistente debe alterarse en una consulta GET');

      // === Caso 3: GET (y POST) con Origin externo y Sec-Fetch-Site: cross-site (reproducción exacta del reporte Kubuntu) ===
      const beforeCase3 = captureDatabaseSnapshot(db);
      const resCase3Get = await sendRawHttp(port, {
        method: 'GET',
        reqPath: '/api/planning/review?date=2026-11-26',
        headers: {
          Origin: 'https://evil-external.example',
          'Sec-Fetch-Site': 'cross-site',
        },
      });
      assert.notEqual(resCase3Get.statusCode, 200, 'Caso 3: nunca debe devolver 200 creando una revisión inexistente');
      assert.equal(resCase3Get.statusCode, 404);
      assert.equal(
        db.prepare('SELECT COUNT(*) AS c FROM daily_reviews WHERE review_date = ?').get('2026-11-26').c,
        0,
        'Caso 3: una petición GET cross-site jamás produce creación en daily_reviews'
      );
      assertDatabaseSnapshotsEqual(captureDatabaseSnapshot(db), beforeCase3, 'Caso 3: cero mutaciones persistentes tras GET cross-site');

      // Verificar además que POST cross-site a /api/planning/review es bloqueado con 403 antes de mutar
      const resCase3Post = await sendRawHttp(port, {
        method: 'POST',
        reqPath: '/api/planning/review',
        headers: {
          Origin: 'https://evil-external.example',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: { date: '2026-11-26' },
      });
      assert.equal(resCase3Post.statusCode, 403);
      assert.equal(resCase3Post.json?.error?.code, 'PERMISSION_DENIED');
      assert.equal(
        db.prepare('SELECT COUNT(*) AS c FROM daily_reviews WHERE review_date = ?').get('2026-11-26').c,
        0,
        'Caso 3: POST cross-site rechazado sin crear revisión'
      );
      assertDatabaseSnapshotsEqual(captureDatabaseSnapshot(db), beforeCase3, 'Caso 3: POST cross-site bloqueado en frontera HTTP antes de tocar SQLite');

      // === Caso 4: POST legítimo local crea explícitamente la revisión diaria ===
      const resCase4 = await sendRawHttp(port, {
        method: 'POST',
        reqPath: '/api/planning/review',
        headers: {
          Origin: `http://127.0.0.1:${port}`,
          'Sec-Fetch-Site': 'same-origin',
        },
        body: { date: '2026-11-24' },
      });
      assert.equal(resCase4.statusCode, 201);
      assert.equal(resCase4.json?.metadata?.kind, 'MUTATION');
      assert.equal(resCase4.json?.data?.review_date, '2026-11-24');
      assert.equal(resCase4.json?.data?.status, 'OPEN');

      const persistedRow = db.prepare('SELECT * FROM daily_reviews WHERE review_date = ?').get('2026-11-24');
      assert.ok(persistedRow, 'Caso 4: el registro debe existir en SQLite tras POST explícito');
      assert.equal(persistedRow.status, 'OPEN');

      // === Caso 1: GET legítimo sobre revisión existente -> devuelve 200 QUERY sin modificar SQLite ===
      const beforeCase1 = captureDatabaseSnapshot(db);
      const resCase1 = await sendRawHttp(port, {
        method: 'GET',
        reqPath: '/api/planning/review?date=2026-11-24',
      });
      assert.equal(resCase1.statusCode, 200);
      assert.equal(resCase1.json?.metadata?.kind, 'QUERY');
      assert.equal(resCase1.json?.data?.id, persistedRow.id);
      assert.equal(resCase1.json?.data?.review_date, '2026-11-24');
      assert.equal(resCase1.json?.data?.status, 'OPEN');
      assertDatabaseSnapshotsEqual(captureDatabaseSnapshot(db), beforeCase1, 'Caso 1: consultar una revisión existente no altera ninguna columna ni añade auditoría');
    } finally {
      await new Promise(resolve => server.close(resolve));
      core.shutdown();
      dirs.cleanup();
    }
  });

  test('NL-SEC-HTTP-001 · Caso 5 — Guardia centralizada método HTTP <-> operación rechaza combinaciones incompatibles antes de ejecutar servicios', async () => {
    const dirs = makeTempDirs();
    const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
    const db = core.persistenceService.getReadDatabase();

    let spyMutationCalls = 0;
    let spyQueryCalls = 0;
    core.operations.registerOperation({
      operation_type: 'test.spyMutation',
      kind: 'MUTATION',
      action: 'CREATE',
      module_id: 'system',
      handler: () => {
        spyMutationCalls += 1;
        return { executed: true };
      },
    });
    core.operations.registerOperation({
      operation_type: 'test.spyQuery',
      kind: 'QUERY',
      action: 'READ',
      module_id: 'system',
      handler: () => {
        spyQueryCalls += 1;
        return { read: true };
      },
    });

    const server = createCoreHttpServer(core);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const snapBefore = captureDatabaseSnapshot(db);

      // 1. Intentar ejecutar una operación MUTATION mediante GET -> rechazado con 405 antes de invocar el handler
      const getMutation1 = await sendRawHttp(port, {
        method: 'GET',
        reqPath: '/api/operations?operation_type=planning.dailyReview.generate&payload=%7B%22date%22%3A%222026-11-28%22%7D',
      });
      assert.equal(getMutation1.statusCode, 405);
      assert.equal(getMutation1.json?.error?.code, 'VALIDATION_ERROR');
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM daily_reviews WHERE review_date = ?').get('2026-11-28').c, 0);

      const getMutation2 = await sendRawHttp(port, {
        method: 'GET',
        reqPath: '/api/operations?operation_type=test.spyMutation',
      });
      assert.equal(getMutation2.statusCode, 405);
      assert.equal(spyMutationCalls, 0, 'El handler de mutación jamás debe ejecutarse desde GET');

      // 2. Consulta legítima vía GET /api/operations sí se permite
      const getQueryOk = await sendRawHttp(port, {
        method: 'GET',
        reqPath: '/api/operations?operation_type=test.spyQuery',
      });
      assert.equal(getQueryOk.statusCode, 200);
      assert.equal(spyQueryCalls, 1);

      // 3. Intentar ejecutar una operación QUERY mediante métodos incompatibles (PATCH, PUT, DELETE y POST REST)
      for (const badMethod of ['PATCH', 'PUT', 'DELETE']) {
        const badRes = await sendRawHttp(port, {
          method: badMethod,
          reqPath: '/api/operations',
          body: { operation_type: 'test.spyQuery', payload: {} },
        });
        assert.equal(badRes.statusCode, 405, `QUERY sobre ${badMethod} debe rechazarse con 405`);
      }
      assert.equal(spyQueryCalls, 1, 'Ninguna invocación incompatible ejecutó el handler de consulta');

      // Validación directa de ruta REST POST contra una operación QUERY (rpcEnvelope: false)
      assert.throws(
        () => assertHttpMethodOperationCompatibility('POST', core.operations.getOperationSpec('planning.dailyReview.get'), { rpcEnvelope: false }),
        err => err.statusCode === 405 && err.code === 'VALIDATION_ERROR'
      );

      // 4. Intentar ejecutar una MUTATION con verbo mutador incompatible (CREATE en DELETE, DELETE en PATCH)
      const createOnDelete = await sendRawHttp(port, {
        method: 'DELETE',
        reqPath: '/api/operations',
        body: { operation_type: 'test.spyMutation', payload: {} },
      });
      assert.equal(createOnDelete.statusCode, 405);
      assert.equal(spyMutationCalls, 0);

      const deleteOnPatch = await sendRawHttp(port, {
        method: 'PATCH',
        reqPath: '/api/operations',
        body: { operation_type: 'backup.delete', payload: { id: 'bkp_fake' } },
      });
      assert.equal(deleteOnPatch.statusCode, 405);

      // Ninguna tabla de negocio ni auditoría fue escrita durante estos rechazos pre-ejecución
      assertDatabaseSnapshotsEqual(captureDatabaseSnapshot(db), snapBefore);
    } finally {
      await new Promise(resolve => server.close(resolve));
      core.shutdown();
      dirs.cleanup();
    }
  });

  test('NL-SEC-HTTP-001 · Caso 6 — Auditoría integral de rutas HTTP: cero rutas GET mutables y 100% de mutaciones bajo protección CSRF', async () => {
    const dirs = makeTempDirs();
    const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
    const db = core.persistenceService.getReadDatabase();

    // Poblar datos representativos previos para que el barrido GET también ejercite lectura real de filas existentes
    const goal = core.goalService.createGoal({ name: 'Objetivo semilla HTTP', horizon: 'MID_TERM' });
    const proj = core.projectService.createProject({ name: 'Proyecto semilla HTTP', goal_id: goal.id });
    core.taskService.createTask({ title: 'Tarea semilla HTTP', project_id: proj.id });
    core.productService.createProduct({ name: 'Insumo semilla HTTP', unit: 'unit', minimum_quantity: 1 });

    const server = createCoreHttpServer(core);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const routes = getHttpRouteDefinitions();
      assert.ok(routes.length >= 30, 'Debe inspeccionar la totalidad del catálogo de rutas REST');

      // 1. Verificación estructural de cada ruta contra el registro real de operaciones del Dispatcher
      for (const route of routes) {
        const spec = core.operations.getOperationSpec(route.operation_type);
        assert.ok(spec, `La ruta ${route.method} ${route.path} referencia una operación inexistente: ${route.operation_type}`);

        if (route.method === 'GET') {
          assert.equal(
            spec.kind,
            'QUERY',
            `Violación crítica: la ruta GET ${route.path} apunta a '${route.operation_type}' con kind=${spec.kind}`
          );
          assert.equal(spec.action, 'READ', `La ruta GET ${route.path} debe tener action=READ`);
        } else {
          assert.equal(
            spec.kind,
            'MUTATION',
            `La ruta mutadora ${route.method} ${route.path} debe apuntar a una operación MUTATION (actual: ${spec.kind})`
          );
        }
        assert.doesNotThrow(() => assertHttpMethodOperationCompatibility(route.method, spec, { rpcEnvelope: false }));
      }

      // 2. Barrido en vivo de TODAS las rutas GET verificando 0 escrituras sobre el snapshot completo (92 tablas)
      const initialSnap = captureDatabaseSnapshot(db);
      const getPaths = [
        '/health',
        '/api/operations/catalog',
        '/api/ai/status',
        ...routes.filter(r => r.method === 'GET').map(r => r.path),
      ];
      for (const p of getPaths) {
        const res = await sendRawHttp(port, { method: 'GET', reqPath: p });
        assert.ok(
          res.statusCode === 200 || res.statusCode === 404,
          `Respuesta inesperada (${res.statusCode}) en ruta de lectura GET ${p}`
        );
      }
      assertDatabaseSnapshotsEqual(
        captureDatabaseSnapshot(db),
        initialSnap,
        'Barrido completo de rutas GET no debe producir ni una sola escritura ni actualización en las 92 tablas de SQLite'
      );

      // 3. Barrido en vivo de TODAS las rutas mutadoras verificando rechazo 403 ante Origin externo / Sec-Fetch-Site: cross-site
      const mutatingRoutes = [
        { method: 'POST', path: '/api/operations' },
        ...routes
          .filter(r => r.method !== 'GET')
          .map(r => ({
            method: r.method,
            path: r.path.replace(':id', 'test-id'),
          })),
      ];
      for (const mr of mutatingRoutes) {
        const csrfRes = await sendRawHttp(port, {
          method: mr.method,
          reqPath: mr.path,
          headers: {
            Origin: 'https://cross-origin-attacker.example',
            'Sec-Fetch-Site': 'cross-site',
          },
          body: {},
        });
        assert.equal(
          csrfRes.statusCode,
          403,
          `La ruta mutadora ${mr.method} ${mr.path} debe rechazar con 403 peticiones cross-site`
        );
      }
      assertDatabaseSnapshotsEqual(
        captureDatabaseSnapshot(db),
        initialSnap,
        'Ninguna ruta mutadora atacada cross-site pudo modificar ninguna fila ni columna en SQLite'
      );
    } finally {
      await new Promise(resolve => server.close(resolve));
      core.shutdown();
      dirs.cleanup();
    }
  });

  test('NL-INT-002 · Actividad A (3.5) — El mecanismo captureDatabaseSnapshot detecta inserciones, eliminaciones, actualizaciones, cambios con COUNT(*) constante y lecturas limpias', () => {
    const dirs = makeTempDirs();
    const core = createNexusCore({
      dataDir: dirs.dataDir,
      backupDir: dirs.backupDir,
      timezone: 'America/Mexico_City',
      nowFn: () => new Date('2026-11-24T19:00:00.000Z'),
    });
    const rwDb = core.persistenceService.getDatabase();
    const roDb = core.persistenceService.getReadDatabase();

    try {
      const baseSnap = captureDatabaseSnapshot(roDb);
      assert.equal(baseSnap.table_count, 97, 'Debe inspeccionar las 97 tablas persistentes de aplicación del esquema v18');
      assert.ok(baseSnap.tables.replenishment_cycles, 'Incluye tablas fuera de las 13 anteriores como replenishment_cycles');
      assert.deepEqual(baseSnap.tables.goal_tasks.primary_key, ['goal_id', 'task_id'], 'Reconoce claves primarias compuestas');

      // 1. Detección de INSERCIÓN (incluyendo tabla no cubierta por el antiguo snapshotDbCounts, como products)
      const prodA = core.productService.createProduct({ name: 'Tornillo M3', unit: 'unit', minimum_quantity: 10 });
      const prodB = core.productService.createProduct({ name: 'Tuerca M3', unit: 'unit', minimum_quantity: 10 });
      const afterInsertSnap = captureDatabaseSnapshot(roDb);
      const diffInsert = diffDatabaseSnapshots(baseSnap, afterInsertSnap);
      assert.equal(diffInsert.identical, false, 'Prueba 1: Debe detectar inserciones');
      assert.ok(
        diffInsert.modified_tables.some(t => t.table === 'products' && t.before_count === 0 && t.after_count === 2),
        'Prueba 1: Identifica exactamente la inserción en products'
      );

      // 2. Detección de ACTUALIZACIÓN de una columna existente (COUNT(*) permanece en 2)
      rwDb.prepare('UPDATE products SET minimum_quantity = ? WHERE id = ?').run(25, prodA.id);
      const afterUpdateSnap = captureDatabaseSnapshot(roDb);
      const diffUpdate = diffDatabaseSnapshots(afterInsertSnap, afterUpdateSnap);
      assert.equal(diffUpdate.identical, false, 'Prueba 2/3: Debe detectar UPDATE de columna sin cambio en COUNT(*)');
      assert.equal(diffUpdate.modified_tables.length, 1);
      assert.equal(diffUpdate.modified_tables[0].table, 'products');
      assert.equal(diffUpdate.modified_tables[0].before_count, 2);
      assert.equal(diffUpdate.modified_tables[0].after_count, 2);

      // 3. Detección de MODIFICACIÓN DE CONTENIDO manteniendo constante COUNT(*) (DELETE + INSERT compensado)
      rwDb.prepare('DELETE FROM products WHERE id = ?').run(prodB.id);
      const prodC = core.productService.createProduct({ name: 'Arandela M3', unit: 'unit', minimum_quantity: 10 });
      const afterSwapSnap = captureDatabaseSnapshot(roDb);
      const diffSwap = diffDatabaseSnapshots(afterUpdateSnap, afterSwapSnap);
      assert.equal(afterSwapSnap.tables.products.row_count, afterUpdateSnap.tables.products.row_count, 'El número de filas es idéntico (2)');
      assert.equal(diffSwap.identical, false, 'Prueba 4: Debe detectar reemplazo DELETE+INSERT con COUNT(*) constante');
      assert.equal(diffSwap.modified_tables[0].table, 'products');

      // 4. Detección de ELIMINACIÓN de registro
      rwDb.prepare('DELETE FROM products WHERE id = ?').run(prodC.id);
      const afterDeleteSnap = captureDatabaseSnapshot(roDb);
      const diffDelete = diffDatabaseSnapshots(afterSwapSnap, afterDeleteSnap);
      assert.equal(diffDelete.identical, false, 'Prueba 2: Debe detectar eliminación de fila');
      assert.ok(
        diffDelete.modified_tables.some(t => t.table === 'products' && t.before_count === 2 && t.after_count === 1),
        'Prueba 2: Identifica reducción de registros en products'
      );

      // 5. Operación legítima de LECTURA que no produce cambios persistentes
      const beforeReadSnap = captureDatabaseSnapshot(roDb);
      const listed = core.executeOperation({ operation_type: 'inventory.products.list', payload: {} });
      assert.equal(listed.success, true);
      assert.equal(listed.result.length, 1);
      const afterReadSnap = captureDatabaseSnapshot(roDb);
      assertDatabaseSnapshotsEqual(afterReadSnap, beforeReadSnap, 'Prueba 5: Una lectura legítima produce cero cambios en el snapshot');
    } finally {
      core.shutdown();
      dirs.cleanup();
    }

    // Comprobación adicional de compatibilidad SQLite (§3.3): tablas WITHOUT ROWID, claves compuestas y tipos NULL/número/texto/BLOB
    const memDb = new DatabaseSync(':memory:');
    try {
      memDb.exec(`
        CREATE TABLE kv_without_rowid (
          ns TEXT NOT NULL,
          k TEXT NOT NULL,
          n_val REAL,
          b_val BLOB,
          PRIMARY KEY (ns, k)
        ) WITHOUT ROWID;
      `);
      memDb.prepare('INSERT INTO kv_without_rowid (ns, k, n_val, b_val) VALUES (?, ?, ?, ?)').run(
        'cfg',
        'alpha',
        null,
        Buffer.from([0x00, 0xff, 0x42])
      );
      const s1 = captureDatabaseSnapshot(memDb);
      assert.equal(s1.tables.kv_without_rowid.without_rowid, true);
      assert.deepEqual(s1.tables.kv_without_rowid.primary_key, ['ns', 'k']);

      // Cambiar NULL -> 'null' (texto) o alterar un byte de BLOB debe detectarse sin ambigüedad
      memDb.prepare('UPDATE kv_without_rowid SET b_val = ? WHERE ns = ? AND k = ?').run(
        Buffer.from([0x00, 0xff, 0x43]),
        'cfg',
        'alpha'
      );
      const s2 = captureDatabaseSnapshot(memDb);
      assert.equal(diffDatabaseSnapshots(s1, s2).identical, false, 'Detecta cambio de 1 byte en BLOB sobre tabla WITHOUT ROWID');
    } finally {
      memDb.close();
    }
  });
}
