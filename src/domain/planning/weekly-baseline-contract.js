import crypto from 'node:crypto';

export const EXECUTION_STATUSES = Object.freeze([
  'completed',
  'partial',
  'postponed',
  'interrupted',
  'blocked',
  'cancelled',
  'missed_with_reason',
  'off_schedule',
  'unconfirmed',
]);

export const BLOCK_CATEGORIES = Object.freeze([
  'sleep',
  'work_fixed',
  'work_freelance',
  'commitment',
  'exercise',
  'meal',
  'goal_task',
]);

export function canonicalizeForHash(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeForHash);
  }
  const sortedKeys = Object.keys(value).sort();
  const normalized = {};
  for (const key of sortedKeys) {
    if (value[key] !== undefined) {
      normalized[key] = canonicalizeForHash(value[key]);
    }
  }
  return normalized;
}

export function computeDeterministicHash(payload) {
  const serialized = JSON.stringify(canonicalizeForHash(payload));
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

export function validateScheduleBlock(block) {
  if (!block || typeof block !== 'object') {
    throw new Error('INVALID_SCHEDULE_BLOCK: Bloque requerido.');
  }
  if (!block.id || typeof block.id !== 'string') {
    throw new Error('INVALID_BLOCK_ID: El bloque requiere un id.');
  }
  if (!BLOCK_CATEGORIES.includes(block.category)) {
    throw new Error(`INVALID_BLOCK_CATEGORY: Categoría inválida (${block.category}).`);
  }
  if (!Number.isInteger(block.dayOfWeek) || block.dayOfWeek < 0 || block.dayOfWeek > 6) {
    throw new Error('INVALID_BLOCK_DAY: dayOfWeek debe estar entre 0 y 6.');
  }
  if (
    typeof block.startHour !== 'number' ||
    typeof block.endHour !== 'number' ||
    block.startHour < 0 ||
    block.endHour > 24 ||
    block.endHour <= block.startHour
  ) {
    throw new Error(`INVALID_BLOCK_WINDOW: Ventana horaria inválida (${block.startHour}-${block.endHour}).`);
  }
  return true;
}

export function validateExecutionRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('INVALID_EXECUTION_RECORD: Registro requerido.');
  }
  if (!record.blockId || typeof record.blockId !== 'string') {
    throw new Error('INVALID_EXECUTION_BLOCK_ID: blockId requerido.');
  }
  if (!EXECUTION_STATUSES.includes(record.status)) {
    throw new Error(`INVALID_EXECUTION_STATUS: Estado inválido (${record.status}).`);
  }
  if (record.status === 'missed_with_reason' && (!record.reason || typeof record.reason !== 'string')) {
    throw new Error('MISSING_EXECUTION_REASON: missed_with_reason exige especificar reason.');
  }
  return true;
}

export function sealWeeklyBaseline(weeklyDraft, { baselineId, approvedAt, approvedBy = 'user' } = {}) {
  if (!weeklyDraft || typeof weeklyDraft !== 'object') {
    throw new Error('INVALID_WEEKLY_DRAFT: Borrador semanal requerido.');
  }
  if (!weeklyDraft.weekStartDate || !Array.isArray(weeklyDraft.dailySchedules) || weeklyDraft.dailySchedules.length !== 7) {
    throw new Error('INVALID_WEEKLY_DRAFT_STRUCTURE: El borrador debe incluir weekStartDate y 7 días.');
  }

  for (const day of weeklyDraft.dailySchedules) {
    if (!Array.isArray(day.blocks)) {
      throw new Error('INVALID_DAY_BLOCKS: Cada día debe contener un arreglo de bloques.');
    }
    day.blocks.forEach(validateScheduleBlock);
  }

  const resolvedApprovedAt = approvedAt || new Date().toISOString();
  const clonedPlan = structuredClone(weeklyDraft);
  clonedPlan.status = 'approved_immutable';

  const resolvedId =
    baselineId ||
    `baseline-${clonedPlan.weekStartDate}-${computeDeterministicHash({
      weekStartDate: clonedPlan.weekStartDate,
      approvedAt: resolvedApprovedAt,
    }).slice(0, 8)}`;

  const integrityHash = computeDeterministicHash({
    baselineId: resolvedId,
    approvedAt: resolvedApprovedAt,
    approvedBy,
    plan: clonedPlan,
  });

  return deepFreeze({
    baselineId: resolvedId,
    status: 'approved_immutable',
    approvedAt: resolvedApprovedAt,
    approvedBy,
    integrityHash,
    plan: clonedPlan,
  });
}

export function verifyBaselineIntegrity(baseline) {
  if (!baseline || typeof baseline !== 'object' || !baseline.integrityHash || !baseline.plan) {
    return { valid: false, reason: 'MALFORMED_BASELINE' };
  }

  const recomputedHash = computeDeterministicHash({
    baselineId: baseline.baselineId,
    approvedAt: baseline.approvedAt,
    approvedBy: baseline.approvedBy,
    plan: baseline.plan,
  });

  const valid = recomputedHash === baseline.integrityHash;
  return {
    valid,
    expectedHash: baseline.integrityHash,
    actualHash: recomputedHash,
    reason: valid ? null : 'BASELINE_TAMPERED',
  };
}
