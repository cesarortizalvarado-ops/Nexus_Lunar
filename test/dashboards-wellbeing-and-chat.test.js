import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNexusCore } from '../src/core/nexus-core.js';
import { createCoreHttpServer } from '../src/interfaces/http/http-server.js';
import { runCli } from '../src/interfaces/cli/nexus-cli.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-v20-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
  };
}

async function startTestServer(core) {
  const server = createCoreHttpServer(core);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return { server, baseUrl };
}

async function apiJson(baseUrl, routePath, { method = 'GET', body = undefined, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('V20 · 1 — Bienestar emocional (upsert mood_entries) y Fechas Importantes (CRUD + archive) en SQLite v20', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-28T18:00:00.000Z'),
  });
  core.initialize();
  const { server, baseUrl } = await startTestServer(core);

  try {
    assert.equal(core.persistenceService.getSchemaVersion(), 20);
    const tables = core.persistenceService
      .getReadDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('mood_entries', 'important_dates')")
      .all()
      .map((r) => r.name);
    assert.deepEqual(tables.sort(), ['important_dates', 'mood_entries']);

    // 1. Upsert idempotente por entry_date en mood_entries
    const m1 = await apiJson(baseUrl, '/api/wellbeing/moods', {
      method: 'POST',
      body: {
        entry_date: '2026-11-28',
        mood_score: 3,
        energy_level: 3,
        stress_level: 4,
        mood_label: 'stressed',
        triggers: ['entrega', 'cafe'],
        notes: 'Mañana intensa',
      },
    });
    assert.equal(m1.status, 201);
    assert.equal(m1.json.data.mood_label, 'stressed');

    const m2 = await apiJson(baseUrl, '/api/wellbeing/moods', {
      method: 'POST',
      body: {
        entry_date: '2026-11-28',
        mood_score: 5,
        energy_level: 4,
        stress_level: 1,
        mood_label: 'calm',
        triggers: ['ejercicio'],
        notes: 'Cerré bien el día',
      },
    });
    assert.equal(m2.status, 201);
    assert.equal(m2.json.data.id, m1.json.data.id);
    assert.equal(m2.json.data.mood_score, 5);
    assert.deepEqual(m2.json.data.triggers, ['ejercicio']);

    const listMoods = await apiJson(baseUrl, '/api/wellbeing/moods?from=2026-11-28&to=2026-11-28');
    assert.equal(listMoods.status, 200);
    assert.equal(listMoods.json.data.length, 1);

    // 2. Validación clínica: fecha ONCE sin año debe fallar
    const invalidOnce = await apiJson(baseUrl, '/api/wellbeing/important-dates', {
      method: 'POST',
      body: {
        title: 'Cita única sin año',
        category: 'milestone',
        month: 12,
        day: 10,
        recurrence: 'ONCE',
      },
    });
    assert.equal(invalidOnce.status, 400);

    // 3. CRUD + DELETE archive en fechas importantes
    const d1 = await apiJson(baseUrl, '/api/wellbeing/important-dates', {
      method: 'POST',
      body: {
        title: 'Cumpleaños de Ana',
        category: 'birthday',
        month: 11,
        day: 12,
        year: 1996,
        recurrence: 'ANNUAL',
        related_person: 'Ana',
      },
    });
    assert.equal(d1.status, 201);
    const dateId = d1.json.data.id;

    const dPatched = await apiJson(baseUrl, `/api/wellbeing/important-dates/${dateId}`, {
      method: 'PATCH',
      body: { notes: 'Regalar libro' },
    });
    assert.equal(dPatched.status, 200);
    assert.equal(dPatched.json.data.notes, 'Regalar libro');

    const dDeleted = await apiJson(baseUrl, `/api/wellbeing/important-dates/${dateId}`, {
      method: 'DELETE',
    });
    assert.equal(dDeleted.status, 200);
    assert.equal(dDeleted.json.data.status, 'ARCHIVED');

    const activeDates = await apiJson(baseUrl, '/api/wellbeing/important-dates');
    assert.equal(activeDates.status, 200);
    assert.equal(activeDates.json.data.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }
});

