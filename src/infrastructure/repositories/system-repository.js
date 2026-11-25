import { randomUUID } from 'node:crypto';
import { validateDomainRelationInput, ACYCLIC_RELATION_TYPES, wouldCreateCycle } from '../../domain/shared/domain-relation.js';
import { ERROR_CODES, NexusError } from '../../core/errors.js';

export function createSystemRepository(persistenceService) {
  return {
    saveModule(mod) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT OR REPLACE INTO system_modules (
          id, name, description, version, status, dependencies_json, capabilities_json,
          configuration_json, optional, registered_at, activated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mod.id,
        mod.name,
        mod.description ?? '',
        mod.version,
        mod.status,
        JSON.stringify(mod.dependencies ?? []),
        JSON.stringify(mod.capabilities ?? []),
        JSON.stringify(mod.configuration ?? {}),
        mod.optional ? 1 : 0,
        mod.registered_at,
        mod.activated_at ?? null
      );
    },

    findModuleById(id) {
      const db = persistenceService.getReadDatabase();
      const row = db.prepare('SELECT * FROM system_modules WHERE id = ?').get(id);
      return row ? {
        ...row,
        dependencies: JSON.parse(row.dependencies_json),
        capabilities: JSON.parse(row.capabilities_json),
        configuration: JSON.parse(row.configuration_json),
        optional: Boolean(row.optional),
      } : null;
    },

    insertEvent(event) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT INTO system_events (id, event_type, occurred_at, recorded_at, source, entity_type, entity_id, payload_json, correlation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id, event.event_type, event.occurred_at, event.recorded_at,
        event.source, event.entity_type ?? null, event.entity_id ?? null,
        JSON.stringify(event.payload ?? {}), event.correlation_id ?? null
      );
    },

    getEventById(id) {
      const db = persistenceService.getReadDatabase();
      const row = db.prepare('SELECT * FROM system_events WHERE id = ?').get(id);
      return row ? { ...row, payload: JSON.parse(row.payload_json) } : null;
    },

    listEvents({ event_type = null, limit = 100 } = {}) {
      const db = persistenceService.getReadDatabase();
      return db.prepare(`
        SELECT * FROM system_events WHERE (? IS NULL OR event_type = ?)
        ORDER BY recorded_at DESC LIMIT ?
      `).all(event_type, event_type, limit).map(r => ({ ...r, payload: JSON.parse(r.payload_json) }));
    },

    getEventsByEntity(entityType, entityId, limit = 100) {
      const db = persistenceService.getReadDatabase();
      return db.prepare(`
        SELECT * FROM system_events WHERE entity_type = ? AND entity_id = ?
        ORDER BY recorded_at DESC LIMIT ?
      `).all(entityType, entityId, limit).map(r => ({ ...r, payload: JSON.parse(r.payload_json) }));
    },

    getEventsByPeriod(fromIso, toIso, limit = 200) {
      const db = persistenceService.getReadDatabase();
      return db.prepare(`
        SELECT * FROM system_events
        WHERE (? IS NULL OR occurred_at >= ?) AND (? IS NULL OR occurred_at <= ?)
        ORDER BY occurred_at DESC LIMIT ?
      `).all(fromIso ?? null, fromIso ?? null, toIso ?? null, toIso ?? null, limit).map(r => ({ ...r, payload: JSON.parse(r.payload_json) }));
    },

    // Idempotency store
    get(key) {
      const db = persistenceService.getReadDatabase();
      const row = db.prepare('SELECT response_json FROM idempotency_keys WHERE key = ?').get(key);
      return row ? JSON.parse(row.response_json) : null;
    },

    getRecord(key) {
      const db = persistenceService.getReadDatabase();
      const row = db.prepare('SELECT key, operation_type, response_json, created_at FROM idempotency_keys WHERE key = ?').get(key);
      return row ? { key: row.key, operation_type: row.operation_type, response: JSON.parse(row.response_json), created_at: row.created_at } : null;
    },

    save(key, operationType, response) {
      const db = persistenceService.getDatabase();
      db.prepare('INSERT INTO idempotency_keys (key, operation_type, response_json, created_at) VALUES (?, ?, ?, ?)').run(
        key, operationType, JSON.stringify(response), new Date().toISOString()
      );
    },

    // Domain relations (NL-MASTER-02 §14)
    createRelation(input) {
      validateDomainRelationInput(input);
      const db = persistenceService.getDatabase();
      if (ACYCLIC_RELATION_TYPES.has(input.relation_type)) {
        const rows = db.prepare(`
          SELECT source_entity_type, source_entity_id, target_entity_type, target_entity_id
          FROM domain_relations WHERE relation_type = ? AND status = 'ACTIVE'
        `).all(input.relation_type);
        const edges = rows.map(r => [`${r.source_entity_type}:${r.source_entity_id}`, `${r.target_entity_type}:${r.target_entity_id}`]);
        const fromKey = `${input.source_entity_type}:${input.source_entity_id}`;
        const toKey = `${input.target_entity_type}:${input.target_entity_id}`;
        if (wouldCreateCycle(edges, fromKey, toKey)) {
          throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `La relación ${input.relation_type} generaría un ciclo entre ${fromKey} y ${toKey}.`);
        }
      }
      const rel = {
        id: randomUUID(),
        source_entity_type: input.source_entity_type,
        source_entity_id: input.source_entity_id,
        target_entity_type: input.target_entity_type,
        target_entity_id: input.target_entity_id,
        relation_type: input.relation_type,
        created_at: new Date().toISOString(),
        source_id: input.source_id ?? null,
        metadata: input.metadata ?? {},
        status: 'ACTIVE',
      };
      db.prepare(`
        INSERT INTO domain_relations (
          id, source_entity_type, source_entity_id, target_entity_type, target_entity_id,
          relation_type, created_at, source_id, metadata_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      `).run(
        rel.id, rel.source_entity_type, rel.source_entity_id, rel.target_entity_type, rel.target_entity_id,
        rel.relation_type, rel.created_at, rel.source_id, JSON.stringify(rel.metadata)
      );
      return rel;
    },

    retireRelation(id) {
      const db = persistenceService.getDatabase();
      const res = db.prepare("UPDATE domain_relations SET status = 'RETIRED' WHERE id = ? AND status = 'ACTIVE'").run(id);
      if (res.changes === 0) throw new NexusError(ERROR_CODES.NOT_FOUND, `Relación no encontrada: ${id}`);
      return { id, status: 'RETIRED' };
    },

    listRelations({ entity_type = null, entity_id = null, relation_type = null } = {}) {
      const db = persistenceService.getReadDatabase();
      return db.prepare(`
        SELECT * FROM domain_relations
        WHERE status = 'ACTIVE'
          AND (? IS NULL OR relation_type = ?)
          AND (? IS NULL OR (source_entity_type = ? AND source_entity_id = ?) OR (target_entity_type = ? AND target_entity_id = ?))
        ORDER BY created_at DESC
      `).all(relation_type, relation_type, entity_type, entity_type, entity_id, entity_type, entity_id)
        .map(r => ({ ...r, metadata: JSON.parse(r.metadata_json) }));
    },
  };
}
