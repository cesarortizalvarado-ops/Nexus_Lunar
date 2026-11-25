import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sealWeeklyBaseline,
  verifyBaselineIntegrity,
} from '../src/domain/planning/weekly-baseline-contract.js';

import { generateWeeklyPlanDraft } from '../src/application/planning/multidomain-weekly-optimizer.js';
import {
  recordBlockExecution,
  recordPlanRevision,
  closeWeekAndAnalyze,
} from '../src/application/planning/weekly-execution-tracker.js';

const sampleProfile = {
  biometrics: { birthDate: '1985-06-05', heightCm: 158, currentWeightKg: 80, sex: 'male' },
  employments: [
    {
      type: 'fixed',
      title: 'Trabajo Oficial',
      workingHoursWindows: [
        { dayOfWeek: 1, startHour: 8, endHour: 15 },
        { dayOfWeek: 1, startHour: 16, endHour: 18 },
        { dayOfWeek: 2, startHour: 8, endHour: 15 },
        { dayOfWeek: 2, startHour: 16, endHour: 18 },
      ],
      income: { amount: 6000, frequency: 'biweekly' },
    },
    {
      type: 'freelance',
      title: 'Proyecto Personal',
      targetWeeklyHours: 4,
      historicalIncomes: [{ amount: 2000 }],
    },
  ],
  recurringCommitments: [
    { name: 'Internet', amount: 500, frequency: 'monthly' },
  ],
  preferences: {
    dislikedIngredients: ['hígado'],
  },
};

const sampleRecipes = [
  {
    id: 'r-desayuno-ok',
    name: 'Omelette con espinacas',
    category: 'breakfast',
    prepTimeMinutes: 15,
    servings: 1,
    caloriesPerServing: 450,
    macros: { proteinGrams: 30, carbsGrams: 12, fatGrams: 20 },
    ingredients: [{ itemId: 'egg', itemName: 'Huevo', requiredQuantity: 3, unit: 'unit' }],
  },
  {
    id: 'r-desayuno-carbs',
    name: 'Hotcakes con miel',
    category: 'breakfast',
    prepTimeMinutes: 20,
    servings: 1,
    caloriesPerServing: 450,
    macros: { proteinGrams: 8, carbsGrams: 78, fatGrams: 10 },
    ingredients: [{ itemId: 'flour', itemName: 'Harina', requiredQuantity: 100, unit: 'g' }],
  },
  {
    id: 'r-comida-ok',
    name: 'Pechuga asada con brócoli',
    category: 'lunch',
    prepTimeMinutes: 25,
    servings: 1,
    caloriesPerServing: 650,
    macros: { proteinGrams: 55, carbsGrams: 25, fatGrams: 18 },
    ingredients: [{ itemId: 'chicken', itemName: 'Pechuga de pollo', requiredQuantity: 250, unit: 'g' }],
  },
  {
    id: 'r-cena-ok',
    name: 'Ensalada de atún y aguacate',
    category: 'dinner',
    prepTimeMinutes: 10,
    servings: 1,
    caloriesPerServing: 500,
    macros: { proteinGrams: 35, carbsGrams: 15, fatGrams: 22 },
    ingredients: [{ itemId: 'tuna', itemName: 'Atún', requiredQuantity: 140, unit: 'g' }],
  },
];

const sampleInventory = [
  { itemId: 'egg', availableQuantity: 6, unit: 'unit', unitCost: 4 },
  { itemId: 'chicken', availableQuantity: 500, unit: 'g', unitCost: 0.14 },
  { itemId: 'tuna', availableQuantity: 0, unit: 'g', unitCost: 0.2 },
];

