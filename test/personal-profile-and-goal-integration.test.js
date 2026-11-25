import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAgeYears,
  calculateBmr,
  calculateProjectedBiweeklyIncome,
  normalizePersonalProfile,
  validatePersonalProfile,
} from '../src/domain/personal/personal-profile-contract.js';
import {
  GoalFeasibilityEvaluator,
  evaluateGoalFeasibility,
} from '../src/application/personal/goal-feasibility-evaluator.js';
import { createClock } from '../src/shared/clock.js';
import { ERROR_CODES } from '../src/shared/errors.js';

test('personal-profile-contract — calcula edad y BMR (Mifflin-St Jeor) de forma determinista con fecha ISO y clock', () => {
  const fixedClockBeforeBday = createClock({
    nowFn: () => new Date('2026-05-10T12:00:00Z'),
    timezone: 'America/Mexico_City',
  });
  const fixedClockOnBday = createClock({
    nowFn: () => new Date('2026-05-15T12:00:00Z'),
    timezone: 'America/Mexico_City',
  });

  // Antes del cumpleaños: 1996-05-15 -> 29 años el 2026-05-10
  assert.equal(calculateAgeYears('1996-05-15', fixedClockBeforeBday), 29);
  // El día exacto del cumpleaños: 30 años el 2026-05-15
  assert.equal(calculateAgeYears('1996-05-15', fixedClockOnBday), 30);

  // BMR Hombre: (10 * 80) + (6.25 * 178) - (5 * 30) + 5 = 800 + 1112.5 - 150 + 5 = 1767.5
  const maleBmr = calculateBmr(
    {
      birthDate: '1996-05-15',
      heightCm: 178,
      currentWeightKg: 80,
      sex: 'male',
    },
    '2026-05-15'
  );
  assert.equal(maleBmr, 1767.5);

  // BMR Mujer: (10 * 62) + (6.25 * 164) - (5 * 28) - 161 = 620 + 1025 - 140 - 161 = 1344
  const femaleBmr = calculateBmr(
    {
      birthDate: '1998-03-20',
      heightCm: 164,
      currentWeightKg: 62,
      sex: 'female',
    },
    '2026-04-01'
  );
  assert.equal(femaleBmr, 1344);
});

test('personal-profile-contract — calcula ingreso quincenal proyectado para empleo fijo y promedio freelance', () => {
  const fixedMonthlyProfile = normalizePersonalProfile({
    id: 'profile-fixed',
    biometrics: { birthDate: '1992-08-10', heightCm: 175, currentWeightKg: 82, sex: 'male' },
    employment: {
      type: 'fixed',
      workingHoursWindows: [
        { dayOfWeek: 1, startHour: 9, endHour: 18 },
        { dayOfWeek: 2, startHour: 9, endHour: 18 },
      ],
      fixedIncome: { amount: 24000, frequency: 'monthly' },
    },
    preferences: {
      dislikedIngredients: ['Cilantro'],
      preferredMealCategories: ['breakfast', 'dinner'],
    },
  });

  // 24000 mensual -> 12000 quincenal
  assert.equal(calculateProjectedBiweeklyIncome(fixedMonthlyProfile), 12000);
  assert.deepEqual(fixedMonthlyProfile.preferences.dislikedIngredients, ['cilantro']);

  // Empleo fijo semanal: 4500 * 2 = 9000 quincenal
  assert.equal(
    calculateProjectedBiweeklyIncome({
      type: 'fixed',
      workingHoursWindows: [],
      fixedIncome: { amount: 4500, frequency: 'weekly' },
    }),
    9000
  );

  // Freelance: promedio de [7000, 9500, 7500] = 8000
  const freelanceProfile = normalizePersonalProfile({
    id: 'profile-freelance',
    biometrics: { birthDate: '1994-11-02', heightCm: 168, currentWeightKg: 65, sex: 'female' },
    employment: {
      type: 'freelance',
      targetWeeklyHours: 35,
      historicalIncomes: [
        { date: '2026-09-15', amount: 7000 },
        { date: '2026-09-30', amount: 9500 },
        { date: '2026-10-15', amount: 7500 },
      ],
    },
  });
  assert.equal(calculateProjectedBiweeklyIncome(freelanceProfile), 8000);

  // Freelance sin ingresos registrados -> 0
  assert.equal(
    calculateProjectedBiweeklyIncome({
      type: 'freelance',
      targetWeeklyHours: 20,
      historicalIncomes: [],
    }),
    0
  );

  // Rechazo de datos inválidos
  assert.throws(
    () =>
      validatePersonalProfile({
        biometrics: { birthDate: '1994-11-02', heightCm: -10, currentWeightKg: 65, sex: 'female' },
        employment: { type: 'freelance', targetWeeklyHours: 20, historicalIncomes: [] },
      }),
    (err) => err?.code === ERROR_CODES.VALIDATION_ERROR
  );
});

