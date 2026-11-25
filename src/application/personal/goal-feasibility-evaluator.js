import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import {
  estimateWeeklyCaloricDeficit,
  extractGoalResourceImpact,
  normalizeFinancialToBiweekly,
} from '../../domain/personal/goal-resource-contract.js';
import {
  calculateBiweeklyCommitments,
  calculateTotalBiweeklyIncome,
  calculateTotalBlockedWeeklyHours,
  normalizePersonalProfile,
} from '../../domain/personal/personal-profile-contract.js';

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function normalizeOptionalLimit(value, fieldName) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `${fieldName} debe ser un número finito mayor o igual a 0.`,
      { field: fieldName }
    );
  }
  return round2(parsed);
}

function normalizeResourceLimits(resourceLimits = {}) {
  if (resourceLimits === null || resourceLimits === undefined) {
    return {
      freeCashFlowBiweekly: null,
      discretionaryWeeklyHours: null,
      maxSafeWeeklyDeficitCalories: null,
    };
  }
  if (typeof resourceLimits !== 'object' || Array.isArray(resourceLimits)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceLimits debe ser un objeto válido.',
      { field: 'resourceLimits' }
    );
  }

  return {
    freeCashFlowBiweekly: normalizeOptionalLimit(
      resourceLimits.freeCashFlowBiweekly,
      'resourceLimits.freeCashFlowBiweekly'
    ),
    discretionaryWeeklyHours: normalizeOptionalLimit(
      resourceLimits.discretionaryWeeklyHours,
      'resourceLimits.discretionaryWeeklyHours'
    ),
    maxSafeWeeklyDeficitCalories: normalizeOptionalLimit(
      resourceLimits.maxSafeWeeklyDeficitCalories,
      'resourceLimits.maxSafeWeeklyDeficitCalories'
    ),
  };
}

function sortByDemandDesc(entries) {
  return [...entries].sort((a, b) => {
    if (b.demand !== a.demand) return b.demand - a.demand;
    return String(a.id).localeCompare(String(b.id));
  });
}

function buildDeterministicSuggestions(resourceLabel, unitLabel, competingGoals, deficit) {
  const ordered = sortByDemandDesc(competingGoals);
  const suggestions = [];

  if (ordered.length >= 2) {
    const names = ordered.map((g) => `"${g.name}" (${g.demand} ${unitLabel})`).join(' vs ');
    suggestions.push(
      `Colisión de ${resourceLabel} entre ${names}; déficit total de ${deficit} ${unitLabel}.`
    );
  } else if (ordered.length === 1) {
    suggestions.push(
      `La meta "${ordered[0].name}" (${ordered[0].demand} ${unitLabel}) excede por sí sola el límite disponible de ${resourceLabel} en ${deficit} ${unitLabel}.`
    );
  }

  if (ordered.length > 0) {
    const top = ordered[0];
    suggestions.push(
      `Reducir la demanda de ${resourceLabel} en al menos ${deficit} ${unitLabel} o reprogramar/extender la fecha objetivo de "${top.name}".`
    );
  }

  return suggestions;
}

