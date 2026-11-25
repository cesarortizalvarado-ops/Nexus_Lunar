import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GoalFeasibilityEvaluator,
  evaluateGoalFeasibility,
} from '../src/application/personal/goal-feasibility-evaluator.js';
import {
  normalizeResourceImpact,
  validateResourceImpact,
} from '../src/domain/personal/goal-resource-contract.js';
import { validateGoalInput } from '../src/domain/personal/personal-validators.js';
import { ERROR_CODES } from '../src/shared/errors.js';

test('GoalFeasibilityEvaluator — detecta conflicto cuando dos metas de ahorro simultáneas exceden el flujo de caja quincenal', () => {
  const activeGoals = [
    {
      id: 'goal-emergency-fund',
      name: 'Fondo de emergencia',
      status: 'ACTIVE',
      resourceImpact: {
        financial: {
          targetAmount: 60000,
          targetDate: '2027-06-30',
          periodicContribution: 3500,
          currency: 'MXN',
          frequency: 'biweekly',
        },
      },
    },
    {
      id: 'goal-laptop',
      name: 'Compra de workstation',
      status: 'ACTIVE',
      resourceImpact: {
        financial: {
          targetAmount: 36000,
          targetDate: '2027-03-31',
          periodicContribution: 1500,
          currency: 'MXN',
          frequency: 'weekly', // 1500 * 2 = 3000 quincenal
        },
      },
    },
  ];

  const resourceLimits = {
    freeCashFlowBiweekly: 5000,
    discretionaryWeeklyHours: 15,
    maxSafeWeeklyDeficitCalories: 3500,
  };

  const evaluator = new GoalFeasibilityEvaluator(resourceLimits);
  const report = evaluator.evaluate(activeGoals);

  assert.equal(report.feasible, false);
  assert.equal(report.totals.financialBiweekly, 6500);
  assert.equal(report.surplus.financialBiweekly, -1500);
  assert.equal(report.conflicts.length, 1);

  const conflict = report.conflicts[0];
  assert.equal(conflict.resource, 'financial');
  assert.equal(conflict.limit, 5000);
  assert.equal(conflict.required, 6500);
  assert.equal(conflict.deficit, 1500);
  assert.equal(conflict.competingGoals.length, 2);
  assert.equal(conflict.competingGoals[0].id, 'goal-emergency-fund');
  assert.equal(conflict.competingGoals[1].id, 'goal-laptop');
  assert.ok(conflict.suggestions.length >= 2);
  assert.ok(conflict.suggestions[0].includes('Fondo de emergencia'));
  assert.ok(conflict.suggestions[0].includes('Compra de workstation'));
  assert.ok(conflict.suggestions[0].includes('1500'));
});

test('GoalFeasibilityEvaluator — calcula correctamente márgenes seguros cuando todas las metas son factibles', () => {
  const activeGoals = [
    {
      id: 'goal-savings',
      name: 'Ahorro viaje',
      status: 'ACTIVE',
      resourceImpact: {
        financial: {
          targetAmount: 24000,
          targetDate: '2027-12-01',
          periodicContribution: 4000,
          currency: 'mxn',
          frequency: 'monthly', // 2000 quincenal
        },
        time: {
          weeklyHoursRequired: 2,
          preferredWindows: ['sunday_morning'],
        },
      },
    },
    {
      id: 'goal-weight',
      name: 'Reducción gradual de peso',
      status: 'ACTIVE',
      resourceImpact: {
        time: {
          weeklyHoursRequired: 4.5,
          preferredWindows: ['mon_07:00', 'wed_07:00', 'fri_07:00'],
        },
        health: {
          currentMetric: 84,
          targetMetric: 76,
          metricType: 'weight_kg',
          weeklyTargetDelta: -0.4, // 3080 kcal/semana
        },
      },
    },
  ];

  const report = evaluateGoalFeasibility(activeGoals, {
    freeCashFlowBiweekly: 4500,
    discretionaryWeeklyHours: 10,
    maxSafeWeeklyDeficitCalories: 3500,
  });

  assert.equal(report.feasible, true);
  assert.deepEqual(report.conflicts, []);
  assert.equal(report.totals.financialBiweekly, 2000);
  assert.equal(report.totals.weeklyHours, 6.5);
  assert.equal(report.totals.weeklyDeficitCalories, 3080);
  assert.equal(report.surplus.financialBiweekly, 2500);
  assert.equal(report.surplus.weeklyHours, 3.5);
  assert.equal(report.surplus.weeklyDeficitCalories, 420);
});

