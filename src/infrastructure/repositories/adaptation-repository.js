export function createAdaptationRepository(persistenceService) {
  const hydrateObs = r => (r ? { ...r, evidence_references: JSON.parse(r.evidence_references_json) } : null);
  const hydrateSug = r => (r ? { ...r, proposed_change: JSON.parse(r.proposed_change_json), explanation: JSON.parse(r.explanation_json) } : null);
  const hydrateInt = r => (r ? { ...r, evidence: JSON.parse(r.evidence_json) } : null);

  return {
    insertObservation(o) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO adaptation_observations (id, observation_type, related_entity_type, related_entity_id, description, evidence_references_json, confidence, observed_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(o.id, o.observation_type, o.related_entity_type, o.related_entity_id, o.description, JSON.stringify(o.evidence_references), o.confidence, o.observed_at, o.status);
      return o;
    },
    findObservationById(id) {
      return hydrateObs(persistenceService.getReadDatabase().prepare('SELECT * FROM adaptation_observations WHERE id = ?').get(id));
    },
    findOpenObservation(observationType, relatedEntityType, relatedEntityId) {
      return hydrateObs(persistenceService.getReadDatabase().prepare(`
        SELECT * FROM adaptation_observations
        WHERE observation_type = ?
          AND COALESCE(related_entity_type, '') = COALESCE(?, '')
          AND COALESCE(related_entity_id, '') = COALESCE(?, '')
          AND status IN ('CANDIDATE', 'CONFIRMED')
        ORDER BY observed_at DESC LIMIT 1
      `).get(observationType, relatedEntityType ?? null, relatedEntityId ?? null));
    },
    updateObservation(o) {
      persistenceService.getDatabase().prepare(`
        UPDATE adaptation_observations
        SET description = ?, evidence_references_json = ?, confidence = ?, observed_at = ?, status = ?
        WHERE id = ?
      `).run(o.description, JSON.stringify(o.evidence_references), o.confidence, o.observed_at, o.status, o.id);
      return o;
    },
    listObservations({ status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM adaptation_observations WHERE (? IS NULL OR status = ?) ORDER BY observed_at DESC
      `).all(status, status).map(hydrateObs);
    },
    updateObservationStatus(id, status) {
      persistenceService.getDatabase().prepare('UPDATE adaptation_observations SET status = ? WHERE id = ?').run(status, id);
    },

    insertSuggestion(s) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO adaptation_suggestions (id, observation_id, suggestion_type, proposed_change_json, explanation_json, created_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(s.id, s.observation_id, s.suggestion_type, JSON.stringify(s.proposed_change), JSON.stringify(s.explanation), s.created_at, s.status);
      return s;
    },
    findSuggestionById(id) {
      return hydrateSug(persistenceService.getReadDatabase().prepare('SELECT * FROM adaptation_suggestions WHERE id = ?').get(id));
    },
    findActiveSuggestionForObservation(observationId) {
      return hydrateSug(persistenceService.getReadDatabase().prepare(`
        SELECT * FROM adaptation_suggestions
        WHERE observation_id = ? AND status IN ('PROPOSED', 'ACCEPTED')
        ORDER BY created_at DESC LIMIT 1
      `).get(observationId));
    },
    listSuggestions({ status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM adaptation_suggestions WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC
      `).all(status, status).map(hydrateSug);
    },
    updateSuggestionStatus(id, status) {
      persistenceService.getDatabase().prepare('UPDATE adaptation_suggestions SET status = ? WHERE id = ?').run(status, id);
    },

    findActiveInterventionByDedupKey(dedupKey) {
      return hydrateInt(persistenceService.getReadDatabase().prepare("SELECT * FROM proactive_interventions WHERE dedup_key = ? AND status IN ('PENDING','DELIVERED')").get(dedupKey));
    },
    insertIntervention(inv) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO proactive_interventions (id, dedup_key, classification, title, message, suggested_action, evidence_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(inv.id, inv.dedup_key, inv.classification, inv.title, inv.message, inv.suggested_action, JSON.stringify(inv.evidence), inv.status, inv.created_at, inv.updated_at);
      return inv;
    },
    listInterventions({ status = null, datePrefix = null } = {}) {
      const likeDate = datePrefix ? `${datePrefix}%` : null;
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM proactive_interventions
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR created_at LIKE ?)
        ORDER BY created_at DESC
      `).all(status, status, likeDate, likeDate).map(hydrateInt);
    },
    updateInterventionStatus(id, status, updatedAt) {
      persistenceService.getDatabase().prepare('UPDATE proactive_interventions SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id);
    },

    getProactivityConfig() {
      const r = persistenceService.getReadDatabase().prepare("SELECT * FROM proactivity_config WHERE id = 'default'").get();
      return r ? { ...r, enabled: Boolean(r.enabled) } : { id: 'default', enabled: true, max_daily_interactions: 3, minimum_classification: 'RECOMMENDATION' };
    },
    saveProactivityConfig(cfg) {
      persistenceService.getDatabase().prepare(`
        INSERT OR REPLACE INTO proactivity_config (id, enabled, max_daily_interactions, minimum_classification, updated_at)
        VALUES ('default', ?, ?, ?, ?)
      `).run(cfg.enabled ? 1 : 0, cfg.max_daily_interactions, cfg.minimum_classification, cfg.updated_at);
      return this.getProactivityConfig();
    },
  };
}
