import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateBiomarker,
  evaluateClinicalPanel,
} from '../src/domain/personal/clinical-reference-library.js';
import {
  validatePersonalProfile,
  calculateTotalBiweeklyIncome,
  calculateTotalBlockedWeeklyHours,
  calculateBiweeklyCommitments,
} from '../src/domain/personal/personal-profile-contract.js';
import { evaluateGoalFeasibility } from '../src/application/personal/goal-feasibility-evaluator.js';

test('CLINICAL: Detección determinista de biomarcadores fuera de rango', () => {
  const glucoseNormal = evaluateBiomarker('fastingGlucose', 85);
  assert.equal(glucoseNormal.status, 'normal');
  assert.equal(glucoseNormal.isOutOfRange, false);

  const triglyceridesHigh = evaluateBiomarker('triglycerides', 180);
  assert.equal(triglyceridesHigh.status, 'high');
  assert.equal(triglyceridesHigh.isOutOfRange, true);

  const panelResult = evaluateClinicalPanel({
    fastingGlucose: 105,
    triglycerides: 140,
    systolicPressure: 118,
  });
  assert.equal(panelResult.hasAlerts, true);
  assert.equal(panelResult.evaluations.length, 3);
});

test('MULTI-EMPLOYMENT: Cálculo unificado de ingresos y horas bloqueadas', () => {
  const profile = {
    biometrics: { birthDate: '1985-06-05', heightCm: 158, currentWeightKg: 80, sex: 'male' },
    employments: [
      {
        type: 'fixed',
        title: 'CAEV Oficial',
        workingHoursWindows: [
          { dayOfWeek: 1, startHour: 8, endHour: 15 },
          { dayOfWeek: 1, startHour: 16, endHour: 18 },
        ], // 9 horas lunes
        income: { amount: 6000, frequency: 'biweekly' },
      },
      {
        type: 'freelance',
        title: 'Nexus Audio Studio',
        targetWeeklyHours: 10,
        historicalIncomes: [{ amount: 2000 }, { amount: 3000 }], // Promedio: 2500
      },
    ],
    recurringCommitments: [
      { name: 'Internet & Luz', amount: 800, frequency: 'monthly' },
      { name: 'Suscripción Streaming', amount: 200, frequency: 'monthly' },
    ], // Total quincenal = 500
  };

  assert.doesNotThrow(() => validatePersonalProfile(profile));

  const totalIncome = calculateTotalBiweeklyIncome(profile.employments);
  assert.equal(totalIncome, 8500); // 6000 + 2500

  const blockedHours = calculateTotalBlockedWeeklyHours(profile.employments);
  assert.equal(blockedHours, 19); // 9h fijas + 10h freelance

  const commitments = calculateBiweeklyCommitments(profile.recurringCommitments);
  assert.equal(commitments, 500);
});

test('EVALUATOR: Detección de colisión cuando metas compiten contra ingresos y compromisos reales', () => {
  const profile = {
    biometrics: { birthDate: '1985-06-05', heightCm: 158, currentWeightKg: 80, sex: 'male' },
    employments: [
      {
        type: 'fixed',
        workingHoursWindows: [{ dayOfWeek: 1, startHour: 8, endHour: 17 }],
        income: { amount: 5000, frequency: 'biweekly' },
      },
    ],
    recurringCommitments: [{ name: 'Gastos fijos', amount: 3000, frequency: 'biweekly' }],
  }; // Flujo libre: 2000 quincenales

  const goals = [
    {
      id: 'g-gpu',
      title: 'Comprar RTX 3060',
      resourceImpact: {
        financial: { targetAmount: 6000, periodicContribution: 1500, frequency: 'biweekly' },
      },
    },
    {
      id: 'g-ahorro',
      title: 'Fondo 2027',
      resourceImpact: {
        financial: { targetAmount: 20000, periodicContribution: 800, frequency: 'biweekly' },
      },
    },
  ]; // Total ahorro demandado: 2300 vs 2000 disponible

  const report = evaluateGoalFeasibility(goals, {}, profile);
  assert.equal(report.feasible, false);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].resource, 'financial');
  assert.equal(report.conflicts[0].deficit, 300);
});
