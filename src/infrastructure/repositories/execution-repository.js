export function createExecutionRepository(persistenceService) {
  return {
    insertExecution(e) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO executions (id, related_entity_type, related_entity_id, started_at, completed_at, execution_status, source_id, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(e.id, e.related_entity_type, e.related_entity_id, e.started_at, e.completed_at, e.execution_status, e.source_id, e.notes, e.created_at, e.updated_at);
      return e;
    },
    findExecutionById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM executions WHERE id = ?').get(id) ?? null;
    },
    listExecutions({ related_entity_type = null, related_entity_id = null, status = null, from = null, to = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM executions
        WHERE (? IS NULL OR related_entity_type = ?)
          AND (? IS NULL OR related_entity_id = ?)
          AND (? IS NULL OR execution_status = ?)
          AND (? IS NULL OR started_at >= ?)
          AND (? IS NULL OR started_at <= ?)
        ORDER BY started_at DESC
      `).all(related_entity_type, related_entity_type, related_entity_id, related_entity_id, status, status, from, from, to, to);
    },
    updateExecution(e) {
      persistenceService.getDatabase().prepare(`
        UPDATE executions SET completed_at=?, execution_status=?, notes=?, updated_at=? WHERE id=?
      `).run(e.completed_at, e.execution_status, e.notes, e.updated_at, e.id);
      return e;
    },

    insertSession(s) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO work_sessions (id, execution_id, started_at, ended_at, paused_at, duration_minutes, pause_duration_minutes, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(s.id, s.execution_id, s.started_at, s.ended_at, s.paused_at, s.duration_minutes, s.pause_duration_minutes, s.status, s.notes);
      return s;
    },
    findSessionById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM work_sessions WHERE id = ?').get(id) ?? null;
    },
    listSessionsByExecution(executionId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM work_sessions WHERE execution_id = ? ORDER BY started_at ASC').all(executionId);
    },
    updateSession(s) {
      persistenceService.getDatabase().prepare(`
        UPDATE work_sessions SET ended_at=?, paused_at=?, duration_minutes=?, pause_duration_minutes=?, status=?, notes=? WHERE id=?
      `).run(s.ended_at, s.paused_at, s.duration_minutes, s.pause_duration_minutes, s.status, s.notes, s.id);
      return s;
    },

    insertOutcome(o) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO outcomes (id, execution_id, outcome_type, description, achieved_at, evidence_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(o.id, o.execution_id, o.outcome_type, o.description, o.achieved_at, o.evidence_id, o.updated_at);
      return o;
    },
    findOutcomeById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM outcomes WHERE id = ?').get(id) ?? null;
    },
    listOutcomesByExecution(executionId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM outcomes WHERE execution_id = ? ORDER BY achieved_at DESC').all(executionId);
    },
    updateOutcome(o) {
      persistenceService.getDatabase().prepare(`
        UPDATE outcomes SET outcome_type=?, description=?, evidence_id=?, updated_at=? WHERE id=?
      `).run(o.outcome_type, o.description, o.evidence_id, o.updated_at, o.id);
      return o;
    },

    insertObservation(obs) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO observations (id, related_entity_type, related_entity_id, content, observed_at, source_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(obs.id, obs.related_entity_type, obs.related_entity_id, obs.content, obs.observed_at, obs.source_id);
      return obs;
    },
    findObservationById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM observations WHERE id = ?').get(id) ?? null;
    },
    listObservations({ related_entity_type = null, related_entity_id = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM observations
        WHERE (? IS NULL OR related_entity_type = ?) AND (? IS NULL OR related_entity_id = ?)
        ORDER BY observed_at DESC
      `).all(related_entity_type, related_entity_type, related_entity_id, related_entity_id);
    },
  };
}
