import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { minutesBetween, toUtcIso } from '../../shared/clock.js';
import {
  validateCalendarEventInput,
  validateCommitmentInput,
  validateAvailabilityWindowInput,
  validateTimeBlockInput,
  intervalsOverlap,
  subtractBusyFromWindows,
} from '../../domain/time/time-validators.js';

export function createCalendarService({ timeRepository, referenceResolver = null, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const defaultTz = () => clock?.timezone ?? 'UTC';

  function detectConflictsFor(event) {
    if (event.status === 'CANCELLED') return [];
    const others = timeRepository.listEvents({ from: event.start_at, to: event.end_at })
      .filter(o => o.id !== event.id && o.status !== 'CANCELLED');
    return others.filter(o => intervalsOverlap(event.start_at, event.end_at, o.start_at, o.end_at));
  }

  return {
    createEvent(input) {
      validateCalendarEventInput(input, false);
      if (input.related_entity_type || input.related_entity_id) {
        referenceResolver?.assertExists(input.related_entity_type, input.related_entity_id);
      }
      const now = nowIso();
      const event = {
        id: randomUUID(),
        title: input.title.trim(),
        description: (input.description ?? '').trim(),
        event_type: input.event_type ?? 'EVENT',
        start_at: toUtcIso(input.start_at),
        end_at: toUtcIso(input.end_at),
        timezone: input.timezone ?? defaultTz(),
        location: input.location?.trim() || null,
        status: input.status ?? 'PROPOSED',
        source_id: input.source_id ?? null,
        related_entity_type: input.related_entity_type ?? null,
        related_entity_id: input.related_entity_id ?? null,
        created_at: now,
        updated_at: now,
      };
      timeRepository.insertEvent(event);
      auditService?.recordChange({ entity_type: 'calendar_event', entity_id: event.id, operation_type: 'calendar.create', new_state: event });
      return { event, conflicts: detectConflictsFor(event) };
    },

    getEvent(id) {
      const event = timeRepository.findEventById(id);
      if (!event) throw new NexusError(ERROR_CODES.NOT_FOUND, `Evento no encontrado: ${id}`, { entity: 'CalendarEvent' });
      return { event, conflicts: detectConflictsFor(event) };
    },

    listEvents(filters = {}) {
      return timeRepository.listEvents(filters);
    },

    getEventsByPeriod(from, to, { status = null } = {}) {
      return timeRepository.listEvents({ from, to, status });
    },

    updateEvent(id, patch, { reason = null, operationType = 'calendar.update' } = {}) {
      const current = timeRepository.findEventById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Evento no encontrado: ${id}`, { entity: 'CalendarEvent' });
      validateCalendarEventInput(patch, true);
      const nextRelType = patch.related_entity_type !== undefined ? patch.related_entity_type : current.related_entity_type;
      const nextRelId = patch.related_entity_id !== undefined ? patch.related_entity_id : current.related_entity_id;
      if (nextRelType || nextRelId) {
        referenceResolver?.assertExists(nextRelType, nextRelId);
      }
      const start_at = patch.start_at !== undefined ? toUtcIso(patch.start_at) : current.start_at;
      const end_at = patch.end_at !== undefined ? toUtcIso(patch.end_at) : current.end_at;
      if (new Date(end_at) <= new Date(start_at)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at debe ser posterior a start_at.');
      }
      const updated = {
        ...current,
        title: patch.title !== undefined ? patch.title.trim() : current.title,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        event_type: patch.event_type ?? current.event_type,
        start_at,
        end_at,
        timezone: patch.timezone ?? current.timezone,
        location: patch.location !== undefined ? (patch.location?.trim() || null) : current.location,
        status: patch.status ?? current.status,
        related_entity_type: nextRelType,
        related_entity_id: nextRelId,
        updated_at: nowIso(),
      };
      timeRepository.updateEvent(updated);
      auditService?.recordChange({
        entity_type: 'calendar_event',
        entity_id: id,
        operation_type: operationType,
        previous_state: current,
        new_state: updated,
        reason,
      });
      return { event: updated, conflicts: detectConflictsFor(updated) };
    },

    rescheduleEvent(id, { start_at, end_at, timezone, reason = 'Reprogramación explícita de evento' } = {}) {
      if (!start_at || !end_at) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'start_at y end_at son obligatorios para reprogramar un evento.');
      }
      const current = timeRepository.findEventById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Evento no encontrado: ${id}`, { entity: 'CalendarEvent' });
      const previous_schedule = { start_at: current.start_at, end_at: current.end_at, timezone: current.timezone };
      const res = this.updateEvent(id, { start_at, end_at, ...(timezone ? { timezone } : {}) }, {
        reason,
        operationType: 'calendar.reschedule',
      });
      return { ...res, previous_schedule };
    },

    confirmEvent(id) {
      return this.updateEvent(id, { status: 'CONFIRMED' }, { operationType: 'calendar.confirm' });
    },

    cancelEvent(id, { reason = null } = {}) {
      return this.updateEvent(id, { status: 'CANCELLED' }, { reason, operationType: 'calendar.cancel' });
    },

    detectEventConflicts({ from = null, to = null } = {}) {
      const events = timeRepository.listEvents({ from, to }).filter(e => e.status !== 'CANCELLED');
      const pairs = [];
      for (let i = 0; i < events.length; i += 1) {
        for (let j = i + 1; j < events.length; j += 1) {
          if (intervalsOverlap(events[i].start_at, events[i].end_at, events[j].start_at, events[j].end_at)) {
            pairs.push({ first: events[i], second: events[j] });
          }
        }
      }
      return pairs;
    },
  };
}