test('V20 · 2 — Dashboards Analíticos: Hábitos + Emociones (UNKNOWN explícito) y Proyectos + Metas + Finanzas', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-28T18:00:00.000Z'),
  });
  core.initialize();
  const { server, baseUrl } = await startTestServer(core);

  try {
    // Hábitos + ocurrencias + mood
    const habRes = await core.executeOperationAsync({
      operation_type: 'habits.create',
      payload: { name: 'Lectura técnica', category: 'learning', frequency: { type: 'DAILY' }, start_date: '2026-11-25' },
    });
    assert.equal(habRes.success, true);
    const habitId = habRes.result.id;

    await core.executeOperationAsync({
      operation_type: 'habits.recordOccurrence',
      payload: { id: habitId, scheduled_date: '2026-11-26', status: 'COMPLETED' },
    });
    await core.executeOperationAsync({
      operation_type: 'habits.recordOccurrence',
      payload: { id: habitId, scheduled_date: '2026-11-27', status: 'MISSED', notes: 'Jornada extendida' },
    });
    // 2026-11-28 intencionalmente sin registrar -> UNKNOWN

    await core.executeOperationAsync({
      operation_type: 'wellbeing.mood.record',
      payload: { entry_date: '2026-11-26', mood_score: 4, energy_level: 4, stress_level: 2, mood_label: 'good', triggers: ['ejercicio', 'sueño'] },
    });
    await core.executeOperationAsync({
      operation_type: 'wellbeing.mood.record',
      payload: { entry_date: '2026-11-28', mood_score: 2, energy_level: 2, stress_level: 4, mood_label: 'tired', triggers: ['ejercicio'] },
    });

    const habitsDash = await apiJson(baseUrl, '/api/dashboard/habits-mood?from=2026-11-26&to=2026-11-28');
    assert.equal(habitsDash.status, 200);
    const hd = habitsDash.json.data;
    assert.equal(hd.dailyMatrix.length, 3);
    assert.equal(hd.dailyMatrix[1].failures.length, 1);
    assert.equal(hd.dailyMatrix[2].habits.unknown, 1);
    assert.equal(hd.moodSummary.entriesCount, 2);
    assert.equal(hd.moodSummary.averageMood, 3);
    assert.equal(hd.moodSummary.topTriggers[0].trigger, 'ejercicio');
    assert.equal(hd.moodSummary.topTriggers[0].count, 2);

    // Metas, Proyectos, Tareas y Finanzas
    const goalRes = await core.executeOperationAsync({
      operation_type: 'goals.create',
      payload: {
        name: 'Certificación Cloud',
        horizon: 'MEDIUM',
        resourceImpact: {
          time: { weeklyHoursRequired: 4 },
          financial: { targetAmount: 6000, periodicContribution: 1500, currency: 'MXN', frequency: 'biweekly' },
        },
      },
    });
    assert.equal(goalRes.success, true);

    const projRes = await core.executeOperationAsync({
      operation_type: 'projects.create',
      payload: { name: 'Arquitectura Nexus', status: 'ACTIVE' },
    });
    assert.equal(projRes.success, true);
    const projectId = projRes.result.id;

    const t1 = await core.executeOperationAsync({
      operation_type: 'tasks.create',
      payload: { title: 'Diseñar v20', project_id: projectId, due_date: '2026-11-28' },
    });
    const t2 = await core.executeOperationAsync({
      operation_type: 'tasks.create',
      payload: { title: 'Documentar endpoints', project_id: projectId, due_date: '2026-11-25' },
    });
    await core.executeOperationAsync({
      operation_type: 'tasks.changeStatus',
      payload: { id: t1.result.id, status: 'COMPLETED' },
    });
    assert.equal(t2.success, true);

    const accRes = await core.executeOperationAsync({
      operation_type: 'finance.accounts.create',
      payload: { name: 'Cuenta Débito', account_type: 'BANK', currency: 'MXN' },
    });
    const accountId = accRes.result.id;
    await core.executeOperationAsync({
      operation_type: 'finance.recordIncome',
      payload: { account_id: accountId, amount: 12000, category: 'salary', description: 'Nómina' },
    });
    await core.executeOperationAsync({
      operation_type: 'finance.recordExpense',
      payload: { account_id: accountId, amount: 2500, category: 'groceries', description: 'Supermercado' },
    });

    const pgDash = await apiJson(baseUrl, '/api/dashboard/projects-goals?referenceDate=2026-11-28');
    assert.equal(pgDash.status, 200);
    const pg = pgDash.json.data;
    assert.equal(pg.summary.activeGoals, 1);
    assert.equal(pg.projects.length, 1);
    assert.equal(pg.projects[0].task_completion_ratio, 0.5);
    assert.equal(pg.projects[0].overdueTasksCount, 1);
    assert.equal(pg.financeSummary.currencies.MXN.calculated_balance, 9500);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }
});

