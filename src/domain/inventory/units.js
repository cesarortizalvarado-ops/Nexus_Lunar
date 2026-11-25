import { ERROR_CODES, NexusError } from '../../shared/errors.js';

export function normalizeUnit(unit) {
  if (typeof unit !== 'string' || !unit.trim() || unit.trim().length > 32) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'unit es obligatorio (máx. 32 caracteres).', { field: 'unit' });
  }
  return unit.trim().toLowerCase();
}

export function validatePositiveQuantity(quantity, field = 'quantity') {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `${field} debe ser un número positivo.`, { field });
  }
  return Number(q.toFixed(6));
}

export function assertCompatibleUnit(expectedUnit, actualUnit) {
  const a = normalizeUnit(expectedUnit);
  const b = normalizeUnit(actualUnit);
  if (a !== b) {
    throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `INV-016: Unidades incompatibles (${a} vs ${b}).`, { field: 'unit' });
  }
}
