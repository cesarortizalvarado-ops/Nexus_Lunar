import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { verifyBaselineIntegrity } from '../src/domain/planning/weekly-baseline-contract.js';
import { createCoreHttpServer } from '../src/interfaces/http/http-server.js';
import { runCli } from '../src/interfaces/cli/nexus-cli.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-spaces-b5-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function sendHttp(port, { method = 'GET', reqPath = '/health', headers = {}, body = null } = {}) {
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

const sampleProfile = {
  biometrics: { birthDate: '1985-06-05', heightCm: 158, currentWeightKg: 80, sex: 'male' },
  employments: [
    {
      type: 'fixed',
      title: 'Trabajo Base',
      workingHoursWindows: [
        { dayOfWeek: 1, startHour: 8, endHour: 15 },
        { dayOfWeek: 1, startHour: 16, endHour: 18 },
      ],
      income: { amount: 6000, frequency: 'biweekly' },
    },
    {
      type: 'freelance',
      title: 'Audio Lab',
      targetWeeklyHours: 4,
      historicalIncomes: [{ amount: 2000 }],
    },
  ],
  recurringCommitments: [
    { name: 'Netflix', amount: 220, frequency: 'monthly', dueDayOfMonth: 15 },
  ],
  preferences: { dislikedIngredients: ['hígado'] },
};

const sampleRecipes = [
  {
    id: 'r-b',
    name: 'Omelette proteico',
    category: 'breakfast',
    prepTimeMinutes: 10,
    servings: 1,
    caloriesPerServing: 450,
    macros: { proteinGrams: 32, carbsGrams: 10, fatGrams: 18 },
    ingredients: [{ itemId: 'egg', itemName: 'Huevo', requiredQuantity: 3, unit: 'unit' }],
  },
  {
    id: 'r-l',
    name: 'Pollo con verduras',
    category: 'lunch',
    prepTimeMinutes: 25,
    servings: 1,
    caloriesPerServing: 650,
    macros: { proteinGrams: 50, carbsGrams: 22, fatGrams: 16 },
    ingredients: [{ itemId: 'chicken', itemName: 'Pollo', requiredQuantity: 250, unit: 'g' }],
  },
  {
    id: 'r-d',
    name: 'Atún con ensalada',
    category: 'dinner',
    prepTimeMinutes: 10,
    servings: 1,
    caloriesPerServing: 500,
    macros: { proteinGrams: 35, carbsGrams: 14, fatGrams: 20 },
    ingredients: [{ itemId: 'tuna', itemName: 'Atún', requiredQuantity: 140, unit: 'g' }],
  },
];