test('GoalFeasibilityEvaluator — suma horas semanales cuando coinciden proyectos y rutinas y detecta colisión de tiempo', () => {
  const activeGoals = [
    {
      id: 'goal-project-nexus',
      name: 'Proyecto Nexus Lunar v2',
      status: 'ACTIVE',
      resourceImpact: {
        time: {
          weeklyHoursRequired: 10,
          preferredWindows: ['weekday_evening'],
        },
      },
    },
    {
      id: 'goal-routine-training',
      name: 'Rutina de entrenamiento y movilidad',
      status: 'ACTIVE',
      resourceImpact: {
        time: {
          weeklyHoursRequired: 6,
          preferredWindows: ['weekday_morning'],
        },
        health: {
          currentMetric: 2,
          targetMetric: 5,
          metricType: 'habit_frequency',
          weeklyTargetDelta: 1,
        },
      },
    },
    {
      id: 'goal-project-cert',
      name: 'Certificación técnica',
      status: 'ACTIVE',
      resourceImpact: {
        time: {
          weeklyHoursRequired: 5,
          preferredWindows: ['weekend_morning'],
        },
      },
    },
  ];

  const evaluator = new GoalFeasibilityEvaluator({
    activeGoals,
    resourceLimits: {
      discretionaryWeeklyHours: 16,
    },
  });
  const report = evaluator.evaluate();

  assert.equal(report.feasible, false);
  assert.equal(report.totals.weeklyHours, 21);
  assert.equal(report.surplus.weeklyHours, -5);
  assert.equal(report.conflicts.length, 1);

  const timeConflict = report.conflicts[0];
  assert.equal(timeConflict.resource, 'time');
  assert.equal(timeConflict.deficit, 5);
  assert.equal(timeConflict.competingGoals.length, 3);
  assert.equal(timeConflict.competingGoals[0].id, 'goal-project-nexus');
  assert.ok(timeConflict.suggestions[0].includes('5 hrs/semana'));
});

test('GoalFeasibilityEvaluator — maneja metas sin resourceImpact o con impacto parcial sin arrojar excepciones', () => {
  const activeGoals = [
    {
      id: 'goal-legacy-1',
      name: 'Leer más filosofía',
      status: 'ACTIVE',
    },
    {
      id: 'goal-legacy-2',
      name: 'Mejorar comunicación',
      status: 'ACTIVE',
      resourceImpact: null,
    },
    {
      id: 'goal-archived',
      name: 'Meta archivada con gran demanda',
      status: 'ARCHIVED',
      resourceImpact: {
        financial: {
          periodicContribution: 99999,
          frequency: 'weekly',
        },
      },
    },
  ];

  const report = evaluateGoalFeasibility(activeGoals, {
    freeCashFlowBiweekly: 3000,
    discretionaryWeeklyHours: 12,
    maxSafeWeeklyDeficitCalories: 3500,
  });

  assert.equal(report.feasible, true);
  assert.equal(report.evaluatedGoalsCount, 2);
  assert.equal(report.goalsWithoutImpactCount, 2);
  assert.equal(report.totals.financialBiweekly, 0);
  assert.equal(report.totals.weeklyHours, 0);
  assert.equal(report.totals.weeklyDeficitCalories, 0);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(normalizeResourceImpact(null), { financial: null, time: null, health: null });
});

test('validateGoalInput y goal-resource-contract — mantienen retrocompatibilidad y validan resourceImpact', () => {
  // Retrocompatibilidad: meta sin resourceImpact pasa sin problemas
  assert.doesNotThrow(() => {
    validateGoalInput({ name: 'Meta tradicional sin contrato' }, false);
  });

  // Meta con resourceImpact válido pasa
  assert.doesNotThrow(() => {
    validateGoalInput(
      {
        name: 'Meta con contrato completo',
        resourceImpact: {
          financial: {
            targetAmount: 10000,
            targetDate: '2027-05-01',
            periodicContribution: 1000,
            currency: 'MXN',
            frequency: 'biweekly',
          },
          time: {
            weeklyHoursRequired: 3,
            preferredWindows: ['sat_morning'],
          },
          health: {
            currentMetric: 80,
            targetMetric: 75,
            metricType: 'weight_kg',
            weeklyTargetDelta: -0.5,
          },
        },
      },
      false
    );
  });

  // Meta con frecuencia financiera inválida falla con VALIDATION_ERROR
  assert.throws(
    () => {
      validateGoalInput(
        {
          name: 'Meta inválida',
          resourceImpact: {
            financial: {
              periodicContribution: 500,
              frequency: 'daily',
            },
          },
        },
        false
      );
    },
    (err) => err?.code === ERROR_CODES.VALIDATION_ERROR
  );

  // Meta con horas semanales negativas falla con VALIDATION_ERROR
  assert.throws(
    () => {
      validateResourceImpact({
        time: { weeklyHoursRequired: -2 },
      });
    },
    (err) => err?.code === ERROR_CODES.VALIDATION_ERROR
  );
});
