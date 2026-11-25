import { randomUUID } from 'node:crypto';
import { sanitizePayload } from './event-service.js';
import { ERROR_CODES, NexusError } from '../shared/errors.js';

export function createAuditService({ persistenceService = null, clock = null } = {}) {
  const memoryLog = [];
  let writeSequence = 0;
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function insert(entry) {
    if (persistenceService) {
      try {
        const db = persistenceService.getDatabase();
        db.prepare(`
          INSERT INTO audit_records (
            id, entity_type, entity_id, operation_type, previous_state_json, new_state_json,
            occurred_at, source_id, reason, outcome, correlation_id, is_security_event
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          entry.id,
          entry.entity_type,
          entry.entity_id,
          entry.operation_type,
          entry.previous_state !== null ? JSON.stringify(entry.previous_state) : null,
          entry.new_state !== null ? JSON.stringify(entry.new_state) : null,
          entry.occurred_at,
          entry.source_id,
          entry.reason,
          entry.outcome,
          entry.correlation_id,
          entry.is_security_event ? 1 : 0
        );
        writeSequence += 1;
        return entry;
      } catch (err) {
        if (err instanceof NexusError) throw err;
        throw new NexusError(
          ERROR_CODES.PERSISTENCE_ERROR,
          `No fue posible persistir el registro de auditoría (${err?.message ?? 'SQLite error'}).`,
          { entity: 'AuditRecord', details: { cause: err?.message ?? String(err) } }
        );
      }
    }
    memoryLog.push(entry);
    writeSequence += 1;
    return entry;
  }

  function hydrate(row) {
    return {
      ...row,
      previous_state: row.previous_state_json ? JSON.parse(row.previous_state_json) : null,
      new_state: row.new_state_json ? JSON.parse(row.new_state_json) : null,
      is_security_event: Boolean(row.is_security_event),
    };
  }

  return {
    getWriteSequence() {
      return writeSequence;
    },

    recordChange({ entity_type, entity_id, operation_type, previous_state = null, new_state = null, source_id = 'SYSTEM', reason = null, correlation_id = null, is_security_event = false }) {
      return insert({
        id: randomUUID(),
        entity_type,
        entity_id: String(entity_id),
        operation_type,
        previous_state: sanitizePayload(previous_state),
        new_state: sanitizePayload(new_state),
        occurred_at: nowIso(),
        source_id: String(source_id),
        reason,
        outcome: 'SUCCESS',
        correlation_id,
        is_security_event,
      });
    },

    recordOperation({ entity_type = 'System', entity_id = 'system', operation_type, source_id = 'SYSTEM', outcome = 'SUCCESS', reason = null, correlation_id = null, is_security_event = false }) {
      return insert({
        id: randomUUID(),
        entity_type,
        entity_id: String(entity_id),
        operation_type,
        previous_state: null,
        new_state: null,
        occurred_at: nowIso(),
        source_id: String(source_id),
        reason,
        outcome,
        correlation_id,
        is_security_event,
      });
    },

    getEntityHistory(entityType, entityId, { limit = 100 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
      if (persistenceService) {
        const db = persistenceService.getReadDatabase();
        return db.prepare(`
          SELECT * FROM audit_records WHERE LOWER(entity_type) = LOWER(?) AND entity_id = ?
          ORDER BY occurred_at DESC LIMIT ?
        `).all(String(entityType), String(entityId), safeLimit).map(hydrate);
      }
      const lower = String(entityType).toLowerCase();
      return memoryLog.filter(r => String(r.entity_type).toLowerCase() === lower && r.entity_id === String(entityId)).slice(-safeLimit).reverse();
    },

    getEntityAuditHistory(entityType, entityId, options) {
      return this.getEntityHistory(entityType, entityId, options);
    },

    getOperationHistory({ operation_type = null, limit = 100 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
      if (persistenceService) {
        const db = persistenceService.getReadDatabase();
        return db.prepare(`
          SELECT * FROM audit_records
          WHERE (? IS NULL OR operation_type = ?)
          ORDER BY occurred_at DESC LIMIT ?
        `).all(operation_type, operation_type, safeLimit).map(hydrate);
      }
      const list = operation_type ? memoryLog.filter(r => r.operation_type === operation_type) : memoryLog;
      return list.slice(-safeLimit).reverse();
    },

    getChangesByPeriod(fromIso, toIso, { limit = 200 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
      if (persistenceService) {
        const db = persistenceService.getReadDatabase();
        return db.prepare(`
          SELECT * FROM audit_records
          WHERE (? IS NULL OR occurred_at >= ?) AND (? IS NULL OR occurred_at <= ?)
          ORDER BY occurred_at DESC LIMIT ?
        `).all(fromIso ?? null, fromIso ?? null, toIso ?? null, toIso ?? null, safeLimit).map(hydrate);
      }
      return memoryLog
        .filter(r => (!fromIso || r.occurred_at >= fromIso) && (!toIso || r.occurred_at <= toIso))
        .slice(-safeLimit)
        .reverse();
    },

    getSecurityEvents({ limit = 100 } = {}) {
      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
      if (persistenceService) {
        const db = persistenceService.getReadDatabase();
        return db.prepare('SELECT * FROM audit_records WHERE is_security_event = 1 ORDER BY occurred_at DESC LIMIT ?').all(safeLimit).map(hydrate);
      }
      return memoryLog.filter(r => r.is_security_event).slice(-safeLimit).reverse();
    },

    getMigrationHistory() {
      if (!persistenceService) return [];
      const db = persistenceService.getReadDatabase();
      return db.prepare('SELECT * FROM migration_records ORDER BY started_at DESC').all();
    },
  };
}
