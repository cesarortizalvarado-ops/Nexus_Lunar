import {
  GOAL_STATUSES,
  PROJECT_STATUSES,
  TASK_STATUSES,
  ACTIVITY_STATUSES,
} from '../shared/enums.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { isValidDate } from '../../shared/clock.js';

export const GOAL_TRANSITIONS = Object.freeze({
  ACTIVE: ['ON_HOLD', 'ACHIEVED', 'PARTIALLY_ACHIEVED', 'ABANDONED', 'ARCHIVED'],
  ON_HOLD: ['ACTIVE', 'ABANDONED', 'ARCHIVED'],
  ACHIEVED: ['ARCHIVED'],
  PARTIALLY_ACHIEVED: ['ACTIVE', 'ACHIEVED', 'ABANDONED', 'ARCHIVED'],
  ABANDONED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE'],
});

export const PROJECT_TRANSITIONS = Object.freeze({
  PLANNING: ['ACTIVE', 'PAUSED', 'BLOCKED', 'CANCELLED', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'BLOCKED', 'CANCELLED', 'ARCHIVED'],
  BLOCKED: ['ACTIVE', 'PAUSED', 'CANCELLED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED', 'PLANNING'],
  ARCHIVED: ['ACTIVE'],
});

export const TASK_TRANSITIONS = Object.freeze({
  PENDING: ['PREPARATION', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'ARCHIVED'],
  PREPARATION: ['IN_PROGRESS', 'WAITING', 'BLOCKED', 'CANCELLED', 'ARCHIVED'],
  IN_PROGRESS: ['WAITING', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'PENDING'],
  WAITING: ['IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'],
  BLOCKED: ['PENDING', 'PREPARATION', 'IN_PROGRESS', 'WAITING', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED', 'PENDING'],
  ARCHIVED: ['PENDING'],
});

export function assertTransition(map, current, next, entityName) {
  if (current === next) return;
  const allowed = map[current] ?? [];
  if (!allowed.includes(next)) {
    throw new NexusError(
      ERROR_CODES.CONFLICT,
      `Transición de estado inválida para ${entityName}: ${current} -> ${next}.`,
      { entity: entityName, field: 'status' }
    );
  }
}

export function validateGoalInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Objetivo inválido.');
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en Goal.', { field: 'name' });
    }
  }
  if (input.status !== undefined && !GOAL_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de objetivo inválido: ${input.status}`, { field: 'status' });
  }
  if (input.target_date !== undefined && input.target_date !== null && !isValidDate(input.target_date)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'target_date debe ser YYYY-MM-DD.', { field: 'target_date' });
  }
}

export function validateProjectInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Proyecto inválido.');
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en Project.', { field: 'name' });
    }
  }
  if (input.status !== undefined && !PROJECT_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de proyecto inválido: ${input.status}`, { field: 'status' });
  }
  for (const f of ['start_date', 'target_date']) {
    if (input[f] !== undefined && input[f] !== null && !isValidDate(input[f])) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `${f} debe ser YYYY-MM-DD.`, { field: f });
    }
  }
}

export function validateTaskInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Tarea inválida.');
  if (!partial || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'title es obligatorio en Task.', { field: 'title' });
    }
  }
  if (input.status !== undefined && !TASK_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de tarea inválido: ${input.status}`, { field: 'status' });
  }
  if (input.estimated_duration_minutes !== undefined && input.estimated_duration_minutes !== null) {
    const n = Number(input.estimated_duration_minutes);
    if (!Number.isInteger(n) || n < 1) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'estimated_duration_minutes debe ser entero positivo.', { field: 'estimated_duration_minutes' });
    }
  }
  if (input.due_date !== undefined && input.due_date !== null && !isValidDate(input.due_date)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'due_date debe ser YYYY-MM-DD.', { field: 'due_date' });
  }
}

export function validateActivityInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Actividad inválida.');
  if (!partial || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en Activity.', { field: 'name' });
    }
  }
  if (input.status !== undefined && !ACTIVITY_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de actividad inválido: ${input.status}`, { field: 'status' });
  }
  if (input.expected_duration_minutes !== undefined && input.expected_duration_minutes !== null) {
    const n = Number(input.expected_duration_minutes);
    if (!Number.isInteger(n) || n < 1) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'expected_duration_minutes debe ser entero positivo.', { field: 'expected_duration_minutes' });
    }
  }
}
