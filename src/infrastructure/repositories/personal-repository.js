export function createPersonalRepository(persistenceService) {
  return {
    listPriorities() {
      const db = persistenceService.getReadDatabase();
      return db.prepare('SELECT * FROM priorities ORDER BY rank ASC').all().map(r => ({ ...r, configuration: JSON.parse(r.configuration_json) }));
    },

    findPriorityById(id) {
      const db = persistenceService.getReadDatabase();
      const row = db.prepare('SELECT * FROM priorities WHERE id = ?').get(id);
      return row ? { ...row, configuration: JSON.parse(row.configuration_json) } : null;
    },

    upsertPriority(prio) {
      const db = persistenceService.getDatabase();
      db.prepare('INSERT OR REPLACE INTO priorities (id, name, rank, description, configuration_json) VALUES (?, ?, ?, ?, ?)').run(
        prio.id, prio.name, prio.rank, prio.description ?? '', JSON.stringify(prio.configuration ?? {})
      );
      return prio;
    },

    // Goals
    insertGoal(g) {
      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT INTO goals (id, name, description, desired_outcome, priority_id, horizon, target_date, status, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(g.id, g.name, g.description, g.desired_outcome, g.priority_id, g.horizon, g.target_date, g.status, g.created_at, g.updated_at, g.archived_at);
      return g;
    },

    findGoalById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM goals WHERE id = ?').get(id) ?? null;
    },

    listGoals({ status = null, q = null } = {}) {
      const s = q?.trim() ? `%${q.trim()}%` : null;
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM goals
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR name LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC
      `).all(status, status, s, s, s);
    },

    updateGoal(g) {
      persistenceService.getDatabase().prepare(`
        UPDATE goals SET name=?, description=?, desired_outcome=?, priority_id=?, horizon=?, target_date=?, status=?, updated_at=?, archived_at=?
        WHERE id=?
      `).run(g.name, g.description, g.desired_outcome, g.priority_id, g.horizon, g.target_date, g.status, g.updated_at, g.archived_at, g.id);
      return g;
    },

    insertGoalOutcome(o) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO goal_outcomes (id, goal_id, outcome_summary, evidence_id, source_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?)
      `).run(o.id, o.goal_id, o.outcome_summary, o.evidence_id ?? null, o.source_id ?? null, o.recorded_at);
      return o;
    },

    listGoalOutcomes(goalId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM goal_outcomes WHERE goal_id = ? ORDER BY recorded_at DESC').all(goalId);
    },

    // Projects
    insertProject(p) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO personal_projects (id, name, description, purpose, priority_id, status, start_date, target_date, completed_at, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, p.name, p.description, p.purpose, p.priority_id, p.status, p.start_date, p.target_date, p.completed_at, p.created_at, p.updated_at, p.archived_at);
      return p;
    },

    findProjectById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM personal_projects WHERE id = ?').get(id) ?? null;
    },

    listProjects({ status = null, q = null } = {}) {
      const s = q?.trim() ? `%${q.trim()}%` : null;
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM personal_projects
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR name LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC
      `).all(status, status, s, s, s);
    },

    updateProject(p) {
      persistenceService.getDatabase().prepare(`
        UPDATE personal_projects SET name=?, description=?, purpose=?, priority_id=?, status=?, start_date=?, target_date=?, completed_at=?, updated_at=?, archived_at=?
        WHERE id=?
      `).run(p.name, p.description, p.purpose, p.priority_id, p.status, p.start_date, p.target_date, p.completed_at, p.updated_at, p.archived_at, p.id);
      return p;
    },

    // Tasks
    insertTask(t) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO personal_tasks (
          id, project_id, title, description, priority_id, urgency, status,
          estimated_duration_minutes, actual_duration_minutes, due_date, planned_start, planned_end,
          completed_at, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t.id, t.project_id, t.title, t.description, t.priority_id, t.urgency, t.status,
        t.estimated_duration_minutes, t.actual_duration_minutes, t.due_date, t.planned_start, t.planned_end,
        t.completed_at, t.created_at, t.updated_at, t.archived_at
      );
      return t;
    },

    findTaskById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM personal_tasks WHERE id = ?').get(id) ?? null;
    },

    listTasks({ project_id = null, status = null, priority_id = null, q = null } = {}) {
      const s = q?.trim() ? `%${q.trim()}%` : null;
      return persistenceService.getReadDatabase().prepare(`
        SELECT t.* FROM personal_tasks t
        LEFT JOIN priorities p ON p.id = t.priority_id
        WHERE (? IS NULL OR t.project_id = ?)
          AND (? IS NULL OR t.status = ?)
          AND (? IS NULL OR t.priority_id = ?)
          AND (? IS NULL OR t.title LIKE ? OR t.description LIKE ?)
        ORDER BY COALESCE(p.rank, 99) ASC, t.urgency DESC, CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.created_at DESC
      `).all(project_id, project_id, status, status, priority_id, priority_id, s, s, s);
    },

    updateTask(t) {
      persistenceService.getDatabase().prepare(`
        UPDATE personal_tasks SET
          project_id=?, title=?, description=?, priority_id=?, urgency=?, status=?,
          estimated_duration_minutes=?, actual_duration_minutes=?, due_date=?, planned_start=?, planned_end=?,
          completed_at=?, updated_at=?, archived_at=?
        WHERE id=?
      `).run(
        t.project_id, t.title, t.description, t.priority_id, t.urgency, t.status,
        t.estimated_duration_minutes, t.actual_duration_minutes, t.due_date, t.planned_start, t.planned_end,
        t.completed_at, t.updated_at, t.archived_at, t.id
      );
      return t;
    },

    // Activities
    insertActivity(a) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO activities (id, name, description, category, expected_duration_minutes, status, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(a.id, a.name, a.description, a.category, a.expected_duration_minutes, a.status, a.created_at, a.updated_at, a.archived_at);
      return a;
    },

    findActivityById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM activities WHERE id = ?').get(id) ?? null;
    },

    listActivities({ status = null, category = null, q = null } = {}) {
      const s = q?.trim() ? `%${q.trim()}%` : null;
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM activities
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR category = ?) AND (? IS NULL OR name LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC
      `).all(status, status, category, category, s, s, s);
    },

    updateActivity(a) {
      persistenceService.getDatabase().prepare(`
        UPDATE activities SET name=?, description=?, category=?, expected_duration_minutes=?, status=?, updated_at=?, archived_at=?
        WHERE id=?
      `).run(a.name, a.description, a.category, a.expected_duration_minutes, a.status, a.updated_at, a.archived_at, a.id);
      return a;
    },

    // Relations N:M
    linkGoalProject(goalId, projectId, now) {
      persistenceService.getDatabase().prepare('INSERT OR IGNORE INTO goal_projects (goal_id, project_id, created_at) VALUES (?, ?, ?)').run(goalId, projectId, now);
    },
    linkGoalTask(goalId, taskId, now) {
      persistenceService.getDatabase().prepare('INSERT OR IGNORE INTO goal_tasks (goal_id, task_id, created_at) VALUES (?, ?, ?)').run(goalId, taskId, now);
    },
    linkGoalActivity(goalId, activityId, now) {
      persistenceService.getDatabase().prepare('INSERT OR IGNORE INTO goal_activities (goal_id, activity_id, created_at) VALUES (?, ?, ?)').run(goalId, activityId, now);
    },
    listProjectsForGoal(goalId) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT p.* FROM personal_projects p INNER JOIN goal_projects gp ON gp.project_id = p.id WHERE gp.goal_id = ?
      `).all(goalId);
    },
    listGoalsForProject(projectId) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT g.* FROM goals g INNER JOIN goal_projects gp ON gp.goal_id = g.id WHERE gp.project_id = ?
      `).all(projectId);
    },
    listTasksForGoal(goalId) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT t.* FROM personal_tasks t INNER JOIN goal_tasks gt ON gt.task_id = t.id WHERE gt.goal_id = ?
      `).all(goalId);
    },

    // Dependencies
    listAllDependencies(entityType = null) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM entity_dependencies WHERE (? IS NULL OR origin_entity_type = ?)
      `).all(entityType, entityType);
    },
    insertDependency(dep) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO entity_dependencies (id, origin_entity_type, origin_entity_id, target_entity_type, target_entity_id, dependency_type, condition, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(dep.id, dep.origin_entity_type, dep.origin_entity_id, dep.target_entity_type, dep.target_entity_id, dep.dependency_type, dep.condition ?? null, dep.created_at);
      return dep;
    },
    deleteDependency(originType, originId, targetType, targetId) {
      return persistenceService.getDatabase().prepare(`
        DELETE FROM entity_dependencies WHERE origin_entity_type=? AND origin_entity_id=? AND target_entity_type=? AND target_entity_id=?
      `).run(originType, originId, targetType, targetId).changes;
    },
    listDependenciesOf(entityType, entityId) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM entity_dependencies WHERE origin_entity_type=? AND origin_entity_id=?
      `).all(entityType, entityId);
    },
  };
}