test('GoalFeasibilityEvaluator + PersonalProfile — hereda peso inicial del perfil y deriva flujo quincenal libre', () => {
  const userProfile = normalizePersonalProfile({
    id: 'user-01',
    biometrics: {
      birthDate: '1995-01-20',
      heightCm: 176,
      currentWeightKg: 82,
      sex: 'male',
    },
    employment: {
      type: 'fixed',
      workingHoursWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
      fixedIncome: { amount: 20000, frequency: 'monthly' }, // 10000 quincenal
      fixedExpensesBiweekly: 6500, // flujo libre derivado = 3500 quincenal
    },
  });

  // Meta de salud SIN currentMetric (solo targetMetric: 70 y weeklyTargetDelta: 0.6 kg/semana)
  // Sin perfil no sabría si 70 es bajada respecto al peso actual; con perfil toma 82 kg -> pérdida de 0.6 kg/sem = 4620 kcal/sem
  const weightGoal = {
    id: 'goal-cut-weight',
    name: 'Bajar a 70 kg',
    status: 'ACTIVE',
    resourceImpact: {
      health: {
        targetMetric: 70,
        metricType: 'weight_kg',
        weeklyTargetDelta: 0.6,
      },
      financial: {
        periodicContribution: 2500,
        currency: 'MXN',
        frequency: 'biweekly',
      },
    },
  };

  const evaluator = new GoalFeasibilityEvaluator({
    activeGoals: [weightGoal],
    resourceLimits: {
      // freeCashFlowBiweekly se omite intencionalmente para derivarlo del perfil (10000 - 6500 = 3500)
      maxSafeWeeklyDeficitCalories: 3500,
    },
    userProfile,
  });

  const report = evaluator.evaluate();

  // Verifica que la meta original no fue mutada
  assert.equal(weightGoal.resourceImpact.health.currentMetric, undefined);

  // Flujo quincenal derivado = 3500, demanda = 2500 -> superávit = 1000 (sin conflicto financiero)
  assert.equal(report.limits.freeCashFlowBiweekly, 3500);
  assert.equal(report.surplus.financialBiweekly, 1000);

  // Déficit calórico calculado con peso base del perfil (82 -> 70): 0.6 * 7700 = 4620 kcal/sem > 3500 -> conflicto de salud
  assert.equal(report.feasible, false);
  assert.equal(report.totals.weeklyDeficitCalories, 4620);
  assert.equal(report.surplus.weeklyDeficitCalories, -1120);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].resource, 'health');
  assert.equal(report.conflicts[0].deficit, 1120);
  assert.equal(report.conflicts[0].competingGoals[0].currentMetric, 82);
  assert.equal(report.conflicts[0].competingGoals[0].currentMetricSource, 'user_profile');
});

test('GoalFeasibilityEvaluator — mantiene retrocompatibilidad cuando no se proporciona userProfile', () => {
  const report = evaluateGoalFeasibility(
    [
      {
        id: 'goal-simple',
        name: 'Ahorro base',
        status: 'ACTIVE',
        resourceImpact: {
          financial: {
            periodicContribution: 1000,
            frequency: 'biweekly',
          },
          health: {
            targetMetric: 70,
            metricType: 'weight_kg',
            weeklyTargetDelta: -0.4,
          },
        },
      },
    ],
    {
      freeCashFlowBiweekly: 2000,
      maxSafeWeeklyDeficitCalories: 3500,
    }
  );

  assert.equal(report.feasible, true);
  assert.equal(report.surplus.financialBiweekly, 1000);
  assert.equal(report.totals.weeklyDeficitCalories, 3080);
  assert.equal(report.surplus.weeklyDeficitCalories, 420);
  assert.deepEqual(report.conflicts, []);
});