export function createCommitmentService({ timeRepository, referenceResolver = null, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createCommitment(input) {
      validateCommitmentInput(input, false);
      if (input.related_entity_type || input.related_entity_id) {
        referenceResolver?.assertExists(input.related_entity_type, input.related_entity_id);
      }
      const now = nowIso();
      const c = {
        id: randomUUID(),
        title: input.title.trim(),
        description: (input.description ?? '').trim(),
        commitment_type: input.commitment_type ?? 'OBLIGATION',
        due_at: input.due_at ? toUtcIso(input.due_at) : null,
        status: input.status ?? 'PENDING',
        importance: Number(input.importance ?? 3),
        source_id: input.source_id ?? null,
        related_entity_type: input.related_entity_type ?? null,
        related_entity_id: input.related_entity_id ?? null,
        created_at: now,
        updated_at: now,
      };
      timeRepository.insertCommitment(c);
      auditService?.recordChange({ entity_type: 'commitment', entity_id: c.id, operation_type: 'commitment.create', new_state: c });
      return c;
    },

    getCommitment(id) {
      const c = timeRepository.findCommitmentById(id);
      if (!c) throw new NexusError(ERROR_CODES.NOT_FOUND, `Compromiso no encontrado: ${id}`, { entity: 'Commitment' });
      return c;
    },

    listCommitments(filters = {}) {
      return timeRepository.listCommitments(filters);
    },

    updateCommitment(id, patch) {
      const current = this.getCommitment(id);
      validateCommitmentInput(patch, true);
      const updated = {
        ...current,
        title: patch.title !== undefined ? patch.title.trim() : current.title,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        commitment_type: patch.commitment_type ?? current.commitment_type,
        due_at: patch.due_at !== undefined ? (patch.due_at ? toUtcIso(patch.due_at) : null) : current.due_at,
        status: patch.status ?? current.status,
        importance: patch.importance !== undefined ? Number(patch.importance) : current.importance,
        updated_at: nowIso(),
      };
      timeRepository.updateCommitment(updated);
      auditService?.recordChange({ entity_type: 'commitment', entity_id: id, operation_type: 'commitment.update', previous_state: current, new_state: updated });
      return updated;
    },

    completeCommitment(id) {
      return this.updateCommitment(id, { status: 'COMPLETED' });
    },

    cancelCommitment(id) {
      return this.updateCommitment(id, { status: 'CANCELLED' });
    },
  };
}

