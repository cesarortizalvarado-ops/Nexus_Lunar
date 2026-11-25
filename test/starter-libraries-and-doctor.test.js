import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { createCoreHttpServer } from '../src/interfaces/http/http-server.js';
import { runCli } from '../src/interfaces/cli/nexus-cli.js';
import { STARTER_RECIPES, STARTER_PANTRY_PRODUCTS } from '../src/domain/knowledge/starter-catalog-data.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-b7-test-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
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
  ],
  recurringCommitments: [
    { name: 'Internet', amount: 500, frequency: 'monthly', dueDayOfMonth: 28 },
  ],
  preferences: { dislikedIngredients: [] },
};

test('BLOQUE 7 · 1 — Siembra idempotente de bibliotecas semilla MX (27 productos, 15 recetas)', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
  });

  try {
    const first = await core.executeOperationAsync({ operation_type: 'knowledge.seedStarter', payload: {} });
    assert.equal(first.success, true);
    assert.equal(first.result.productsCreated, STARTER_PANTRY_PRODUCTS.length);
    assert.equal(first.result.productsExisting, 0);
    assert.equal(first.result.recipesCreated, STARTER_RECIPES.length);
    assert.equal(first.result.recipesExisting, 0);
    assert.equal(first.result.totalStarterRecipes, 15);

    const second = await core.executeOperationAsync({ operation_type: 'knowledge.seedStarter', payload: {} });
    assert.equal(second.success, true);
    assert.equal(second.result.productsCreated, 0);
    assert.equal(second.result.productsExisting, 27);
    assert.equal(second.result.recipesCreated, 0);
    assert.equal(second.result.recipesExisting, 15);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('BLOQUE 7 · 2 — Flujo real punta a punta sin recetas manuales con filtro clínico de triglicéridos altos', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-21T18:00:00.000Z'),
  });

  try {
    const seed = await core.executeOperationAsync({ operation_type: 'knowledge.seedStarter', payload: {} });
    assert.equal(seed.success, true);

    await core.executeOperationAsync({
      operation_type: 'spaces.profile.save',
      payload: { profile: sampleProfile, recordedAt: '2026-11-20T10:00:00.000Z' },
    });

    await core.executeOperationAsync({
      operation_type: 'spaces.clinical.record',
      payload: { triglycerides: 185, recordedAt: '2026-11-20T11:00:00.000Z' },
    });

    const assembled = core.weeklyContextAssembler.assembleWeeklyInputs({ weekStartDate: '2026-11-22' });
    assert.equal(assembled.libraries.recipes.length, 15);
    assert.equal(assembled.currentInventory.length, 27);

    // Invocar saturday.review.prepare SIN libraries ni currentInventory manuales
    const prep = await core.executeOperationAsync({
      operation_type: 'saturday.review.prepare',
      payload: {
        nextWeekStartDate: '2026-11-22',
        referenceDate: '2026-11-21',
        weeklyGroceryBudget: 1500,
        exerciseScheduleRequests: [
          { exerciseId: 'ex-walk-brisk', daysOfWeek: [1, 3, 5], durationMinutes: 30, preferredStartHour: 6.5 },
        ],
      },
    });
    assert.equal(prep.success, true);

    const draft = prep.result.nextWeekDraft;
    assert.equal(draft.dailySchedules.length, 7);

    const highCarbIds = new Set(['rec-b-hotcakes-miel', 'rec-l-pollo-arroz-extra']);
    for (const day of draft.dailySchedules) {
      assert.equal(day.nutrition.hasValidMealPlan, true, `Día ${day.dayOfWeek} debe tener menú válido`);
      for (const rec of day.nutrition.mealPlan.recipes) {
        assert.equal(highCarbIds.has(rec.id), false, `No debe incluir receta alta en carbohidratos (${rec.id})`);
        assert.ok(rec.macros.carbsGrams <= 60, `Carbohidratos deben ser <= 60g en ${rec.id}`);
      }
    }

    assert.ok(draft.sundayPrep.pantryReport.estimatedTotalCost > 0);
    assert.deepEqual(draft.sundayPrep.pantryReport.itemsWithoutPrice, []);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('BLOQUE 7 · 3 — Diagnóstico system.doctor por HTTP y CLI con verificación SHA-256 y degradación determinista', async () => {
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
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Seed por HTTP POST /api/knowledge/seed-starter
    const seedRes = await fetch(`${baseUrl}/api/knowledge/seed-starter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(seedRes.status, 201);
    const seedJson = await seedRes.json();
    assert.equal(seedJson.data.recipesCreated, 15);
    assert.equal(seedJson.data.productsCreated, 27);

    // 2. Guardar perfil, crear backup, preparar y sellar una baseline SHA-256
    await core.executeOperationAsync({
      operation_type: 'spaces.profile.save',
      payload: { profile: sampleProfile, recordedAt: '2026-11-20T10:00:00.000Z' },
    });
    await core.executeOperationAsync({
      operation_type: 'backup.create',
      payload: { reason: 'doctor-ready-test' },
    });
    const prep = await core.executeOperationAsync({
      operation_type: 'saturday.review.prepare',
      payload: { nextWeekStartDate: '2026-11-22', referenceDate: '2026-11-21', weeklyGroceryBudget: 1500 },
    });
    assert.equal(prep.success, true);
    const approve = await core.executeOperationAsync({
      operation_type: 'saturday.baseline.approve',
      payload: {
        draft: prep.result.nextWeekDraft,
        baselineId: 'wk-doctor-01',
        approvedAt: '2026-11-21T20:00:00.000Z',
        approvedBy: 'user',
      },
    });
    assert.equal(approve.success, true);

    // 3. Consultar GET /api/system/doctor
    const docRes = await fetch(`${baseUrl}/api/system/doctor?referenceDate=2026-11-21`);
    assert.equal(docRes.status, 200);
    const docJson = await docRes.json();
    const report = docJson.data;

    assert.equal(report.status, 'OK');
    assert.equal(report.checks.storage.ok, true);
    assert.equal(report.checks.baselines.validCount >= 1, true);
    assert.deepEqual(report.checks.baselines.corruptedIds, []);
    assert.equal(report.checks.libraries.recipesCount, 15);
    assert.equal(report.checks.libraries.inventoryProductsCount, 27);
    assert.equal(report.checks.ai.configured, false);
    assert.equal(report.checks.ai.available, false);
    assert.equal(report.checks.ai.mode, 'deterministic_only');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
  }

  // 4. Probar CLI `doctor` y `libraries seed` sobre el mismo directorio
  try {
    const cliCfg = { dataDir: dirs.dataDir, backupDir: dirs.backupDir, timezone: 'America/Mexico_City' };

    const seedOut = [];
    const seedCode = await runCli(['libraries', 'seed'], cliCfg, {
      stdout: (txt) => seedOut.push(txt),
      stderr: (txt) => seedOut.push(txt),
    });
    assert.equal(seedCode, 0);
    const cliSeedJson = JSON.parse(seedOut.join(''));
    assert.equal(cliSeedJson.recipesCreated, 0);
    assert.equal(cliSeedJson.recipesExisting, 15);

    const docOut = [];
    const docCode = await runCli(['doctor', '--date', '2026-11-21'], cliCfg, {
      stdout: (txt) => docOut.push(txt),
      stderr: (txt) => docOut.push(txt),
    });
    assert.equal(docCode, 0);
    const cliDocJson = JSON.parse(docOut.join(''));
    assert.equal(cliDocJson.status, 'OK');
    assert.equal(cliDocJson.checks.baselines.validCount >= 1, true);
    assert.equal(cliDocJson.checks.ai.mode, 'deterministic_only');
  } finally {
    dirs.cleanup();
  }
});
