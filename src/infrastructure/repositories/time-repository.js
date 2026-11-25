export function createTimeRepository(persistenceService) {
  return {
    // Calendar Events
    insertEvent(e) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO calendar_events (
          id, title, description, event_type, start_at, end_at, timezone, location, status,
          source_id, related_entity_type, related_entity_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        e.id, e.title, e.description, e.event_type, e.start_at, e.end_at, e.timezone, e.location,
        e.status, e.source_id, e.related_entity_type, e.related_entity_id, e.created_at, e.updated_at
      );
      return e;
    },
    findEventById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) ?? null;
    },
    listEvents({ from = null, to = null, status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM calendar_events
        WHERE (? IS NULL OR start_at < ?)
          AND (? IS NULL OR end_at > ?)
          AND (? IS NULL OR status = ?)
        ORDER BY start_at ASC
      `).all(to, to, from, from, status, status);
    },
    updateEvent(e) {
      persistenceService.getDatabase().prepare(`
        UPDATE calendar_events SET
          title=?, description=?, event_type=?, start_at=?, end_at=?, timezone=?, location=?, status=?,
          related_entity_type=?, related_entity_id=?, updated_at=?
        WHERE id=?
      `).run(
        e.title, e.description, e.event_type, e.start_at, e.end_at, e.timezone, e.location, e.status,
        e.related_entity_type, e.related_entity_id, e.updated_at, e.id
      );
      return e;
    },

    // Commitments
    insertCommitment(c) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO commitments (
          id, title, description, commitment_type, due_at, status, importance, source_id,
          related_entity_type, related_entity_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        c.id, c.title, c.description, c.commitment_type, c.due_at, c.status, c.importance, c.source_id,
        c.related_entity_type, c.related_entity_id, c.created_at, c.updated_at
      );
      return c;
    },
    findCommitmentById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM commitments WHERE id = ?').get(id) ?? null;
    },
    listCommitments({ status = null, from = null, to = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM commitments
        WHERE (? IS NULL OR status = ?)
          AND (? IS NULL OR due_at >= ?)
          AND (? IS NULL OR due_at <= ?)
        ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC
      `).all(status, status, from, from, to, to);
    },
    updateCommitment(c) {
      persistenceService.getDatabase().prepare(`
        UPDATE commitments SET title=?, description=?, commitment_type=?, due_at=?, status=?, importance=?, updated_at=?
        WHERE id=?
      `).run(c.title, c.description, c.commitment_type, c.due_at, c.status, c.importance, c.updated_at, c.id);
      return c;
    },

    // Availability Windows
    insertAvailabilityWindow(w) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO availability_windows (id, start_at, end_at, availability_type, confidence, source_id, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(w.id, w.start_at, w.end_at, w.availability_type, w.confidence, w.source_id, w.notes, w.created_at, w.updated_at);
      return w;
    },
    findAvailabilityWindowById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM availability_windows WHERE id = ?').get(id) ?? null;
    },
    listAvailabilityWindows({ from = null, to = null, availability_type = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM availability_windows
        WHERE (? IS NULL OR start_at < ?) AND (? IS NULL OR end_at > ?)
          AND (? IS NULL OR availability_type = ?)
        ORDER BY start_at ASC
      `).all(to, to, from, from, availability_type, availability_type);
    },
    updateAvailabilityWindow(w) {
      persistenceService.getDatabase().prepare(`
        UPDATE availability_windows SET start_at=?, end_at=?, availability_type=?, confidence=?, notes=?, updated_at=?
        WHERE id=?
      `).run(w.start_at, w.end_at, w.availability_type, w.confidence, w.notes, w.updated_at, w.id);
      return w;
    },

    // Time Blocks
    insertTimeBlock(b) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO time_blocks (
          id, start_at, end_at, duration_minutes, block_type, status, related_entity_type, related_entity_id,
          plan_version_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        b.id, b.start_at, b.end_at, b.duration_minutes, b.block_type, b.status,
        b.related_entity_type, b.related_entity_id, b.plan_version_id, b.created_at, b.updated_at
      );
      return b;
    },
    findTimeBlockById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM time_blocks WHERE id = ?').get(id) ?? null;
    },
    listTimeBlocks({ from = null, to = null, includeRemoved = false } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM time_blocks
        WHERE (? = 1 OR status != 'REMOVED')
          AND (? IS NULL OR start_at < ?) AND (? IS NULL OR end_at > ?)
        ORDER BY start_at ASC
      `).all(includeRemoved ? 1 : 0, to, to, from, from);
    },
    updateTimeBlock(b) {
      persistenceService.getDatabase().prepare(`
        UPDATE time_blocks SET start_at=?, end_at=?, duration_minutes=?, block_type=?, status=?, updated_at=?
        WHERE id=?
      `).run(b.start_at, b.end_at, b.duration_minutes, b.block_type, b.status, b.updated_at, b.id);
      return b;
    },
  };
}
