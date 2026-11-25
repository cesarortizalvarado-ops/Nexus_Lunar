export function createHabitRoutineRepository(persistenceService) {
  const hydrateHabit = r => (r ? {
    ...r,
    frequency: JSON.parse(r.frequency_json),
    preferred_time_window: r.preferred_time_window_json ? JSON.parse(r.preferred_time_window_json) : null,
  } : null);

  const hydrateOcc = r => (r ? {
    ...r,
    expected_time_window: r.expected_time_window_json ? JSON.parse(r.expected_time_window_json) : null,
  } : null);

  const hydrateRoutine = r => (r ? {
    ...r,
    frequency: JSON.parse(r.frequency_json),
    preferred_time_window: r.preferred_time_window_json ? JSON.parse(r.preferred_time_window_json) : null,
  } : null);

  const hydrateStep = r => (r ? { ...r, required: Boolean(r.required) } : null);
  const hydrateExec = r => (r ? { ...r, steps_snapshot: JSON.parse(r.steps_snapshot_json) } : null);
  const hydrateStepExec = r => (r ? { ...r, required: Boolean(r.required) } : null);

  return {
    // Habits
    insertHabit(h) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO nl_habits (
          id, name, description, category, purpose, frequency_json, target, minimum_requirement,
          preferred_time_window_json, start_date, end_date, status, version, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        h.id, h.name, h.description, h.category, h.purpose, JSON.stringify(h.frequency),
        h.target, h.minimum_requirement, h.preferred_time_window ? JSON.stringify(h.preferred_time_window) : null,
        h.start_date, h.end_date, h.status, h.version, h.created_at, h.updated_at, h.archived_at
      );
      return h;
    },
    findHabitById(id) {
      return hydrateHabit(persistenceService.getReadDatabase().prepare('SELECT * FROM nl_habits WHERE id = ?').get(id));
    },
    listHabits({ status = null, category = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM nl_habits WHERE (? IS NULL OR status = ?) AND (? IS NULL OR category = ?) ORDER BY created_at DESC
      `).all(status, status, category, category).map(hydrateHabit);
    },
    updateHabit(h) {
      persistenceService.getDatabase().prepare(`
        UPDATE nl_habits SET
          name=?, description=?, category=?, purpose=?, frequency_json=?, target=?, minimum_requirement=?,
          preferred_time_window_json=?, start_date=?, end_date=?, status=?, version=?, updated_at=?, archived_at=?
        WHERE id=?
      `).run(
        h.name, h.description, h.category, h.purpose, JSON.stringify(h.frequency),
        h.target, h.minimum_requirement, h.preferred_time_window ? JSON.stringify(h.preferred_time_window) : null,
        h.start_date, h.end_date, h.status, h.version, h.updated_at, h.archived_at, h.id
      );
      return h;
    },

    upsertHabitOccurrence(o) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO nl_habit_occurrences (
          id, habit_id, scheduled_date, expected_time_window_json, completed_at, status, notes, source_id, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(habit_id, scheduled_date) DO UPDATE SET
          completed_at = excluded.completed_at,
          status = excluded.status,
          notes = excluded.notes,
          source_id = excluded.source_id,
          version = nl_habit_occurrences.version + 1,
          updated_at = excluded.updated_at
      `).run(
        o.id, o.habit_id, o.scheduled_date, o.expected_time_window ? JSON.stringify(o.expected_time_window) : null,
        o.completed_at, o.status, o.notes, o.source_id, o.version, o.created_at, o.updated_at
      );
      return this.findHabitOccurrence(o.habit_id, o.scheduled_date);
    },
    findHabitOccurrence(habitId, scheduledDate) {
      return hydrateOcc(persistenceService.getReadDatabase().prepare('SELECT * FROM nl_habit_occurrences WHERE habit_id = ? AND scheduled_date = ?').get(habitId, scheduledDate));
    },
    listHabitOccurrences(habitId, { from = null, to = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM nl_habit_occurrences
        WHERE habit_id = ?
          AND (? IS NULL OR scheduled_date >= ?)
          AND (? IS NULL OR scheduled_date <= ?)
        ORDER BY scheduled_date DESC
      `).all(habitId, from, from, to, to).map(hydrateOcc);
    },

    insertHabitRevision(rev) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO nl_habit_revisions (
          id, habit_id, effective_from, effective_until, previous_configuration_json, new_configuration_json, reason, authorized_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rev.id, rev.habit_id, rev.effective_from, rev.effective_until,
        JSON.stringify(rev.previous_configuration), JSON.stringify(rev.new_configuration),
        rev.reason, rev.authorized_by, rev.created_at
      );
      return rev;
    },
    listHabitRevisions(habitId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM nl_habit_revisions WHERE habit_id = ? ORDER BY created_at DESC').all(habitId)
        .map(r => ({
          ...r,
          previous_configuration: JSON.parse(r.previous_configuration_json),
          new_configuration: JSON.parse(r.new_configuration_json),
        }));
    },

    // Routines
    insertRoutine(r) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO nl_routines (
          id, name, description, category, expected_duration_minutes, frequency_json,
          preferred_time_window_json, status, version, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        r.id, r.name, r.description, r.category, r.expected_duration_minutes, JSON.stringify(r.frequency),
        r.preferred_time_window ? JSON.stringify(r.preferred_time_window) : null,
        r.status, r.version, r.created_at, r.updated_at, r.archived_at
      );
      return r;
    },
    findRoutineById(id) {
      return hydrateRoutine(persistenceService.getReadDatabase().prepare('SELECT * FROM nl_routines WHERE id = ?').get(id));
    },
    listRoutines({ status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM nl_routines WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC
      `).all(status, status).map(hydrateRoutine);
    },
    updateRoutine(r) {
      persistenceService.getDatabase().prepare(`
        UPDATE nl_routines SET
          name=?, description=?, category=?, expected_duration_minutes=?, frequency_json=?,
          preferred_time_window_json=?, status=?, version=?, updated_at=?, archived_at=?
        WHERE id=?
      `).run(
        r.name, r.description, r.category, r.expected_duration_minutes, JSON.stringify(r.frequency),
        r.preferred_time_window ? JSON.stringify(r.preferred_time_window) : null,
        r.status, r.version, r.updated_at, r.archived_at, r.id
      );
      return r;
    },

    insertRoutineStep(s) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO nl_routine_steps (
          id, routine_id, name, description, step_order, estimated_duration_minutes, required,
          related_activity_id, related_habit_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
      `).run(
        s.id, s.routine_id, s.name, s.description, s.step_order, s.estimated_duration_minutes,
        s.required ? 1 : 0, s.related_activity_id, s.related_habit_id, s.created_at, s.updated_at
      );
      return s;
    },
    findRoutineStepById(id) {
      return hydrateStep(persistenceService.getReadDatabase().prepare('SELECT * FROM nl_routine_steps WHERE id = ?').get(id));
    },
    listRoutineSteps(routineId, { includeRemoved = false } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM nl_routine_steps
        WHERE routine_id = ? AND (? = 1 OR status = 'ACTIVE')
        ORDER BY step_order ASC
      `).all(routineId, includeRemoved ? 1 : 0).map(hydrateStep);
    },
    updateRoutineStep(s) {
      persistenceService.getDatabase().prepare(`
        UPDATE nl_routine_steps SET
          name=?, description=?, step_order=?, estimated_duration_minutes=?, required=?,
          related_activity_id=?, related_habit_id=?, status=?, updated_at=?
        WHERE id=?
      `).run(
        s.name, s.description, s.step_order, s.estimated_duration_minutes, s.required ? 1 : 0,
        s.related_activity_id, s.related_habit_id, s.status, s.updated_at, s.id
      );
      return s;
    },

    insertRoutineRevision(rev) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO nl_routine_revisions (id, routine_id, version, snapshot_json, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(rev.id, rev.routine_id, rev.version, JSON.stringify(rev.snapshot), rev.reason, rev.created_at);
      return rev;
    },
    listRoutineRevisions(routineId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM nl_routine_revisions WHERE routine_id = ? ORDER BY version DESC').all(routineId)
        .map(r => ({ ...r, snapshot: JSON.parse(r.snapshot_json) }));
    },

    insertRoutineExecution(ex) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO nl_routine_executions (id, routine_id, routine_version, scheduled_date, started_at, completed_at, status, steps_snapshot_json, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(ex.id, ex.routine_id, ex.routine_version, ex.scheduled_date, ex.started_at, ex.completed_at, ex.status, JSON.stringify(ex.steps_snapshot), ex.notes);
      return ex;
    },
    findRoutineExecutionById(id) {
      return hydrateExec(persistenceService.getReadDatabase().prepare('SELECT * FROM nl_routine_executions WHERE id = ?').get(id));
    },
    listRoutineExecutions({ routine_id = null, from = null, to = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM nl_routine_executions
        WHERE (? IS NULL OR routine_id = ?)
          AND (? IS NULL OR scheduled_date >= ?)
          AND (? IS NULL OR scheduled_date <= ?)
        ORDER BY started_at DESC
      `).all(routine_id, routine_id, from, from, to, to).map(hydrateExec);
    },
    updateRoutineExecution(ex) {
      persistenceService.getDatabase().prepare(`
        UPDATE nl_routine_executions SET completed_at=?, status=?, notes=? WHERE id=?
      `).run(ex.completed_at, ex.status, ex.notes, ex.id);
      return ex;
    },

    insertRoutineStepExecution(se) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO nl_routine_step_executions (
          id, routine_execution_id, routine_step_id, step_name, step_order, required, started_at, completed_at, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        se.id, se.routine_execution_id, se.routine_step_id, se.step_name, se.step_order,
        se.required ? 1 : 0, se.started_at, se.completed_at, se.status, se.notes
      );
      return se;
    },
    listRoutineStepExecutions(executionId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM nl_routine_step_executions WHERE routine_execution_id = ? ORDER BY step_order ASC').all(executionId).map(hydrateStepExec);
    },
    updateRoutineStepExecution(se) {
      persistenceService.getDatabase().prepare(`
        UPDATE nl_routine_step_executions SET started_at=?, completed_at=?, status=?, notes=? WHERE id=?
      `).run(se.started_at, se.completed_at, se.status, se.notes, se.id);
      return se;
    },
  };
}