export function createAvailabilityService({ timeRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createAvailabilityWindow(input) {
      validateAvailabilityWindowInput(input, false);
      const now = nowIso();
      const win = {
        id: randomUUID(),
        start_at: toUtcIso(input.start_at),
        end_at: toUtcIso(input.end_at),
        availability_type: input.availability_type,
        confidence: input.confidence !== undefined && input.confidence !== null ? Number(input.confidence) : null,
        source_id: input.source_id ?? null,
        notes: (input.notes ?? '').trim(),
        created_at: now,
        updated_at: now,
      };
      return timeRepository.insertAvailabilityWindow(win);
    },

    updateAvailabilityWindow(id, patch) {
      const current = timeRepository.findAvailabilityWindowById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Ventana no encontrada: ${id}`, { entity: 'AvailabilityWindow' });
      validateAvailabilityWindowInput(patch, true);
      const start_at = patch.start_at ? toUtcIso(patch.start_at) : current.start_at;
      const end_at = patch.end_at ? toUtcIso(patch.end_at) : current.end_at;
      if (new Date(end_at) <= new Date(start_at)) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at debe ser posterior a start_at.');
      const updated = {
        ...current,
        start_at,
        end_at,
        availability_type: patch.availability_type ?? current.availability_type,
        confidence: patch.confidence !== undefined ? patch.confidence : current.confidence,
        notes: patch.notes !== undefined ? patch.notes.trim() : current.notes,
        updated_at: nowIso(),
      };
      return timeRepository.updateAvailabilityWindow(updated);
    },

    getAvailability({ from = null, to = null } = {}) {
      const windows = timeRepository.listAvailabilityWindows({ from, to });
      return {
        from,
        to,
        windows,
        has_confirmed_windows: windows.some(w => w.availability_type === 'CONFIRMED'),
        unregistered_time_policy: 'UNKNOWN', // PLN-004
      };
    },

    calculateFreeWindows({ from, to, includePotential = false } = {}) {
      const windows = timeRepository.listAvailabilityWindows({ from, to })
        .filter(w => w.availability_type === 'CONFIRMED' || (includePotential && w.availability_type === 'POTENTIAL'));
      const unavailable = timeRepository.listAvailabilityWindows({ from, to })
        .filter(w => w.availability_type === 'UNAVAILABLE' || w.availability_type === 'RESERVED');
      const confirmedEvents = timeRepository.listEvents({ from, to, status: 'CONFIRMED' });
      const fixedBlocks = timeRepository.listTimeBlocks({ from, to }).filter(b => b.block_type === 'FIXED');
      const busy = [...unavailable, ...confirmedEvents, ...fixedBlocks];

      const freeWindows = subtractBusyFromWindows(windows, busy);
      return {
        from,
        to,
        calculated: true,
        free_windows: freeWindows,
        unregistered_periods_status: 'UNKNOWN',
      };
    },

    reserveTimeWindow({ start_at, end_at, notes = 'Reservado', source_id = null }) {
      return this.createAvailabilityWindow({ start_at, end_at, availability_type: 'RESERVED', notes, source_id });
    },

    releaseTimeWindow(id) {
      return this.updateAvailabilityWindow(id, { availability_type: 'CONFIRMED', notes: 'Liberado' });
    },
  };
}

export function createTimeBlockService({ timeRepository, referenceResolver = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function conflictsForBlock(block) {
    // INV-019: Detecta conflictos contra eventos confirmados y otros bloques sin modificar los compromisos
    const confirmedEvents = timeRepository.listEvents({ from: block.start_at, to: block.end_at, status: 'CONFIRMED' })
      .filter(e => intervalsOverlap(block.start_at, block.end_at, e.start_at, e.end_at));
    const otherBlocks = timeRepository.listTimeBlocks({ from: block.start_at, to: block.end_at })
      .filter(b => b.id !== block.id && intervalsOverlap(block.start_at, block.end_at, b.start_at, b.end_at));
    return { confirmed_events: confirmedEvents, time_blocks: otherBlocks };
  }

  return {
    createTimeBlock(input) {
      validateTimeBlockInput(input, false);
      if (input.related_entity_type || input.related_entity_id) {
        referenceResolver?.assertExists(input.related_entity_type, input.related_entity_id);
      }
      const start_at = toUtcIso(input.start_at);
      const end_at = toUtcIso(input.end_at);
      const now = nowIso();
      const block = {
        id: randomUUID(),
        start_at,
        end_at,
        duration_minutes: minutesBetween(start_at, end_at),
        block_type: input.block_type ?? 'FLEXIBLE',
        status: input.status ?? 'PLANNED',
        related_entity_type: input.related_entity_type ?? null,
        related_entity_id: input.related_entity_id ?? null,
        plan_version_id: input.plan_version_id ?? null,
        created_at: now,
        updated_at: now,
      };
      timeRepository.insertTimeBlock(block);
      return { block, conflicts: conflictsForBlock(block) };
    },

    updateTimeBlock(id, patch) {
      const current = timeRepository.findTimeBlockById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `TimeBlock no encontrado: ${id}`, { entity: 'TimeBlock' });
      validateTimeBlockInput(patch, true);
      const start_at = patch.start_at ? toUtcIso(patch.start_at) : current.start_at;
      const end_at = patch.end_at ? toUtcIso(patch.end_at) : current.end_at;
      if (new Date(end_at) <= new Date(start_at)) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'end_at debe ser posterior a start_at.');
      const updated = {
        ...current,
        start_at,
        end_at,
        duration_minutes: minutesBetween(start_at, end_at),
        block_type: patch.block_type ?? current.block_type,
        status: patch.status ?? current.status,
        updated_at: nowIso(),
      };
      timeRepository.updateTimeBlock(updated);
      return { block: updated, conflicts: conflictsForBlock(updated) };
    },

    moveTimeBlock(id, { start_at, end_at }) {
      const current = timeRepository.findTimeBlockById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `TimeBlock no encontrado: ${id}`);
      if (current.block_type === 'FIXED') {
        throw new NexusError(ERROR_CODES.CONFLICT, 'Un TimeBlock FIXED no puede moverse sin cambiar explícitamente su tipo o autorización.');
      }
      return this.updateTimeBlock(id, { start_at, end_at, status: 'MOVED' });
    },

    removeTimeBlock(id) {
      return this.updateTimeBlock(id, { status: 'REMOVED' });
    },

    getTimeBlocksByPeriod(fromOrOpts = {}, maybeTo = null) {
      if (fromOrOpts && typeof fromOrOpts === 'object') {
        return timeRepository.listTimeBlocks(fromOrOpts);
      }
      return timeRepository.listTimeBlocks({ from: fromOrOpts ?? null, to: maybeTo });
    },

    detectTimeBlockConflicts(idOrPayload) {
      const id = typeof idOrPayload === 'object' ? idOrPayload?.id : idOrPayload;
      const current = timeRepository.findTimeBlockById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `TimeBlock no encontrado: ${id}`);
      return conflictsForBlock(current);
    },
  };
}
