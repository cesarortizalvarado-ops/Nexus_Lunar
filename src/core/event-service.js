import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from './errors.js';

const SENSITIVE_KEY_RE = /(password|secret|token|api_?key|credential|private_?key|passphrase)/i;

export function sanitizePayload(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : sanitizePayload(v);
    }
    return out;
  }
  return value;
}

export function createEventService({ repository = null, clock = null } = {}) {
  const memoryEvents = [];
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    publishEvent({ event_type, occurred_at = null, source = 'SYSTEM', payload = {}, correlation_id = null, entity_type = null, entity_id = null } = {}) {
      if (!event_type || typeof event_type !== 'string') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'event_type es obligatorio.', { field: 'event_type' });
      }
      const recorded_at = nowIso();
      const event = {
        id: randomUUID(),
        event_type,
        occurred_at: occurred_at ?? recorded_at,
        recorded_at,
        source,
        entity_type,
        entity_id,
        payload: sanitizePayload(payload),
        correlation_id: correlation_id ?? randomUUID(),
      };
      if (repository) {
        repository.insertEvent(event);
      } else {
        memoryEvents.push(event);
      }
      return event;
    },

    getEvent(id) {
      const found = repository ? repository.getEventById(id) : memoryEvents.find(e => e.id === id);
      if (!found) throw new NexusError(ERROR_CODES.NOT_FOUND, `Evento de sistema no encontrado: ${id}`, { entity: 'SystemEvent' });
      return found;
    },

    listEvents({ event_type = null, limit = 100 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
      if (repository) return repository.listEvents({ event_type, limit: safeLimit });
      const filtered = event_type ? memoryEvents.filter(e => e.event_type === event_type) : memoryEvents;
      return filtered.slice(-safeLimit).reverse();
    },

    getEventsByEntity(entityType, entityId, { limit = 100 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
      if (repository) return repository.getEventsByEntity(entityType, entityId, safeLimit);
      return memoryEvents
        .filter(e => e.entity_type === entityType && e.entity_id === entityId)
        .slice(-safeLimit)
        .reverse();
    },

    getEventsByPeriod(fromIso, toIso, { limit = 200 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
      if (repository) return repository.getEventsByPeriod(fromIso, toIso, safeLimit);
      return memoryEvents
        .filter(e => (!fromIso || e.occurred_at >= fromIso) && (!toIso || e.occurred_at <= toIso))
        .slice(-safeLimit)
        .reverse();
    },
  };
}
