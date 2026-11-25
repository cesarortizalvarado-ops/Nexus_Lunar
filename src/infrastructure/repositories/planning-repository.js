export function createPlanningRepository(persistenceService) {
  const hydrateProposal = r => (r ? {
    ...r,
    reliable: Boolean(r.reliable),
    generation_context: JSON.parse(r.generation_context_json),
    proposed_items: JSON.parse(r.proposed_items_json),
    explanation: JSON.parse(r.explanation_json),
    conflict_summary: JSON.parse(r.conflict_summary_json),
    missing_information: JSON.parse(r.missing_information_json),
  } : null);

  const hydrateConflict = r => (r ? { ...r, related_entities: JSON.parse(r.related_entities_json) } : null);

  const hydrateReview = r => (r ? {
    ...r,
    planned_summary: JSON.parse(r.planned_summary_json),
    executed_summary: JSON.parse(r.executed_summary_json),
    missing_results: JSON.parse(r.missing_results_json),
    corrections: JSON.parse(r.corrections_json),
    obstacles: JSON.parse(r.obstacles_json),
    context_changes: JSON.parse(r.context_changes_json),
  } : null);

  return {
    insertPlan(p) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO plans (id, name, period_start, period_end, plan_type, status, current_version_id, approved_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, p.name, p.period_start, p.period_end, p.plan_type, p.status, p.current_version_id, p.approved_at, p.created_at, p.updated_at);
      return p;
    },
    findPlanById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM plans WHERE id = ?').get(id) ?? null;
    },
    listPlans({ plan_type = null, status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM plans WHERE (? IS NULL OR plan_type = ?) AND (? IS NULL OR status = ?) ORDER BY created_at DESC
      `).all(plan_type, plan_type, status, status);
    },
    updatePlan(p) {
      persistenceService.getDatabase().prepare(`
        UPDATE plans SET name=?, status=?, current_version_id=?, approved_at=?, updated_at=? WHERE id=?
      `).run(p.name, p.status, p.current_version_id, p.approved_at, p.updated_at, p.id);
      return p;
    },

    insertPlanVersion(v) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO plan_versions (id, plan_id, version_number, parent_version_id, proposal_id, created_at, approved_at, approval_status, change_summary, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(v.id, v.plan_id, v.version_number, v.parent_version_id, v.proposal_id, v.created_at, v.approved_at, v.approval_status, v.change_summary, v.source);
      return v;
    },
    findPlanVersionById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM plan_versions WHERE id = ?').get(id) ?? null;
    },
    listPlanVersions(planId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM plan_versions WHERE plan_id = ? ORDER BY version_number DESC').all(planId);
    },
    updatePlanVersion(v) {
      persistenceService.getDatabase().prepare(`
        UPDATE plan_versions SET approved_at=?, approval_status=?, change_summary=? WHERE id=?
      `).run(v.approved_at, v.approval_status, v.change_summary, v.id);
      return v;
    },

    insertPlanItem(it) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO plan_items (id, plan_version_id, related_entity_type, related_entity_id, title, planned_start, planned_end, duration_minutes, priority_tier, flexibility, status, explanation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(it.id, it.plan_version_id, it.related_entity_type, it.related_entity_id, it.title, it.planned_start, it.planned_end, it.duration_minutes, it.priority_tier, it.flexibility, it.status, it.explanation);
      return it;
    },
    listPlanItems(planVersionId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM plan_items WHERE plan_version_id = ? ORDER BY CASE WHEN planned_start IS NULL THEN 1 ELSE 0 END, planned_start ASC').all(planVersionId);
    },
    findPlanItemById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM plan_items WHERE id = ?').get(id) ?? null;
    },
    updatePlanItem(it) {
      persistenceService.getDatabase().prepare(`
        UPDATE plan_items SET planned_start=?, planned_end=?, duration_minutes=?, priority_tier=?, flexibility=?, status=?, explanation=? WHERE id=?
      `).run(it.planned_start, it.planned_end, it.duration_minutes, it.priority_tier, it.flexibility, it.status, it.explanation, it.id);
      return it;
    },

    insertProposal(pr) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO planning_proposals (
          id, plan_id, generated_at, proposal_status, reliable, generation_context_json,
          proposed_items_json, explanation_json, conflict_summary_json, missing_information_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pr.id, pr.plan_id, pr.generated_at, pr.proposal_status, pr.reliable ? 1 : 0,
        JSON.stringify(pr.generation_context), JSON.stringify(pr.proposed_items),
        JSON.stringify(pr.explanation), JSON.stringify(pr.conflict_summary), JSON.stringify(pr.missing_information)
      );
      return pr;
    },
    findProposalById(id) {
      return hydrateProposal(persistenceService.getReadDatabase().prepare('SELECT * FROM planning_proposals WHERE id = ?').get(id));
    },
    listProposalsByPlan(planId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM planning_proposals WHERE plan_id = ? ORDER BY generated_at DESC').all(planId).map(hydrateProposal);
    },
    updateProposal(pr) {
      persistenceService.getDatabase().prepare(`
        UPDATE planning_proposals SET proposal_status=?, proposed_items_json=?, explanation_json=?, conflict_summary_json=? WHERE id=?
      `).run(pr.proposal_status, JSON.stringify(pr.proposed_items), JSON.stringify(pr.explanation), JSON.stringify(pr.conflict_summary), pr.id);
      return pr;
    },

    insertConflict(c) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO planning_conflicts (id, proposal_id, conflict_type, related_entities_json, severity, description, suggested_resolution, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(c.id, c.proposal_id, c.conflict_type, JSON.stringify(c.related_entities), c.severity, c.description, c.suggested_resolution, c.status);
      return c;
    },
    listConflictsByProposal(proposalId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM planning_conflicts WHERE proposal_id = ?').all(proposalId).map(hydrateConflict);
    },

    upsertDailyReview(r) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO daily_reviews (
          id, review_date, planned_summary_json, executed_summary_json, missing_results_json,
          corrections_json, obstacles_json, context_changes_json, summary_text, status, created_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(review_date) DO UPDATE SET
          planned_summary_json = excluded.planned_summary_json,
          executed_summary_json = excluded.executed_summary_json,
          missing_results_json = excluded.missing_results_json,
          corrections_json = excluded.corrections_json,
          obstacles_json = excluded.obstacles_json,
          context_changes_json = excluded.context_changes_json,
          summary_text = excluded.summary_text,
          status = excluded.status,
          closed_at = excluded.closed_at
      `).run(
        r.id, r.review_date, JSON.stringify(r.planned_summary), JSON.stringify(r.executed_summary),
        JSON.stringify(r.missing_results), JSON.stringify(r.corrections), JSON.stringify(r.obstacles),
        JSON.stringify(r.context_changes), r.summary_text, r.status, r.created_at, r.closed_at
      );
      return this.findDailyReviewByDate(r.review_date);
    },
    findDailyReviewByDate(dateStr) {
      return hydrateReview(persistenceService.getReadDatabase().prepare('SELECT * FROM daily_reviews WHERE review_date = ?').get(dateStr));
    },
  };
}