export function evaluateGoalFeasibility(activeGoals = [], resourceLimits = {}, userProfile = null) {
  if (activeGoals !== null && activeGoals !== undefined && !Array.isArray(activeGoals)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'activeGoals debe ser un arreglo de metas.',
      { field: 'activeGoals' }
    );
  }

  const resolvedProfileInput =
    userProfile !== null && userProfile !== undefined
      ? userProfile
      : (resourceLimits && typeof resourceLimits === 'object' ? resourceLimits.userProfile ?? null : null);
  const profile = resolvedProfileInput ? normalizePersonalProfile(resolvedProfileInput) : null;

  const limits = normalizeResourceLimits(resourceLimits);
  if (profile) {
    if (limits.freeCashFlowBiweekly === null) {
      const projectedBiweeklyIncome = calculateTotalBiweeklyIncome(profile.employments);
      const recurringCommitmentsCost = calculateBiweeklyCommitments(profile.recurringCommitments);
      const fixedExpenses =
        normalizeOptionalLimit(
          resourceLimits?.fixedExpensesBiweekly ?? profile.fixedExpensesBiweekly ?? 0,
          'fixedExpensesBiweekly'
        ) ?? 0;
      limits.freeCashFlowBiweekly = round2(
        Math.max(0, projectedBiweeklyIncome - recurringCommitmentsCost - fixedExpenses)
      );
    }

    if (limits.discretionaryWeeklyHours === null) {
      const blockedWorkHours = calculateTotalBlockedWeeklyHours(profile.employments);
      const sleepWeeklyHours =
        normalizeOptionalLimit(
          resourceLimits?.sleepWeeklyHours ?? resolvedProfileInput?.sleepWeeklyHours ?? profile.sleepWeeklyHours ?? 56,
          'sleepWeeklyHours'
        ) ?? 56;
      const personalUpkeepWeeklyHours =
        normalizeOptionalLimit(
          resourceLimits?.personalUpkeepWeeklyHours ?? resolvedProfileInput?.personalUpkeepWeeklyHours ?? profile.personalUpkeepWeeklyHours ?? 21,
          'personalUpkeepWeeklyHours'
        ) ?? 21;
      // 168h totales/semana - sueño (56h) - operación personal/comidas/traslados (21h) - trabajo bloqueado
      limits.discretionaryWeeklyHours = round2(
        Math.max(0, 168 - sleepWeeklyHours - personalUpkeepWeeklyHours - blockedWorkHours)
      );
    }
  }

  const goalsList = Array.isArray(activeGoals) ? activeGoals : [];

  const financialEntries = [];
  const timeEntries = [];
  const healthEntries = [];

  let evaluatedGoalsCount = 0;
  let goalsWithoutImpactCount = 0;

  for (let index = 0; index < goalsList.length; index += 1) {
    const goal = goalsList[index];
    if (!goal || typeof goal !== 'object') continue;
    if (goal.status !== undefined && goal.status !== null && goal.status !== 'ACTIVE') continue;

    evaluatedGoalsCount += 1;
    const goalId = goal.id ?? `goal_${index + 1}`;
    const rawGoalLabel =
      typeof goal.name === 'string' && goal.name.trim()
        ? goal.name.trim()
        : (typeof goal.title === 'string' && goal.title.trim() ? goal.title.trim() : goalId);
    const goalName = rawGoalLabel;

    const impact = extractGoalResourceImpact(goal);
    const hasAnyImpact = Boolean(impact.financial || impact.time || impact.health);
    if (!hasAnyImpact) {
      goalsWithoutImpactCount += 1;
      continue;
    }

    if (impact.financial) {
      const demand = normalizeFinancialToBiweekly(impact.financial);
      financialEntries.push({
        id: goalId,
        name: goalName,
        demand,
        periodicContribution: impact.financial.periodicContribution,
        frequency: impact.financial.frequency,
        currency: impact.financial.currency,
        targetAmount: impact.financial.targetAmount,
        targetDate: impact.financial.targetDate,
      });
    }

    if (impact.time) {
      timeEntries.push({
        id: goalId,
        name: goalName,
        demand: impact.time.weeklyHoursRequired,
        preferredWindows: impact.time.preferredWindows,
      });
    }

    if (impact.health) {
      const derivedFromProfile =
        impact.health.metricType === 'weight_kg' &&
        impact.health.currentMetric === null &&
        profile !== null;
      const effectiveHealth = derivedFromProfile
        ? { ...impact.health, currentMetric: profile.biometrics.currentWeightKg }
        : impact.health;

      const deficitCalories = estimateWeeklyCaloricDeficit(effectiveHealth);
      if (deficitCalories > 0) {
        healthEntries.push({
          id: goalId,
          name: goalName,
          demand: deficitCalories,
          metricType: effectiveHealth.metricType,
          currentMetric: effectiveHealth.currentMetric,
          targetMetric: effectiveHealth.targetMetric,
          currentMetricSource: derivedFromProfile ? 'user_profile' : 'goal',
          weeklyTargetDelta: effectiveHealth.weeklyTargetDelta,
        });
      }
    }
  }

  const totalFinancialBiweekly = round2(
    financialEntries.reduce((acc, entry) => acc + entry.demand, 0)
  );
  const totalWeeklyHours = round2(
    timeEntries.reduce((acc, entry) => acc + entry.demand, 0)
  );
  const totalWeeklyDeficitCalories = round2(
    healthEntries.reduce((acc, entry) => acc + entry.demand, 0)
  );

  const conflicts = [];

  const financialSurplus =
    limits.freeCashFlowBiweekly !== null
      ? round2(limits.freeCashFlowBiweekly - totalFinancialBiweekly)
      : null;

  if (limits.freeCashFlowBiweekly !== null && totalFinancialBiweekly > limits.freeCashFlowBiweekly) {
    const deficit = round2(totalFinancialBiweekly - limits.freeCashFlowBiweekly);
    const competingGoals = sortByDemandDesc(financialEntries);
    conflicts.push({
      resource: 'financial',
      severity: 'CONFLICT',
      limit: limits.freeCashFlowBiweekly,
      required: totalFinancialBiweekly,
      deficit,
      unit: 'biweekly_currency',
      competingGoals,
      suggestions: buildDeterministicSuggestions(
        'flujo de caja quincenal',
        'por quincena',
        competingGoals,
        deficit
      ),
    });
  }

  const timeSurplus =
    limits.discretionaryWeeklyHours !== null
      ? round2(limits.discretionaryWeeklyHours - totalWeeklyHours)
      : null;

  if (limits.discretionaryWeeklyHours !== null && totalWeeklyHours > limits.discretionaryWeeklyHours) {
    const deficit = round2(totalWeeklyHours - limits.discretionaryWeeklyHours);
    const competingGoals = sortByDemandDesc(timeEntries);
    conflicts.push({
      resource: 'time',
      severity: 'CONFLICT',
      limit: limits.discretionaryWeeklyHours,
      required: totalWeeklyHours,
      deficit,
      unit: 'weekly_hours',
      competingGoals,
      suggestions: buildDeterministicSuggestions(
        'tiempo semanal discrecional',
        'hrs/semana',
        competingGoals,
        deficit
      ),
    });
  }

  const healthSurplus =
    limits.maxSafeWeeklyDeficitCalories !== null
      ? round2(limits.maxSafeWeeklyDeficitCalories - totalWeeklyDeficitCalories)
      : null;

  if (
    limits.maxSafeWeeklyDeficitCalories !== null &&
    totalWeeklyDeficitCalories > limits.maxSafeWeeklyDeficitCalories
  ) {
    const deficit = round2(totalWeeklyDeficitCalories - limits.maxSafeWeeklyDeficitCalories);
    const competingGoals = sortByDemandDesc(healthEntries);
    conflicts.push({
      resource: 'health',
      severity: 'CONFLICT',
      limit: limits.maxSafeWeeklyDeficitCalories,
      required: totalWeeklyDeficitCalories,
      deficit,
      unit: 'weekly_calories',
      competingGoals,
      suggestions: buildDeterministicSuggestions(
        'déficit calórico semanal seguro',
        'kcal/semana',
        competingGoals,
        deficit
      ),
    });
  }

  return {
    feasible: conflicts.length === 0,
    evaluatedGoalsCount,
    goalsWithImpactCount: evaluatedGoalsCount - goalsWithoutImpactCount,
    goalsWithoutImpactCount,
    totals: {
      financialBiweekly: totalFinancialBiweekly,
      weeklyHours: totalWeeklyHours,
      weeklyDeficitCalories: totalWeeklyDeficitCalories,
    },
    limits,
    availableResources: { ...limits },
    surplus: {
      financialBiweekly: financialSurplus,
      weeklyHours: timeSurplus,
      weeklyDeficitCalories: healthSurplus,
    },
    conflicts,
  };
}

export class GoalFeasibilityEvaluator {
  constructor(firstArg = {}, secondArg = undefined, thirdArg = null) {
    if (Array.isArray(firstArg)) {
      this.defaultGoals = firstArg;
      this.defaultLimits = secondArg && typeof secondArg === 'object' ? secondArg : {};
      this.defaultProfile = thirdArg ?? null;
    } else if (
      firstArg &&
      typeof firstArg === 'object' &&
      ('activeGoals' in firstArg || 'resourceLimits' in firstArg || 'userProfile' in firstArg)
    ) {
      this.defaultGoals = firstArg.activeGoals ?? [];
      this.defaultLimits = firstArg.resourceLimits ?? {};
      this.defaultProfile = firstArg.userProfile ?? null;
    } else {
      this.defaultGoals = [];
      this.defaultLimits = firstArg && typeof firstArg === 'object' ? firstArg : {};
      this.defaultProfile = secondArg ?? null;
    }
  }

  evaluate(
    activeGoals = this.defaultGoals,
    resourceLimits = this.defaultLimits,
    userProfile = this.defaultProfile
  ) {
    return evaluateGoalFeasibility(activeGoals, resourceLimits, userProfile);
  }
}
