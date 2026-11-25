import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { evaluateGoalFeasibility } from '../src/application/personal/goal-feasibility-evaluator.js';
import { createCoreHttpServer } from '../src/interfaces/http/http-server.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-v19-sanit-'));
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
    const payloadStr = body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const finalHeaders = {
      Host: `127.0.0.1:${port}`,
      ...(payloadStr !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payloadStr) } : {}),
      ...headers,
    };
    const req = http.request(
      { host: '127.0.0.1', port, method, path: reqPath, headers: finalHeaders },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            // ignore non-json
          }
          resolve({ statusCode: res.statusCode, headers: res.headers, rawBody: data, json });
        });
      }
    );
    req.on('error', reject);
    if (payloadStr !== null) req.write(payloadStr);
    req.end();
  });
}

test('V19 · 1 — Persistencia real de resourceImpact en SQLite v19 y detección de colisión financiera automática en Sábado', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-28T18:00:00.000Z'),
  });

  try {
    assert.equal(core.persistenceService.getSchemaVersion(), 19);

    // Flujo quincenal libre: 5000 - 3000 = 2000 MXN
    await core.executeOperationAsync({
      operation_type: 'spaces.profile.save',
      payload: {
        profile: {
          biometrics: { birthDate: '1985-06-05', heightCm: 158, currentWeightKg: 80, sex: 'male' },
          employments: [
            {
              type: 'fixed',
              title: 'Empleo Base',
              workingHoursWindows: [{ dayOfWeek: 1, startHour: 8, endHour: 17 }],
              income: { amount: 5000, frequency: 'biweekly' },
            },
          ],
          recurringCommitments: [{ name: 'Gastos Fijos', amount: 3000, frequency: 'biweekly' }],
        },
        recordedAt: '2026-11-20T10:00:00.000Z',
      },
    });

    // Crear 2 metas reales en SQLite con resourceImpact (1500 + 800 = 2300 > 2000)
    const g1 = await core.executeOperationAsync({
      operation_type: 'goals.create',
      payload: {
        name: 'Comprar RTX 3060',
        resourceImpact: {
          financial: { targetAmount: 6000, periodicContribution: 1500, currency: 'MXN', frequency: 'biweekly' },
        },
      },
    });
    const g2 = await core.executeOperationAsync({
      operation_type: 'goals.create',
      payload: {
        name: 'Fondo 2027',
        resourceImpact: {
          financial: { targetAmount: 20000, periodicContribution: 800, currency: 'MXN', frequency: 'biweekly' },
        },
      },
    });
    assert.equal(g1.success && g2.success, true);
    assert.equal(core.goalService.getGoal(g1.result.id).resourceImpact.financial.periodicContribution, 1500);

    // Ejecutar saturday.review.prepare SIN pasar activeGoals manuales
    const prep = await core.executeOperationAsync({
      operation_type: 'saturday.review.prepare',
      payload: {
        nextWeekStartDate: '2026-11-29',
        referenceDate: '2026-11-28',
        weeklyGroceryBudget: 1000,
      },
    });
    assert.equal(prep.success, true);

    const feasibility = prep.result.nextWeekDraft.feasibilityReport;
    assert.equal(feasibility.feasible, false);
    assert.equal(feasibility.totals.financialBiweekly, 2300);
    assert.equal(feasibility.conflicts.length, 1);
    assert.equal(feasibility.conflicts[0].resource, 'financial');
    assert.equal(feasibility.conflicts[0].deficit, 300);
    assert.equal(feasibility.conflicts[0].competingGoals.length, 2);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('V19 · 2 — Cálculo corregido de horas discrecionales semanales (168 - 56 - 21 - bloqueadas)', () => {
  const profile = {
    biometrics: { birthDate: '1985-06-05', heightCm: 170, currentWeightKg: 75, sex: 'male' },
    employments: [
      {
        type: 'fixed',
        title: 'Oficina 45h',
        workingHoursWindows: [
          { dayOfWeek: 1, startHour: 9, endHour: 18 },
          { dayOfWeek: 2, startHour: 9, endHour: 18 },
          { dayOfWeek: 3, startHour: 9, endHour: 18 },
          { dayOfWeek: 4, startHour: 9, endHour: 18 },
          { dayOfWeek: 5, startHour: 9, endHour: 18 },
        ], // 45h
        income: { amount: 8000, frequency: 'biweekly' },
      },
      {
        type: 'freelance',
        title: 'Estudio 10h',
        targetWeeklyHours: 10,
        historicalIncomes: [{ amount: 2000 }],
      },
    ], // Total bloqueado = 55h -> discrecional = 168 - 56 - 21 - 55 = 36h
  };

  const report = evaluateGoalFeasibility(
    [
      {
        id: 'goal-10h',
        name: 'Proyecto estudio 10h',
        status: 'ACTIVE',
        resourceImpact: { time: { weeklyHoursRequired: 10 } },
      },
    ],
    {},
    profile
  );

  assert.equal(report.limits.discretionaryWeeklyHours, 36);
  assert.equal(report.surplus.weeklyHours, 26);
  assert.equal(report.feasible, true);
});

test('V19 · 3 — Zona horaria local America/Mexico_City y mapeo de compromisos con due_at sin end_at', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
  });

  try {
    // Martes 2026-12-01 19:00-20:00 CST = 2026-12-02 01:00-02:00 UTC
    const ev = await core.executeOperationAsync({
      operation_type: 'calendar.createEvent',
      payload: {
        title: 'Clase nocturna local',
        start_at: '2026-12-01T19:00:00-06:00',
        end_at: '2026-12-01T20:00:00-06:00',
        timezone: 'America/Mexico_City',
      },
    });
    assert.equal(ev.success, true);

    // Miércoles 2026-12-02 15:00 CST (sin end_at -> bloque 1h 15:00-16:00)
    const comm = await core.executeOperationAsync({
      operation_type: 'commitments.create',
      payload: {
        title: 'Entrega reporte',
        due_at: '2026-12-02T15:00:00-06:00',
      },
    });
    assert.equal(comm.success, true);

    const assembled = core.weeklyContextAssembler.assembleWeeklyInputs({
      weekStartDate: '2026-11-29',
    });

    const mappedEvent = assembled.fixedCommitments.find((c) => c.title === 'Clase nocturna local');
    assert.ok(mappedEvent, 'El evento nocturno debe caer en la semana local');
    assert.equal(mappedEvent.dayOfWeek, 2); // Martes
    assert.equal(mappedEvent.startHour, 19);
    assert.equal(mappedEvent.endHour, 20);

    const mappedComm = assembled.fixedCommitments.find((c) => c.title === 'Entrega reporte');
    assert.ok(mappedComm, 'El compromiso due_at debe mapearse como bloque de 1 hora');
    assert.equal(mappedComm.dayOfWeek, 3); // Miércoles
    assert.equal(mappedComm.startHour, 15);
    assert.equal(mappedComm.endHour, 16);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('V19 · 4 — Periodicidad multi-frecuencia de compromisos y enlace atómico con Finanzas', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
  });

  try {
    await core.executeOperationAsync({
      operation_type: 'spaces.profile.save',
      payload: {
        profile: {
          biometrics: { birthDate: '1990-01-01', heightCm: 170, currentWeightKg: 70, sex: 'male' },
          employments: [
            {
              type: 'fixed',
              workingHoursWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
              income: { amount: 10000, frequency: 'biweekly' },
            },
          ],
          recurringCommitments: [
            { name: 'Supermercado', amount: 1200, frequency: 'weekly' },
            { name: 'Renta Q', amount: 3000, frequency: 'biweekly', dueDayOfMonth: 1 },
            { name: 'Internet', amount: 500, frequency: 'monthly', dueDayOfMonth: 15 },
            { name: 'Predial Anual', amount: 2400, frequency: 'annual', dueMonth: 11, dueDayOfMonth: 10 },
          ],
        },
        recordedAt: '2026-11-01T10:00:00.000Z',
      },
    });

    // Crear cuenta financiera con $10,000 MXN iniciales
    const accRes = await core.executeOperationAsync({
      operation_type: 'finance.accounts.create',
      payload: { name: 'Banco Principal', currency: 'MXN' },
    });
    const accountId = accRes.result.id;
    await core.executeOperationAsync({
      operation_type: 'finance.recordIncome',
      payload: { account_id: accountId, amount: 10000, category: 'salary', description: 'Nómina' },
    });

    // Pagar anual el 12 de noviembre enlazado a account_id
    const payAnnual = await core.executeOperationAsync({
      operation_type: 'spaces.commitments.pay',
      payload: {
        commitmentName: 'Predial Anual',
        amount: 2400,
        paidAt: '2026-11-12T12:00:00.000Z',
        account_id: accountId,
      },
    });
    assert.equal(payAnnual.success, true);
    assert.equal(payAnnual.result.periodKey, '2026');
    assert.equal(payAnnual.result.financeTransaction.transaction_type, 'EXPENSE');

    // Verificar descuento en Finanzas: 10000 - 2400 = 7600
    const balRes = await core.executeOperationAsync({
      operation_type: 'finance.accounts.balance',
      payload: { id: accountId },
    });
    assert.equal(balRes.result.calculated_balance, 7600);
    const txs = await core.executeOperationAsync({
      operation_type: 'finance.transactions.list',
      payload: { account_id: accountId },
    });
    assert.ok(txs.result.some((t) => t.transaction_type === 'EXPENSE' && t.description.includes('Predial Anual')));

    // El anual pagado en noviembre NO debe alertar en diciembre
    const unpaidDec = core.specializedSpacesService.detectUnpaidCommitments('2026-12-20');
    assert.equal(unpaidDec.some((u) => u.commitmentName === 'Predial Anual'), false);

    // Pagar quincenal el 5 de noviembre (Q1) -> debe volver a alertar el 20 de noviembre (Q2)
    await core.executeOperationAsync({
      operation_type: 'spaces.commitments.pay',
      payload: {
        commitmentName: 'Renta Q',
        amount: 3000,
        paidAt: '2026-11-05T12:00:00.000Z',
      },
    });
    const unpaidNov10 = core.specializedSpacesService.detectUnpaidCommitments('2026-11-10');
    assert.equal(unpaidNov10.some((u) => u.commitmentName === 'Renta Q'), false);

    const unpaidNov20 = core.specializedSpacesService.detectUnpaidCommitments('2026-11-20');
    const rentaQ2 = unpaidNov20.find((u) => u.commitmentName === 'Renta Q');
    assert.ok(rentaQ2, 'El compromiso biweekly pagado en Q1 debe alertar en Q2');
    assert.equal(rentaQ2.periodKey, '2026-11-Q2');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('V19 · 5 — HTTP modular, CSP con media-src blob:, /api/spaces/catalog y bloqueo de path traversal', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
  });
  const server = createCoreHttpServer(core);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const catRes = await sendRawHttp(port, { method: 'GET', reqPath: '/api/spaces/catalog' });
    assert.equal(catRes.statusCode, 200);
    assert.ok(catRes.headers['content-security-policy']?.includes("media-src 'self' blob:"));
    assert.ok(catRes.json?.data?.clinicalRanges?.fastingGlucose);
    assert.ok(Array.isArray(catRes.json?.data?.standardExercises));

    const healthRes = await sendRawHttp(port, { method: 'GET', reqPath: '/health' });
    assert.equal(healthRes.statusCode, 200);
    assert.equal(healthRes.json?.ai_integrated, false);
    assert.equal(healthRes.json?.ollama_configured, false);
    assert.equal(healthRes.json?.ollama_model, null);

    // Intentos de path traversal jamás deben exponer archivos fuera de public/
    const trav1 = await sendRawHttp(port, { method: 'GET', reqPath: '/js/../../package.json' });
    assert.ok(trav1.statusCode === 404 || trav1.statusCode === 400);
    assert.equal(trav1.rawBody.includes('"nexus-lunar"'), false);

    const trav2 = await sendRawHttp(port, { method: 'GET', reqPath: '/js/%2e%2e/package.json' });
    assert.ok(trav2.statusCode === 404 || trav2.statusCode === 400);
    assert.equal(trav2.rawBody.includes('"nexus-lunar"'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    dirs.cleanup();
  }
});
