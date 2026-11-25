import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { isValidDate } from '../../shared/clock.js';

export const MOOD_LABELS = Object.freeze([
  'very_low',
  'low',
  'neutral',
  'good',
  'great',
  'anxious',
  'stressed',
  'calm',
  'focused',
  'tired',
]);

export const IMPORTANT_DATE_CATEGORIES = Object.freeze([
  'birthday',
  'anniversary',
  'renewal',
  'deadline',
  'custom',
]);

export const IMPORTANT_DATE_RECURRENCES = Object.freeze(['ANNUAL', 'ONCE']);

const SCORE_TO_MOOD_LABEL = Object.freeze({
  1: 'very_low',
  2: 'low',
  3: 'neutral',
  4: 'good',
  5: 'great',
});

const MAX_DAYS_IN_MONTH = Object.freeze({
  1: 31,
  2: 29,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
});

function validateScaleInt(value, fieldName, fallback = undefined) {
  const raw = value === undefined || value === null ? fallback : value;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 5) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `${fieldName} debe ser un entero entre 1 y 5.`,
      { field: fieldName }
    );
  }
  return num;
}

export function validateMoodEntryInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Entrada emocional inválida.');
  }

  if (input.entry_date !== undefined && input.entry_date !== null && !isValidDate(input.entry_date)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'entry_date debe ser YYYY-MM-DD.', {
      field: 'entry_date',
    });
  }

  const mood_score = validateScaleInt(input.mood_score, 'mood_score');
  const energy_level = validateScaleInt(input.energy_level, 'energy_level', 3);
  const stress_level = validateScaleInt(input.stress_level, 'stress_level', 3);

  const mood_label =
    input.mood_label !== undefined && input.mood_label !== null && String(input.mood_label).trim() !== ''
      ? String(input.mood_label).trim().toLowerCase()
      : SCORE_TO_MOOD_LABEL[mood_score];

  if (!MOOD_LABELS.includes(mood_label)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `mood_label inválido: ${mood_label}. Permitidos: ${MOOD_LABELS.join(', ')}.`,
      { field: 'mood_label' }
    );
  }

  let triggers = [];
  if (input.triggers !== undefined && input.triggers !== null) {
    if (!Array.isArray(input.triggers)) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'triggers debe ser un arreglo de cadenas.', {
        field: 'triggers',
      });
    }
    triggers = input.triggers
      .map((t) => {
        if (typeof t !== 'string') {
          throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Cada trigger debe ser una cadena de texto.', {
            field: 'triggers',
          });
        }
        return t.trim();
      })
      .filter(Boolean);
  }

  const notes = input.notes !== undefined && input.notes !== null ? String(input.notes).trim() : '';

  return {
    entry_date: input.entry_date ?? null,
    mood_score,
    energy_level,
    stress_level,
    mood_label,
    triggers,
    notes,
  };
}

export function validateImportantDateInput(input, isPatch = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Fecha importante inválida.');
  }

  if (!isPatch || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'title es obligatorio en ImportantDate.', {
        field: 'title',
      });
    }
  }

  if (!isPatch || input.category !== undefined) {
    if (!IMPORTANT_DATE_CATEGORIES.includes(input.category)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `category inválida en ImportantDate: ${input.category}. Permitidas: ${IMPORTANT_DATE_CATEGORIES.join(', ')}.`,
        { field: 'category' }
      );
    }
  }

  let month = null;
  if (!isPatch || input.month !== undefined) {
    month = Number(input.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'month debe ser un entero entre 1 y 12.', {
        field: 'month',
      });
    }
  }

  if (!isPatch || input.day !== undefined) {
    const day = Number(input.day);
    const maxDay = month ? MAX_DAYS_IN_MONTH[month] : 31;
    if (!Number.isInteger(day) || day < 1 || day > maxDay) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `day debe ser un entero entre 1 y ${maxDay}${month ? ` para el mes ${month}` : ''}.`,
        { field: 'day' }
      );
    }
  }

  const recurrence = input.recurrence ?? 'ANNUAL';
  if (!isPatch || input.recurrence !== undefined) {
    if (!IMPORTANT_DATE_RECURRENCES.includes(recurrence)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `recurrence inválida: ${recurrence}. Permitidas: ${IMPORTANT_DATE_RECURRENCES.join(', ')}.`,
        { field: 'recurrence' }
      );
    }
  }

  if (input.year !== undefined && input.year !== null) {
    const y = Number(input.year);
    if (!Number.isInteger(y) || y < 1900 || y > 2200) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'year debe ser un entero válido.', {
        field: 'year',
      });
    }
  }

  if (!isPatch && recurrence === 'ONCE' && (input.year === undefined || input.year === null)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'year es obligatorio cuando recurrence es ONCE.',
      { field: 'year' }
    );
  }
}
