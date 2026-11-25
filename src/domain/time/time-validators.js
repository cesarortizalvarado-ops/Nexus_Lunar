import {
  CALENDAR_EVENT_STATUSES,
  COMMITMENT_STATUSES,
  AVAILABILITY_TYPES,
  TIME_BLOCK_TYPES,
} from '../shared/enums.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { isValidIsoDateTime, isValidTimeZone } from '../../shared/clock.js';

export function validateCalendarEventInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Evento inválido.');
  if (!partial || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'title es obligatorio en CalendarEvent.', { field: 'title' });
    }
  }
  if (input.status !== undefined && !CALENDAR_EVENT_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `status inválido: ${input.status}`, { field: 'status' });
  }
  if (!partial || input.start_at !== undefined) {
    if (!isValidIsoDateTime(input.start_at)) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'start_at debe ser ISO 8601 con zona horaria.', { field: 'start_at' });
    }
  }
  if (!partial || input.end_at !== undefined) {
    if (!isValidIsoDateTime(input.end_at)) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at debe ser ISO 8601 con zona horaria.', { field: 'end_at' });
    }
  }
  if (input.start_at && input.end_at && new Date(input.end_at) <= new Date(input.start_at)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at debe ser posterior a start_at.', { field: 'end_at' });
  }
  if (input.timezone !== undefined && input.timezone !== null && !isValidTimeZone(input.timezone)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `timezone IANA inválido: ${input.timezone}`, { field: 'timezone' });
  }
}

export function validateCommitmentInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Compromiso inválido.');
  if (!partial || input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'title es obligatorio en Commitment.', { field: 'title' });
    }
  }
  if (input.status !== undefined && !COMMITMENT_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `status inválido: ${input.status}`, { field: 'status' });
  }
  if (input.due_at !== undefined && input.due_at !== null && !isValidIsoDateTime(input.due_at)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'due_at debe ser ISO 8601 con zona horaria.', { field: 'due_at' });
  }
}

export function validateAvailabilityWindowInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Ventana de disponibilidad inválida.');
  if (!partial || input.start_at !== undefined) {
    if (!isValidIsoDateTime(input.start_at)) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'start_at inválido.', { field: 'start_at' });
  }
  if (!partial || input.end_at !== undefined) {
    if (!isValidIsoDateTime(input.end_at)) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at inválido.', { field: 'end_at' });
  }
  if (input.start_at && input.end_at && new Date(input.end_at) <= new Date(input.start_at)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at debe ser posterior a start_at.', { field: 'end_at' });
  }
  if (!partial || input.availability_type !== undefined) {
    if (!AVAILABILITY_TYPES.includes(input.availability_type)) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `availability_type inválido: ${input.availability_type}`, { field: 'availability_type' });
    }
  }
}

export function validateTimeBlockInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'TimeBlock inválido.');
  if (!partial || input.start_at !== undefined) {
    if (!isValidIsoDateTime(input.start_at)) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'start_at inválido.', { field: 'start_at' });
  }
  if (!partial || input.end_at !== undefined) {
    if (!isValidIsoDateTime(input.end_at)) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at inválido.', { field: 'end_at' });
  }
  if (input.start_at && input.end_at && new Date(input.end_at) <= new Date(input.start_at)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at debe ser posterior a start_at.', { field: 'end_at' });
  }
  if (input.block_type !== undefined && !TIME_BLOCK_TYPES.includes(input.block_type)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `block_type inválido: ${input.block_type}`, { field: 'block_type' });
  }
}

export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(aEnd).getTime() > new Date(bStart).getTime();
}

/**
 * Resta intervalos ocupados (eventos confirmados, bloques fijos, ventanas UNAVAILABLE/RESERVED)
 * únicamente de ventanas explícitas CONFIRMED o POTENTIAL.
 * PLN-004: Nunca convierte tiempo sin registro en disponibilidad libre (se clasifica como UNKNOWN).
 */
export function subtractBusyFromWindows(windows, busyIntervals) {
  const result = [];
  for (const win of windows) {
    if (win.availability_type !== 'CONFIRMED' && win.availability_type !== 'POTENTIAL') continue;
    let segments = [{ start: new Date(win.start_at).getTime(), end: new Date(win.end_at).getTime() }];
    for (const busy of busyIntervals) {
      const bStart = new Date(busy.start_at).getTime();
      const bEnd = new Date(busy.end_at).getTime();
      const next = [];
      for (const seg of segments) {
        if (bEnd <= seg.start || bStart >= seg.end) {
          next.push(seg);
        } else {
          if (bStart > seg.start) next.push({ start: seg.start, end: bStart });
          if (bEnd < seg.end) next.push({ start: bEnd, end: seg.end });
        }
      }
      segments = next;
    }
    for (const seg of segments) {
      if (seg.end > seg.start) {
        result.push({
          start_at: new Date(seg.start).toISOString(),
          end_at: new Date(seg.end).toISOString(),
          duration_minutes: Math.round((seg.end - seg.start) / 60000),
          availability_type: win.availability_type,
          calculated: true,
          source_window_id: win.id,
        });
      }
    }
  }
  return result.sort((a, b) => a.start_at.localeCompare(b.start_at));
}
