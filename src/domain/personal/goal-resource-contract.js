import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { isValidDate } from '../../shared/clock.js';

export const FINANCIAL_FREQUENCIES = Object.freeze(['weekly', 'biweekly', 'monthly']);
export const HEALTH_METRIC_TYPES = Object.freeze(['weight_kg', 'habit_frequency']);

export const BIWEEKLY_FREQUENCY_FACTORS = Object.freeze({
  weekly: 2,
  biweekly: 1,
  monthly: 0.5,
});

export const KCAL_PER_KG = 7700;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

export function validateFinancialImpact(financial) {
  if (financial === undefined || financial === null) return null;
  if (!isPlainObject(financial)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceImpact.financial debe ser un objeto válido.',
      { field: 'resourceImpact.financial' }
    );
  }

  let targetAmount = null;
  if (financial.targetAmount !== undefined && financial.targetAmount !== null) {
    const parsed = Number(financial.targetAmount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'resourceImpact.financial.targetAmount debe ser un número finito mayor o igual a 0.',
        { field: 'resourceImpact.financial.targetAmount' }
      );
    }
    targetAmount = round2(parsed);
  }

  let targetDate = null;
  if (financial.targetDate !== undefined && financial.targetDate !== null) {
    if (!isValidDate(financial.targetDate)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'resourceImpact.financial.targetDate debe ser YYYY-MM-DD.',
        { field: 'resourceImpact.financial.targetDate' }
      );
    }
    targetDate = financial.targetDate;
  }

  if (financial.periodicContribution === undefined || financial.periodicContribution === null) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceImpact.financial.periodicContribution es obligatorio.',
      { field: 'resourceImpact.financial.periodicContribution' }
    );
  }
  const periodicContribution = Number(financial.periodicContribution);
  if (!Number.isFinite(periodicContribution) || periodicContribution < 0) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceImpact.financial.periodicContribution debe ser un número finito mayor o igual a 0.',
      { field: 'resourceImpact.financial.periodicContribution' }
    );
  }

  const frequency = financial.frequency ?? 'biweekly';
  if (!FINANCIAL_FREQUENCIES.includes(frequency)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `resourceImpact.financial.frequency inválida: ${frequency}. Permitidas: ${FINANCIAL_FREQUENCIES.join(', ')}.`,
      { field: 'resourceImpact.financial.frequency' }
    );
  }

  let currency = 'MXN';
  if (financial.currency !== undefined && financial.currency !== null) {
    if (typeof financial.currency !== 'string' || !financial.currency.trim()) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'resourceImpact.financial.currency debe ser una cadena no vacía.',
        { field: 'resourceImpact.financial.currency' }
      );
    }
    currency = financial.currency.trim().toUpperCase();
  }

  return {
    targetAmount,
    targetDate,
    periodicContribution: round2(periodicContribution),
    currency,
    frequency,
  };
}

export function validateTimeImpact(time) {
  if (time === undefined || time === null) return null;
  if (!isPlainObject(time)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceImpact.time debe ser un objeto válido.',
      { field: 'resourceImpact.time' }
    );
  }

  if (time.weeklyHoursRequired === undefined || time.weeklyHoursRequired === null) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceImpact.time.weeklyHoursRequired es obligatorio.',
      { field: 'resourceImpact.time.weeklyHoursRequired' }
    );
  }
  const weeklyHoursRequired = Number(time.weeklyHoursRequired);
  if (!Number.isFinite(weeklyHoursRequired) || weeklyHoursRequired < 0 || weeklyHoursRequired > 168) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceImpact.time.weeklyHoursRequired debe ser un número entre 0 y 168.',
      { field: 'resourceImpact.time.weeklyHoursRequired' }
    );
  }

  let preferredWindows = [];
  if (time.preferredWindows !== undefined && time.preferredWindows !== null) {
    if (!Array.isArray(time.preferredWindows)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'resourceImpact.time.preferredWindows debe ser un arreglo.',
        { field: 'resourceImpact.time.preferredWindows' }
      );
    }
    preferredWindows = time.preferredWindows.map((w) => (typeof w === 'string' ? w.trim() : w));
  }

  return {
    weeklyHoursRequired: round2(weeklyHoursRequired),
    preferredWindows,
  };
}

