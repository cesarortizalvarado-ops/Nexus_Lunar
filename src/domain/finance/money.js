import { ERROR_CODES, NexusError } from '../../shared/errors.js';

const CURRENCY_RE = /^[A-Z]{3}$/;

export function normalizeCurrency(currency) {
  const c = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!CURRENCY_RE.test(c)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Moneda ISO-4217 inválida: ${currency}`, { field: 'currency' });
  }
  return c;
}

export function toMinorUnits(amount, scale = 2) {
  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'amount numérico es obligatorio.', { field: 'amount' });
  }
  const factor = 10 ** scale;
  const minor = Math.round(Number(amount) * factor);
  if (!Number.isSafeInteger(minor)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'amount fuera de rango seguro.', { field: 'amount' });
  }
  return minor;
}

export function fromMinorUnits(minor, scale = 2) {
  const factor = 10 ** scale;
  return Number((Number(minor) / factor).toFixed(scale));
}

export function assertSameCurrency(a, b) {
  if (a !== b) {
    throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `INV-015: No se pueden operar monedas distintas sin conversión explícita (${a} vs ${b}).`);
  }
}