test('V20 · 3 — Calendario Maestro (cumpleaños turnsAge, pagos recurrentes paid/unpaid, eventos locales y sábado)', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-28T18:00:00.000Z'),
  });
  core.initialize();
  const { server, baseUrl } = await startTestServer(core);

  try {
    const profRes = await core.executeOperationAsync({
      operation_type: 'spaces.profile.save',
      payload: {
        profile: {
          biometrics: { birthDate: '1990-05-10', heightCm: 175, currentWeightKg: 79, sex: 'male' },
          employments: [
            {
              type: 'fixed',
              title: 'Consultor',
              workingHoursWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
              income: { amount: 30000, frequency: 'monthly' },
            },
          ],
          recurringCommitments: [
            { name: 'Renta', amount: 8500, frequency: 'monthly', dueDayOfMonth: 5 },
            { name: 'Netflix', amount: 219, frequency: 'monthly', dueDayOfMonth: 15 },
          ],
        },
        recordedAt: '2026-11-01T10:00:00.000Z',
      },
    });
    assert.equal(profRes.success, true);
    await core.executeOperationAsync({
      operation_type: 'spaces.commitments.pay',
      payload: { commitmentName: 'Renta', amount: 8500, periodKey: '2026-11', paidAt: '2026-11-05T12:00:00.000Z' },
    });

    await core.executeOperationAsync({
      operation_type: 'wellbeing.dates.create',
      payload: {
        title: 'Cumpleaños de Ana',
        category: 'birthday',
        month: 11,
        day: 12,
        year: 1996,
        recurrence: 'ANNUAL',
      },
    });

    await core.executeOperationAsync({
      operation_type: 'calendar.createEvent',
      payload: {
        title: 'Revisión mensual',
        start_at: '2026-11-28T16:00:00.000Z',
        end_at: '2026-11-28T17:00:00.000Z',
      },
    });

    const calRes = await apiJson(baseUrl, '/api/dashboard/calendar?year=2026&month=11');
    assert.equal(calRes.status, 200);
    const cal = calRes.json.data;

    const bday = cal.items.find((i) => i.type === 'important_date');
    assert.ok(bday);
    assert.equal(bday.metadata.turnsAge, 30);

    const renta = cal.items.find((i) => i.type === 'recurring_payment' && i.title === 'Renta');
    const netflix = cal.items.find((i) => i.type === 'recurring_payment' && i.title === 'Netflix');
    assert.equal(renta.metadata.paid, true);
    assert.equal(netflix.metadata.paid, false);

    const ev = cal.items.find((i) => i.type === 'calendar_event');
    assert.ok(ev);
    assert.equal(ev.date, '2026-11-28');

    const sat = cal.days.find((d) => d.date === '2026-11-28');
    assert.equal(sat.isSaturday, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }
});