test('BLOQUE 5 · 1 — SQLite v18 + Respaldo y Restauración íntegra de Espacios Especializados y Baseline SHA-256', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-21T18:00:00.000Z'),
  });

  try {
    assert.equal(core.persistenceService.getSchemaVersion(), 20);

    const saveProf = await core.executeOperationAsync({
      operation_type: 'spaces.profile.save',
      payload: { profile: sampleProfile, recordedAt: '2026-11-01T10:00:00.000Z' },
    });
    assert.equal(saveProf.success, true);

    const updBio = await core.executeOperationAsync({
      operation_type: 'spaces.biometrics.update',
      payload: { currentWeightKg: 79.5, recordedAt: '2026-11-20T10:00:00.000Z' },
    });
    assert.equal(updBio.success, true);

    const labRes = await core.executeOperationAsync({
      operation_type: 'spaces.clinical.record',
      payload: { triglycerides: 185, recordedAt: '2026-11-18T09:00:00.000Z' },
    });
    assert.equal(labRes.success, true);
    assert.equal(labRes.result.evaluation.hasAlerts, true);

    const payRes = await core.executeOperationAsync({
      operation_type: 'spaces.commitments.pay',
      payload: { commitmentName: 'Netflix', amount: 220, paidAt: '2026-11-21T12:00:00.000Z' },
    });
    assert.equal(payRes.success, true);

    const prepRes = await core.executeOperationAsync({
      operation_type: 'saturday.review.prepare',
      payload: {
        nextWeekStartDate: '2026-11-22',
        referenceDate: '2026-11-21',
        libraries: { recipes: sampleRecipes },
        weeklyGroceryBudget: 1200,
        exerciseScheduleRequests: [
          { exerciseId: 'ex-walk-brisk', daysOfWeek: [1], durationMinutes: 30, preferredStartHour: 6.5 },
        ],
      },
    });
    assert.equal(prepRes.success, true);
    assert.ok(prepRes.result.briefingMarkdown.includes('2026-11-22'));

    const approveRes = await core.executeOperationAsync({
      operation_type: 'saturday.baseline.approve',
      payload: {
        draft: prepRes.result.nextWeekDraft,
        baselineId: 'wk-2026-47',
        approvedAt: '2026-11-21T20:00:00.000Z',
        approvedBy: 'user',
      },
    });
    assert.equal(approveRes.success, true);

    const walkBlock = approveRes.result.plan.dailySchedules[1].blocks.find((b) => b.category === 'exercise');
    const execRes = await core.executeOperationAsync({
      operation_type: 'week.execution.record',
      payload: {
        baselineId: 'wk-2026-47',
        blockId: walkBlock.id,
        status: 'completed',
      },
    });
    assert.equal(execRes.success, true);

    // Crear respaldo v18
    const bkpRes = await core.executeOperationAsync({
      operation_type: 'backup.create',
      payload: { reason: 'pre-corruption-v18' },
    });
    assert.equal(bkpRes.success, true);

    // Mutación posterior que queremos revertir al restaurar
    const corruptWeight = await core.executeOperationAsync({
      operation_type: 'spaces.biometrics.update',
      payload: { currentWeightKg: 99.9, recordedAt: '2026-11-22T10:00:00.000Z' },
    });
    assert.equal(corruptWeight.success, true);
    assert.equal(core.specializedSpacesService.getSnapshot().profile.biometrics.currentWeightKg, 99.9);

    // Autorizar y restaurar respaldo
    const authRes = await core.executeOperationAsync({
      operation_type: 'restore.authorize',
      payload: { id: bkpRes.result.id, requestedBy: 'dante' },
    });
    assert.equal(authRes.success, true);

    const restoreRes = await core.executeOperationAsync({
      operation_type: 'restore.execute',
      payload: { id: bkpRes.result.id },
      authorization: { approved: true, authorized_by: 'dante', scope: 'restore.execute' },
    });
    assert.equal(restoreRes.success, true);

    // Verificar recuperación intacta desde SQLite
    const restoredSnap = await core.executeOperationAsync({
      operation_type: 'spaces.snapshot',
      payload: { referenceDate: '2026-11-21' },
    });
    assert.equal(restoredSnap.success, true);
    assert.equal(restoredSnap.result.profile.biometrics.currentWeightKg, 79.5);
    assert.equal(restoredSnap.result.latestClinicalPanel.triglycerides, 185);
    assert.equal(restoredSnap.result.unpaidCommitments.length, 0);

    const baselineCtx = await core.executeOperationAsync({
      operation_type: 'spaces.baselines.get',
      payload: { id: 'wk-2026-47' },
    });
    assert.equal(baselineCtx.success, true);
    assert.equal(verifyBaselineIntegrity(baselineCtx.result.baseline).valid, true);
    assert.equal(baselineCtx.result.executionLog.length, 1);
    assert.equal(baselineCtx.result.executionLog[0].status, 'completed');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('BLOQUE 5 · 2 — Ensamblador automático desde SQLite alimenta saturday.review.prepare sin bibliotecas manuales', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-21T18:00:00.000Z'),
  });

  try {
    await core.executeOperationAsync({
      operation_type: 'spaces.profile.save',
      payload: { profile: sampleProfile, recordedAt: '2026-11-20T10:00:00.000Z' },
    });

    const goalRes = await core.executeOperationAsync({
      operation_type: 'goals.create',
      payload: { name: 'Dominar arquitectura modular', horizon: 'MEDIUM_TERM' },
    });
    assert.equal(goalRes.success, true);

    const prodRes = await core.executeOperationAsync({
      operation_type: 'inventory.products.create',
      payload: { name: 'Huevo orgánico', unit: 'unit', reference_price: 4, minimum_quantity: 2 },
    });
    assert.equal(prodRes.success, true);

    const stockRes = await core.executeOperationAsync({
      operation_type: 'inventory.stock.register',
      payload: { product_id: prodRes.result.id, quantity: 2, unit: 'unit' },
    });
    assert.equal(stockRes.success, true);

    const libRes = await core.executeOperationAsync({
      operation_type: 'knowledge.libraries.create',
      payload: { name: 'Recetario Clínico' },
    });
    assert.equal(libRes.success, true);

    const makeDocRecipe = (id, name, category, calories, ingredients) =>
      core.executeOperationAsync({
        operation_type: 'knowledge.documents.create',
        payload: {
          library_id: libRes.result.id,
          title: name,
          document_type: 'JSON',
          content: JSON.stringify({
            id,
            name,
            category,
            prepTimeMinutes: 10,
            servings: 1,
            caloriesPerServing: calories,
            macros: { proteinGrams: 35, carbsGrams: 20, fatGrams: 18 },
            ingredients,
          }),
        },
      });

    const d1 = await makeDocRecipe('doc-rec-b', 'Huevos al gusto', 'breakfast', 500, [
      { itemId: prodRes.result.id, itemName: 'Huevo orgánico', requiredQuantity: 2, unit: 'unit' },
    ]);
    const d2 = await makeDocRecipe('doc-rec-l', 'Pollo grill', 'lunch', 750, [
      { itemId: 'ext-chicken', itemName: 'Pechuga', requiredQuantity: 250, unit: 'g' },
    ]);
    const d3 = await makeDocRecipe('doc-rec-d', 'Salmón con ensalada', 'dinner', 650, [
      { itemId: 'ext-salmon', itemName: 'Salmón', requiredQuantity: 180, unit: 'g' },
    ]);
    assert.equal(d1.success && d2.success && d3.success, true);

    // Invocar saturday.review.prepare sin pasar libraries ni currentInventory manuales
    const prep = await core.executeOperationAsync({
      operation_type: 'saturday.review.prepare',
      payload: {
        nextWeekStartDate: '2026-11-22',
        referenceDate: '2026-11-21',
        weeklyGroceryBudget: 1500,
      },
    });
    assert.equal(prep.success, true);
    const sundayBreakfasts = prep.result.nextWeekDraft.dailySchedules[0];
    assert.equal(sundayBreakfasts.nutrition.hasValidMealPlan, true);
    const pantryItems = prep.result.nextWeekDraft.sundayPrep.pantryReport.ingredientsNeeded;
    assert.ok(pantryItems.some((i) => i.itemId === prodRes.result.id), 'Debe usar el producto real de SQLite');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('BLOQUE 5 · 3 — Flujo HTTP REST + Guardias NL-SEC-HTTP-001 y bloqueo de aprobación por IA', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-21T18:00:00.000Z'),
  });
  const server = createCoreHttpServer(core);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const resProf = await sendHttp(port, {
      method: 'POST',
      reqPath: '/api/spaces/profile',
      body: { profile: sampleProfile, recordedAt: '2026-11-01T10:00:00.000Z' },
    });
    assert.equal(resProf.statusCode, 201);

    const resBio = await sendHttp(port, {
      method: 'PATCH',
      reqPath: '/api/spaces/biometrics',
      body: { currentWeightKg: 78.8, recordedAt: '2026-11-20T10:00:00.000Z' },
    });
    assert.equal(resBio.statusCode, 200);

    const resClin = await sendHttp(port, {
      method: 'POST',
      reqPath: '/api/spaces/clinical',
      body: { triglycerides: 180, recordedAt: '2026-11-20T11:00:00.000Z' },
    });
    assert.equal(resClin.statusCode, 201);

    const resSnap = await sendHttp(port, {
      method: 'GET',
      reqPath: '/api/spaces/snapshot?referenceDate=2026-11-21',
    });
    assert.equal(resSnap.statusCode, 200);
    assert.equal(resSnap.json.data.profile.biometrics.currentWeightKg, 78.8);

    const resPrep = await sendHttp(port, {
      method: 'POST',
      reqPath: '/api/planning/saturday/prepare',
      body: {
        nextWeekStartDate: '2026-11-22',
        referenceDate: '2026-11-21',
        libraries: { recipes: sampleRecipes },
        weeklyGroceryBudget: 1000,
        exerciseScheduleRequests: [
          { exerciseId: 'ex-walk-brisk', daysOfWeek: [1], durationMinutes: 30, preferredStartHour: 6.5 },
        ],
      },
    });
    assert.equal(resPrep.statusCode, 200);
    const draft = resPrep.json.data.nextWeekDraft;

    // Bloqueo cuando actor_type === 'AI_ASSISTANT' (tanto sin autorización como con autorización delegada)
    const aiApproveNoAuth = await sendHttp(port, {
      method: 'POST',
      reqPath: '/api/operations',
      body: {
        operation_type: 'saturday.baseline.approve',
        payload: { draft, baselineId: 'wk-ai-fail-1' },
        source: { actor_type: 'AI_ASSISTANT', actor_id: 'copilot-test' },
      },
    });
    assert.equal(aiApproveNoAuth.statusCode, 403);

    const aiApproveWithAuth = await sendHttp(port, {
      method: 'POST',
      reqPath: '/api/operations',
      body: {
        operation_type: 'saturday.baseline.approve',
        payload: { draft, baselineId: 'wk-ai-fail-2' },
        source: { actor_type: 'AI_ASSISTANT', actor_id: 'copilot-test' },
        authorization: { approved: true, authorized_by: 'dante', scope: 'saturday.baseline.approve' },
      },
    });
    assert.equal(aiApproveWithAuth.statusCode, 403);
    assert.match(aiApproveWithAuth.json.errors[0].description, /HUMAN_APPROVAL_REQUIRED/);

    // Aprobación humana legítima
    const resApprove = await sendHttp(port, {
      method: 'POST',
      reqPath: '/api/planning/saturday/approve',
      body: { draft, baselineId: 'wk-http-01', approvedAt: '2026-11-21T20:00:00.000Z' },
    });
    assert.equal(resApprove.statusCode, 201);

    const resList = await sendHttp(port, { method: 'GET', reqPath: '/api/planning/baselines' });
    assert.equal(resList.statusCode, 200);
    assert.equal(resList.json.data.length, 1);

    const resGet = await sendHttp(port, { method: 'GET', reqPath: '/api/planning/baselines/wk-http-01' });
    assert.equal(resGet.statusCode, 200);

    const walkBlock = resGet.json.data.baseline.plan.dailySchedules[1].blocks.find((b) => b.category === 'exercise');
    const resExec = await sendHttp(port, {
      method: 'POST',
      reqPath: '/api/planning/baselines/wk-http-01/executions',
      body: { blockId: walkBlock.id, status: 'completed' },
    });
    assert.equal(resExec.statusCode, 201);

    const resCopilot = await sendHttp(port, {
      method: 'POST',
      reqPath: '/api/copilot/proposals',
      body: { text: 'Hoy peso 78.5 kg y pagué Netflix 220' },
    });
    assert.equal(resCopilot.statusCode, 200);
    assert.equal(resCopilot.json.data.mode, 'deterministic_fallback');
    assert.equal(resCopilot.json.data.acceptedProposals.length, 2);

    // NL-SEC-HTTP-001: GET a /api/operations con mutación bloqueado con 405
    const badGetMutation = await sendHttp(port, {
      method: 'GET',
      reqPath: '/api/operations?operation_type=spaces.profile.save',
    });
    assert.equal(badGetMutation.statusCode, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    dirs.cleanup();
  }
});

