export function createMemoryRepository(persistenceService) {
  function hydrateSource(row) {
    return row ? { ...row, metadata: JSON.parse(row.metadata_json) } : null;
  }

  function hydrateMemory(row) {
    return row ? { ...row, context: JSON.parse(row.context_json) } : null;
  }

  function hydrateRevision(row) {
    return row ? {
      ...row,
      previous_snapshot: JSON.parse(row.previous_snapshot_json),
      new_snapshot: JSON.parse(row.new_snapshot_json),
    } : null;
  }

  return {
    insertSource(source) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT INTO information_sources (id, source_type, source_reference, description, recorded_at, reliability, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        source.id, source.source_type, source.source_reference ?? null, source.description ?? '',
        source.recorded_at, source.reliability ?? null, JSON.stringify(source.metadata ?? {})
      );
      return source;
    },

    findSourceById(id) {
      const db = persistenceService.getReadDatabase();
      return hydrateSource(db.prepare('SELECT * FROM information_sources WHERE id = ?').get(id));
    },

    listSources({ source_type = null, limit = 100 } = {}) {
      const db = persistenceService.getReadDatabase();
      return db.prepare(`
        SELECT * FROM information_sources WHERE (? IS NULL OR source_type = ?)
        ORDER BY recorded_at DESC LIMIT ?
      `).all(source_type, source_type, limit).map(hydrateSource);
    },

    insertEvidence(ev) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT INTO evidences (id, source_id, evidence_type, reference, description, captured_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(ev.id, ev.source_id, ev.evidence_type, ev.reference ?? null, ev.description, ev.captured_at);
      return ev;
    },

    attachEvidenceToMemory(memoryId, evidenceId, attachedAt) {
      const db = persistenceService.getDatabase();
      db.prepare('INSERT OR IGNORE INTO memory_evidences (memory_record_id, evidence_id, attached_at) VALUES (?, ?, ?)').run(
        memoryId, evidenceId, attachedAt
      );
    },

    findEvidenceById(id) {
      const db = persistenceService.getReadDatabase();
      return db.prepare('SELECT * FROM evidences WHERE id = ?').get(id) ?? null;
    },

    listEvidencesForMemory(memoryId) {
      const db = persistenceService.getReadDatabase();
      return db.prepare(`
        SELECT e.* FROM evidences e
        INNER JOIN memory_evidences me ON me.evidence_id = e.id
        WHERE me.memory_record_id = ?
        ORDER BY e.captured_at DESC
      `).all(memoryId);
    },

    insertMemory(record) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT INTO memory_records (
          id, information_type, content, summary, confidence, source_id, valid_from, valid_until,
          recorded_at, updated_at, status, sensitivity, context_json, version, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.information_type, record.content, record.summary ?? '',
        record.confidence ?? null, record.source_id, record.valid_from ?? null, record.valid_until ?? null,
        record.recorded_at, record.updated_at, record.status, record.sensitivity,
        JSON.stringify(record.context ?? {}), record.version, record.archived_at ?? null
      );
      return record;
    },

    findMemoryById(id) {
      const db = persistenceService.getReadDatabase();
      return hydrateMemory(db.prepare('SELECT * FROM memory_records WHERE id = ?').get(id));
    },

    updateMemory(record) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        UPDATE memory_records
        SET information_type = ?, content = ?, summary = ?, confidence = ?, valid_from = ?, valid_until = ?,
            updated_at = ?, status = ?, sensitivity = ?, context_json = ?, version = ?, archived_at = ?
        WHERE id = ?
      `).run(
        record.information_type, record.content, record.summary ?? '', record.confidence ?? null,
        record.valid_from ?? null, record.valid_until ?? null, record.updated_at, record.status,
        record.sensitivity, JSON.stringify(record.context ?? {}), record.version, record.archived_at ?? null,
        record.id
      );
      return record;
    },

    searchMemory({ information_type = null, status = null, q = null, sensitivity = null, limit = 100 } = {}) {
      const db = persistenceService.getReadDatabase();
      const search = q?.trim() ? `%${q.trim()}%` : null;
      return db.prepare(`
        SELECT * FROM memory_records
        WHERE (? IS NULL OR information_type = ?)
          AND (? IS NULL OR status = ?)
          AND (? IS NULL OR sensitivity = ?)
          AND (? IS NULL OR content LIKE ? OR summary LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(
        information_type, information_type,
        status, status,
        sensitivity, sensitivity,
        search, search, search,
        limit
      ).map(hydrateMemory);
    },

    insertRevision(rev) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT INTO memory_revisions (
          id, memory_record_id, previous_version, new_version, previous_snapshot_json,
          new_snapshot_json, change_type, reason, changed_at, source_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rev.id, rev.memory_record_id, rev.previous_version, rev.new_version,
        JSON.stringify(rev.previous_snapshot), JSON.stringify(rev.new_snapshot),
        rev.change_type, rev.reason, rev.changed_at, rev.source_id
      );
      return rev;
    },

    listRevisions(memoryId) {
      const db = persistenceService.getReadDatabase();
      return db.prepare('SELECT * FROM memory_revisions WHERE memory_record_id = ? ORDER BY new_version DESC').all(memoryId).map(hydrateRevision);
    },

    insertRelation(rel) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT INTO memory_relations (id, origin_record_id, target_record_id, relation_type, created_at, source_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(rel.id, rel.origin_record_id, rel.target_record_id, rel.relation_type, rel.created_at, rel.source_id ?? null);
      return rel;
    },

    listRelations(memoryId) {
      const db = persistenceService.getReadDatabase();
      return db.prepare('SELECT * FROM memory_relations WHERE origin_record_id = ? OR target_record_id = ? ORDER BY created_at DESC').all(memoryId, memoryId);
    },
  };
}