test('V20 · 4 — Chat Persistente Unificado (deterministic_local, propuestas no auto-ejecutadas, revisión del sábado sin sellar) + CLI', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-28T18:00:00.000Z'),
  });
  core.initialize();
  const { server, baseUrl } = await startTestServer(core);

  try {
    const profSave = await core.executeOperationAsync({
      operation_type: 'spaces.profile.save',
      payload: {
        profile: {
          biometrics: { birthDate: '1990-05-10', heightCm: 175, currentWeightKg: 80, sex: 'male' },
          employments: [
            {
              type: 'fixed',
              title: 'Consultor',
              workingHoursWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
              income: { amount: 30000, frequency: 'monthly' },
            },
          ],
          recurringCommitments: [
            { name: 'Netflix', amount: 219, frequency: 'monthly', dueDayOfMonth: 15 },
          ],
        },
        recordedAt: '2026-11-20T10:00:00.000Z',
      },
    });
    assert.equal(profSave.success, true);
    const goalSave = await core.executeOperationAsync({
      operation_type: 'goals.create',
      payload: {
        name: 'Ahorro 2026',
        horizon: 'MEDIUM',
        resourceImpact: {
          time: { weeklyHoursRequired: 3 },
          financial: { targetAmount: 12000, periodicContribution: 1000, currency: 'MXN', frequency: 'monthly' },
        },
      },
    });
    assert.equal(goalSave.success, true);

    // Turno 1: extracción determinista de 2 propuestas sin mutar SQLite
    const chat1 = await apiJson(baseUrl, '/api/copilot/chat', {
      method: 'POST',
      body: {
        message: 'Hoy estoy en 78.2 kg y pagué Netflix 219. ¿Cómo van mis metas y finanzas?',
        referenceDate: '2026-11-28',
      },
    });
    assert.equal(chat1.status, 200);
    const c1 = chat1.json.data;
    assert.equal(c1.mode, 'deterministic_local');
    assert.equal(c1.aiAvailable, false);
    assert.equal(c1.acceptedProposals.length, 2);
    assert.equal(c1.acceptedProposals.every((p) => p.canAutoExecute === false), true);
    assert.equal(core.specializedSpacesService.getSnapshot().profile.biometrics.currentWeightKg, 80);

    const convs = await apiJson(baseUrl, '/api/copilot/conversations');
    assert.equal(convs.status, 200);
    assert.equal(convs.json.data.length, 1);

    const msgs = await apiJson(baseUrl, `/api/copilot/conversations/${c1.conversationId}/messages`);
    assert.equal(msgs.status, 200);
    assert.equal(msgs.json.data.length, 2);
    assert.equal(msgs.json.data[0].role, 'USER');
    assert.equal(msgs.json.data[1].role, 'ASSISTANT');

    // Turno 2: intención de Revisión del Sábado sin sellar baseline automáticamente
    const chat2 = await apiJson(baseUrl, '/api/copilot/chat', {
      method: 'POST',
      body: {
        conversationId: c1.conversationId,
        message: 'Ayúdame con la revisión del sábado para el plan semanal',
        referenceDate: '2026-11-28',
      },
    });
    assert.equal(chat2.status, 200);
    const c2 = chat2.json.data;
    assert.ok(c2.saturdayReview);
    assert.equal(c2.saturdayReview.status, 'awaiting_human_approval');
    assert.ok(c2.saturdayReview.briefingMarkdown.length > 20);
    assert.equal(core.specializedSpacesService.listBaselines().length, 0);

    // CLI integration (dashboard + copilot chat)
    const cliOutputs = [];
    const cliConfig = {
      dataDir: dirs.dataDir,
      backupDir: dirs.backupDir,
      timezone: 'America/Mexico_City',
      nowFn: () => new Date('2026-11-28T18:00:00.000Z'),
    };
    const codeDash = await runCli(
      ['dashboard', 'calendar', '--date', '2026-11-28'],
      cliConfig,
      { stdout: (txt) => cliOutputs.push(txt), stderr: () => {} }
    );
    assert.equal(codeDash, 0);
    const calCliJson = JSON.parse(cliOutputs[0]);
    assert.equal(calCliJson.year, 2026);
    assert.equal(calCliJson.month, 11);

    cliOutputs.length = 0;
    const codeChat = await runCli(
      ['copilot', 'chat', '--id', c1.conversationId, '--text', 'Resume mis metas'],
      cliConfig,
      { stdout: (txt) => cliOutputs.push(txt), stderr: () => {} }
    );
    assert.equal(codeChat, 0);
    const chatCliJson = JSON.parse(cliOutputs[0]);
    assert.equal(chatCliJson.conversationId, c1.conversationId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }
});