test('BLOQUE 5 · 4 — Flujo CLI para spaces y copilot devuelve código 0 y JSON válido', async () => {
  const dirs = makeTempDirs();
  const cfg = { dataDir: dirs.dataDir, backupDir: dirs.backupDir };

  try {
    const out1 = [];
    const code1 = await runCli(['spaces', 'snapshot'], cfg, {
      stdout: (txt) => out1.push(txt),
      stderr: (txt) => out1.push(txt),
    });
    assert.equal(code1, 0);
    const snapJson = JSON.parse(out1.join(''));
    assert.equal(snapJson.profile, null);
    assert.deepEqual(snapJson.baselines, []);

    const out2 = [];
    const code2 = await runCli(['copilot', 'draft', '--text', 'Hoy peso 79 kg'], cfg, {
      stdout: (txt) => out2.push(txt),
      stderr: (txt) => out2.push(txt),
    });
    assert.equal(code2, 0);
    const copilotJson = JSON.parse(out2.join(''));
    assert.equal(copilotJson.mode, 'deterministic_fallback');
    assert.equal(copilotJson.acceptedProposals.length, 1);
    assert.equal(copilotJson.acceptedProposals[0].type, 'update_weight');
    assert.equal(copilotJson.acceptedProposals[0].payload.currentWeightKg, 79);
  } finally {
    dirs.cleanup();
  }
});