export function validateHealthImpact(health) {
  if (health === undefined || health === null) return null;
  if (!isPlainObject(health)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceImpact.health debe ser un objeto válido.',
      { field: 'resourceImpact.health' }
    );
  }

  if (!HEALTH_METRIC_TYPES.includes(health.metricType)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `resourceImpact.health.metricType inválido: ${health.metricType}. Permitidos: ${HEALTH_METRIC_TYPES.join(', ')}.`,
      { field: 'resourceImpact.health.metricType' }
    );
  }

  let currentMetric = null;
  if (health.currentMetric !== undefined && health.currentMetric !== null) {
    const parsed = Number(health.currentMetric);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'resourceImpact.health.currentMetric debe ser un número finito mayor o igual a 0.',
        { field: 'resourceImpact.health.currentMetric' }
      );
    }
    currentMetric = round2(parsed);
  }

  let targetMetric = null;
  if (health.targetMetric !== undefined && health.targetMetric !== null) {
    const parsed = Number(health.targetMetric);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'resourceImpact.health.targetMetric debe ser un número finito mayor o igual a 0.',
        { field: 'resourceImpact.health.targetMetric' }
      );
    }
    targetMetric = round2(parsed);
  }

  let weeklyTargetDelta = 0;
  if (health.weeklyTargetDelta !== undefined && health.weeklyTargetDelta !== null) {
    const parsed = Number(health.weeklyTargetDelta);
    if (!Number.isFinite(parsed)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'resourceImpact.health.weeklyTargetDelta debe ser un número finito.',
        { field: 'resourceImpact.health.weeklyTargetDelta' }
      );
    }
    weeklyTargetDelta = round2(parsed);
  }

  return {
    currentMetric,
    targetMetric,
    metricType: health.metricType,
    weeklyTargetDelta,
  };
}

export function validateResourceImpact(resourceImpact) {
  if (resourceImpact === undefined || resourceImpact === null) return null;
  if (!isPlainObject(resourceImpact)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'resourceImpact debe ser un objeto válido.',
      { field: 'resourceImpact' }
    );
  }

  return {
    financial: validateFinancialImpact(resourceImpact.financial),
    time: validateTimeImpact(resourceImpact.time),
    health: validateHealthImpact(resourceImpact.health),
  };
}

export function normalizeResourceImpact(resourceImpact) {
  if (resourceImpact === undefined || resourceImpact === null) {
    return { financial: null, time: null, health: null };
  }
  return validateResourceImpact(resourceImpact);
}

export function extractGoalResourceImpact(goal) {
  if (!isPlainObject(goal)) {
    return { financial: null, time: null, health: null };
  }
  const raw = goal.resourceImpact !== undefined ? goal.resourceImpact : goal.resource_impact;
  if (raw === undefined || raw === null) {
    return { financial: null, time: null, health: null };
  }
  return normalizeResourceImpact(raw);
}

export function normalizeFinancialToBiweekly(financial) {
  if (!financial) return 0;
  const factor = BIWEEKLY_FREQUENCY_FACTORS[financial.frequency] ?? 1;
  return round2(financial.periodicContribution * factor);
}

export function estimateWeeklyCaloricDeficit(health) {
  if (!health || health.metricType !== 'weight_kg') return 0;
  const delta = Number(health.weeklyTargetDelta ?? 0);
  if (!Number.isFinite(delta) || delta === 0) return 0;

  // Negative delta explicitly represents weight loss (e.g. -0.5 kg/week).
  // Positive delta with targetMetric < currentMetric is also treated as weight loss magnitude.
  if (delta < 0) {
    return round2(Math.abs(delta) * KCAL_PER_KG);
  }
  if (
    health.currentMetric !== null &&
    health.targetMetric !== null &&
    health.targetMetric < health.currentMetric
  ) {
    return round2(delta * KCAL_PER_KG);
  }
  return 0;
}