test('V20 · 5 — Rutas REST por área (Metas, Proyectos, Tareas, Finanzas, Inventario, Conocimiento) y NL-SEC-HTTP-001', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-28T18:00:00.000Z'),
  });
  core.initialize();
  const { server, baseUrl } = await startTestServer(core);

  try {
    // Goals / Projects / Tasks status & archive
    const g = await apiJson(baseUrl, '/api/goals', { method: 'POST', body: { name: 'Meta REST', horizon: 'SHORT' } });
    assert.equal(g.status, 201);
    const gPatch = await apiJson(baseUrl, `/api/goals/${g.json.data.id}/status`, { method: 'PATCH', body: { status: 'ON_HOLD' } });
    assert.equal(gPatch.status, 200);
    assert.equal(gPatch.json.data.status, 'ON_HOLD');
    const gDel = await apiJson(baseUrl, `/api/goals/${g.json.data.id}`, { method: 'DELETE' });
    assert.equal(gDel.status, 200);
    assert.equal(gDel.json.data.status, 'ARCHIVED');

    const p = await apiJson(baseUrl, '/api/projects', { method: 'POST', body: { name: 'Proyecto REST' } });
    assert.equal(p.status, 201);
    const pPatch = await apiJson(baseUrl, `/api/projects/${p.json.data.id}/status`, { method: 'PATCH', body: { status: 'ACTIVE' } });
    assert.equal(pPatch.status, 200);
    const pDel = await apiJson(baseUrl, `/api/projects/${p.json.data.id}`, { method: 'DELETE' });
    assert.equal(pDel.status, 200);

    const t = await apiJson(baseUrl, '/api/tasks', { method: 'POST', body: { title: 'Tarea REST' } });
    assert.equal(t.status, 201);
    const tDel = await apiJson(baseUrl, `/api/tasks/${t.json.data.id}`, { method: 'DELETE' });
    assert.equal(tDel.status, 200);

    // Finance routes
    const acc = await apiJson(baseUrl, '/api/finance/accounts', { method: 'POST', body: { name: 'Efectivo', account_type: 'CASH', currency: 'MXN' } });
    const inc = await apiJson(baseUrl, '/api/finance/income', { method: 'POST', body: { account_id: acc.json.data.id, amount: 500, category: 'bonus', description: 'Bono' } });
    assert.equal(inc.status, 201);
    const exp = await apiJson(baseUrl, '/api/finance/expense', { method: 'POST', body: { account_id: acc.json.data.id, amount: 120, category: 'food', description: 'Comida' } });
    assert.equal(exp.status, 201);
    const txs = await apiJson(baseUrl, '/api/finance/transactions');
    assert.equal(txs.status, 200);
    assert.equal(txs.json.data.length, 2);

    // Inventory routes
    const prod = await apiJson(baseUrl, '/api/inventory/products', { method: 'POST', body: { name: 'Avena', unit: 'g', minimum_quantity: 200 } });
    assert.equal(prod.status, 201);
    const reg = await apiJson(baseUrl, '/api/inventory/stock', { method: 'POST', body: { product_id: prod.json.data.id, quantity: 1000 } });
    assert.equal(reg.status, 201);
    const cons = await apiJson(baseUrl, '/api/inventory/consumption', { method: 'POST', body: { product_id: prod.json.data.id, quantity: 250, reason: 'Desayuno' } });
    assert.equal(cons.status, 201);
    const stock = await apiJson(baseUrl, '/api/inventory/stock');
    assert.equal(stock.status, 200);
    assert.equal(stock.json.data[0].quantity, 750);

    // Knowledge routes
    const lib = await apiJson(baseUrl, '/api/libraries', { method: 'POST', body: { name: 'Notas Personales', category: 'general' } });
    const doc = await apiJson(baseUrl, '/api/knowledge/documents', {
      method: 'POST',
      body: { library_id: lib.json.data.id, title: 'Bitácora semanal', content: 'Contenido clave' },
    });
    assert.equal(doc.status, 201);
    const search = await apiJson(baseUrl, '/api/knowledge/documents?q=Bitácora');
    assert.equal(search.status, 200);
    assert.equal(search.json.data.length, 1);

    // NL-SEC-HTTP-001: mutación sobre GET bloqueada con 405
    const badGetMutation = await apiJson(baseUrl, '/api/operations?operation_type=wellbeing.mood.record');
    assert.equal(badGetMutation.status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }
});