test('OPTIMIZER: Genera borrador semanal multidominio sin solapamientos y respetando alertas clínicas', () => {
  const draft = generateWeeklyPlanDraft({
    weekStartDate: '2026-11-29',
    userProfile: sampleProfile,
    activeGoals: [
      {
        id: 'g-peso',
        title: 'Bajar a 70 kg',
        resourceImpact: {
          health: { targetMetric: 70, metricType: 'weight_kg', weeklyTargetDelta: 0.5 },
        },
      },
      {
        id: 'g-ingles',
        title: 'Práctica de inglés',
        resourceImpact: { time: { weeklyHoursRequired: 3 } },
      },
    ],
    fixedCommitments: [
      { id: 'cita-dentista', title: 'Dentista', dayOfWeek: 3, startHour: 10, endHour: 11 },
    ],
    clinicalPanel: { triglycerides: 185 }, // Debe descartar Hotcakes (>60g carbs)
    libraries: { recipes: sampleRecipes },
    currentInventory: sampleInventory,
    weeklyGroceryBudget: 1000,
    exerciseScheduleRequests: [
      { exerciseId: 'ex-walk-brisk', daysOfWeek: [1, 2, 3, 4, 5], durationMinutes: 30, preferredStartHour: 6.5 },
      { exerciseId: 'ex-weightlifting-moderate', daysOfWeek: [1, 3, 5], durationMinutes: 40, preferredStartHour: 18.5 },
    ],
  });

  assert.equal(draft.status, 'draft');
  assert.equal(draft.dailySchedules.length, 7);
  assert.equal(draft.hardConflicts.length, 0);
  assert.equal(draft.clinicalReport.hasAlerts, true);

  // Verificar que ningún día tenga bloques solapados
  for (const day of draft.dailySchedules) {
    for (let i = 1; i < day.blocks.length; i++) {
      assert.ok(
        day.blocks[i].startHour >= day.blocks[i - 1].endHour,
        `Solapamiento detectado en día ${day.dayOfWeek}: ${day.blocks[i - 1].id} vs ${day.blocks[i].id}`
      );
    }
  }

  // Verificar que el lunes incluyó caminata (6.5-7.0) y pesas (18.5-19.17) sin invadir trabajo (8-15, 16-18)
  const mondayExercises = draft.dailySchedules[1].blocks.filter((b) => b.category === 'exercise');
  assert.equal(mondayExercises.length, 2);
  assert.ok(draft.dailySchedules[1].exerciseCaloriesBurned > 400);

  // Verificar que la preparación dominical consolidó despensa y compras
  assert.ok(draft.sundayPrep.pantryReport.estimatedTotalCost >= 0);
  assert.equal(draft.sundayPrep.recurringCommitmentsChecklist.length, 1);
});

test('BASELINE: Sellado criptográfico inmutable y detección de alteraciones', () => {
  const draft = generateWeeklyPlanDraft({
    weekStartDate: '2026-11-29',
    userProfile: sampleProfile,
    libraries: { recipes: sampleRecipes },
    currentInventory: sampleInventory,
    weeklyGroceryBudget: 1000,
  });

  const baseline = sealWeeklyBaseline(draft, {
    baselineId: 'wk-2026-49',
    approvedAt: '2026-11-28T21:00:00.000Z',
  });

  assert.equal(baseline.status, 'approved_immutable');
  assert.equal(verifyBaselineIntegrity(baseline).valid, true);

  // Confirmar congelamiento (intentar mutar lanza TypeError en modo estricto)
  assert.throws(() => {
    baseline.plan.weekStartDate = '2099-01-01';
  }, TypeError);

  // Simular alteración en copia clonada y verificar fallo de sello SHA-256
  const tampered = structuredClone(baseline);
  tampered.plan.weekStartDate = '2099-01-01';
  const check = verifyBaselineIntegrity(tampered);
  assert.equal(check.valid, false);
  assert.equal(check.reason, 'BASELINE_TAMPERED');
});

test('EXECUTION TRACKER: Registro diario, revisiones y cierre preservando incertidumbre', () => {
  const draft = generateWeeklyPlanDraft({
    weekStartDate: '2026-11-29',
    userProfile: sampleProfile,
    libraries: { recipes: sampleRecipes },
    currentInventory: sampleInventory,
    weeklyGroceryBudget: 1000,
    exerciseScheduleRequests: [
      { exerciseId: 'ex-walk-brisk', daysOfWeek: [1, 2], durationMinutes: 30, preferredStartHour: 6.5 },
    ],
  });

  const baseline = sealWeeklyBaseline(draft, { approvedAt: '2026-11-28T21:00:00.000Z' });
  const mondayWalk = baseline.plan.dailySchedules[1].blocks.find((b) => b.category === 'exercise');
  const tuesdayWalk = baseline.plan.dailySchedules[2].blocks.find((b) => b.category === 'exercise');

  let log = [];
  let revisions = [];

  log = recordBlockExecution(baseline, log, {
    blockId: mondayWalk.id,
    status: 'completed',
  });

  log = recordBlockExecution(baseline, log, {
    blockId: tuesdayWalk.id,
    status: 'missed_with_reason',
    reason: 'Lluvia intensa por la mañana',
  });

  revisions = recordPlanRevision(baseline, revisions, {
    originalBlockId: tuesdayWalk.id,
    changeType: 'reschedule',
    newWindow: { dayOfWeek: 2, startHour: 19, endHour: 19.5 },
    reason: 'Movido a la tarde por clima',
    authorizedBy: 'user',
  });

  const summary = closeWeekAndAnalyze(baseline, log, revisions);
  assert.equal(summary.integrityVerified, true);
  assert.equal(summary.statusCounts.completed, 1);
  assert.equal(summary.statusCounts.missed_with_reason, 1);
  // Los bloques sin registro deben permanecer como unconfirmed (nunca asumidos como fallo)
  assert.ok(summary.unconfirmedBlocks > 0);
  assert.equal(summary.revisionsCount, 1);
  assert.equal(summary.documentedFrictionReasons.length, 1);
  assert.equal(summary.documentedFrictionReasons[0].reason, 'Lluvia intensa por la mañana');
});
