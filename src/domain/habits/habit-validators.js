import {
  HABIT_STATUSES,
  HABIT_FREQUENCY_TYPES,
  HABIT_OCCURRENCE_STATUSES,
  ROUTINE_STATUSES,
  ROUTINE_STEP_EXECUTION_STATUSES,
} from '../shared/enums.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { isValidDate, dayOfWeekInTz } from '../../shared/clock.js';

export function validateHabitFrequency(freq) {
  if (!freq || typeof freq !== 'object') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'frequency debe ser un objeto con { type, ... }.', { field: 'frequency' });
  }
  if (!HABIT_FREQUENCY_TYPES.includes(freq.type)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `frequency.type inválido: ${freq.type}`, { field: 'frequency' });
  }
  if (freq.type === 'SPECIFIC_DAYS') {
    if (!Array.isArray(freq.weekdays) || freq.weekdays.length === 0 || freq.weekdays.some(d => !Number.isInteger(Number(d)) || d < 0 || d > 6)) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'SPECIFIC_DAYS requiere weekdays válidos [0..6].', { field: 'frequency.weekdays' });
    }
  }
  if (freq.type === 'TIMES_PER_WEEK') {
    const n = Number(freq.times_per_week);
    if (!Number.isInteger(n) || n < 1 || n > 7) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'TIMES_PER_WEEK requiere times_per_week entre 1 y 7.', { field: 'frequency.times_per_week' });
    }
  }
  if (freq.type === 'INTERVAL') {
    const n = Number(freq.interval_days);
    if (!Number.isInteger(n) || n < 1) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'INTERVAL requiere interval_days entero >= 1.', { field: 'frequency.interval_days' });
    }
  }
}

export function isHabitScheduledOnDate(freq, dateStr, startDate = null, timeZone = 'UTC') {
  if (!freq || !isValidDate(dateStr)) return false;
  if (startDate && dateStr < startDate) return false;
  if (freq.type === 'DAILY') return true;
  if (freq.type === 'SPECIFIC_DAYS') {
    return (freq.weekdays ?? []).map(Number).includes(dayOfWeekInTz(dateStr, timeZone));
  }
  if (freq.type === 'WEEKLY') {
    const targetDay = freq.weekday !== undefined ? Number(freq.weekday) : (startDate ? dayOfWeekInTz(startDate, timeZone) : 1);
    return dayOfWeekInTz(dateStr, timeZone) === targetDay;
  }
  if (freq.type === 'MONTHLY') {
    const dom = Number(dateStr.slice(8, 10));
    const targetDom = freq.day_of_month !== undefined ? Number(freq.day_of_month) : (startDate ? Number(startDate.slice(8, 10)) : 1);
    return dom === targetDom;
  }
  if (freq.type === 'INTERVAL' && startDate) {
    const diffDays = Math.round((new Date(`${dateStr}T12:00:00Z`) - new Date(`${startDate}T12:00:00Z`)) / 86400000);
    return diffDays >= 0 && diffDays % Number(freq.interval_days) === 0;
  }
  // TIMES_PER_WEEK / CUSTOM: elegible cualquier día dentro del periodo
  return true;
}

export function validateHabitInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Hábito inválido.');
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en Habit.', { field: 'name' });
    }
  }
  if (!partial || input.frequency !== undefined) {
    validateHabitFrequency(input.frequency);
  }
  if (input.status !== undefined && !HABIT_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de hábito inválido: ${input.status}`, { field: 'status' });
  }
  if (input.start_date !== undefined && input.start_date !== null && !isValidDate(input.start_date)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'start_date debe ser YYYY-MM-DD.', { field: 'start_date' });
  }
  if (input.end_date !== undefined && input.end_date !== null && !isValidDate(input.end_date)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_date debe ser YYYY-MM-DD.', { field: 'end_date' });
  }
}

export function validateHabitOccurrenceInput(input) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Ocurrencia inválida.');
  if (!isValidDate(input.scheduled_date)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'scheduled_date debe ser YYYY-MM-DD.', { field: 'scheduled_date' });
  }
  if (!HABIT_OCCURRENCE_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de ocurrencia inválido: ${input.status}`, { field: 'status' });
  }
}

export function validateRoutineInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Rutina inválida.');
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en Routine.', { field: 'name' });
    }
  }
  if (input.status !== undefined && !ROUTINE_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de rutina inválido: ${input.status}`, { field: 'status' });
  }
}

export function validateRoutineStepExecutionStatus(status) {
  if (!ROUTINE_STEP_EXECUTION_STATUSES.includes(status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de paso inválido: ${status}`, { field: 'status' });
  }
}
