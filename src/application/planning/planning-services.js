import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { formatDateInTimeZone, localDateBoundsToUtc } from '../../shared/clock.js';
import { PLAN_TYPES } from '../../domain/shared/enums.js';

function itemIdentityKey(item, idx = 0) {
  if (item.related_entity_type === 'buffer') {
    const datePart = item.planned_start ? item.planned_start.slice(0, 10) : `idx_${idx}`;
    return `buffer:${datePart}`;
  }
  const dateTag = item.title?.match(/\((\d{4}-\d{2}-\d{2})\)$/)?.[1] ?? '';
  return `${item.related_entity_type}:${item.related_entity_id ?? 'none'}${dateTag ? `:${dateTag}` : ''}`;
}

export function computePlanVersionDiff(oldItems = [], newItems = []) {
  const oldMap = new Map();
  oldItems.forEach((it, idx) => oldMap.set(itemIdentityKey(it, idx), it));
  const newMap = new Map();
  newItems.forEach((it, idx) => newMap.set(itemIdentityKey(it, idx), it));

  const kept = [];
  const rescheduled = [];
  const deferred = [];
  const newly_scheduled = [];
  const added = [];
  const removed = [];

  for (const [key, next] of newMap.entries()) {
    const prev = oldMap.get(key);
    if (!prev) {
      added.push({ key, title: next.title, status: next.status, planned_start: next.planned_start, planned_end: next.planned_end });
      continue;
    }
    const prevScheduled = prev.status === 'PLANNED' || prev.status === 'RESCHEDULED';
    const nextScheduled = next.status === 'PLANNED' || next.status === 'RESCHEDULED';

    if (prevScheduled && !nextScheduled) {
      deferred.push({
        key,
        title: next.title,
        previous_start: prev.planned_start,
        previous_end: prev.planned_end,
        new_status: next.status,
        explanation: next.explanation,
      });
    } else if (!prevScheduled && nextScheduled) {
      newly_scheduled.push({
        key,
        title: next.title,
        previous_status: prev.status,
        new_start: next.planned_start,
        new_end: next.planned_end,
      });
    } else if (prev.planned_start !== next.planned_start || prev.planned_end !== next.planned_end) {
      rescheduled.push({
        key,
        title: next.title,
        previous_start: prev.planned_start,
        previous_end: prev.planned_end,
        new_start: next.planned_start,
        new_end: next.planned_end,
      });
    } else {
      kept.push({ key, title: next.title, status: next.status, planned_start: next.planned_start, planned_end: next.planned_end });
    }
  }

  for (const [key, prev] of oldMap.entries()) {
    if (!newMap.has(key)) {
      removed.push({ key, title: prev.title, previous_status: prev.status, previous_start: prev.planned_start });
    }
  }

  return {
    kept,
    rescheduled,
    deferred,
    newly_scheduled,
    added,
    removed,
    summary: `Conservados: ${kept.length}, reprogramados: ${rescheduled.length}, diferidos: ${deferred.length}, recién agendados: ${newly_scheduled.length}, añadidos: ${added.length}, retirados: ${removed.length}.`,
  };
}

export function createPlanningInputService({
  goalService = null,
  projectService = null,
  taskService = null,
  activityService = null,
  habitService = null,
  routineService = null,
  calendarService = null,
  commitmentService = null,
  availabilityService = null,
  financialTransactionService = null,
  financialCommitmentService = null,
  replenishmentService = null,
  relationService = null,
  personalRepository = null,
  clock = null,
}) {
  return {
    identifyMissingInformation({ availability, tasks, commitments }) {
      const missing = [];
      if (!availability || !availability.has_confirmed_windows) {
        missing.push('No existen ventanas AvailabilityWindow CONFIRMED en el periodo solicitado.');
      }
      const noDuration = (tasks ?? []).filter(t => !['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(t.status) && !t.estimated_duration_minutes);
      if (noDuration.length > 0) {
        missing.push(`${noDuration.length} tareas activas carecen de duración estimada (se usará estimación etiquetada).`);
      }
      const undatedCommitments = (commitments ?? []).filter(c => c.status !== 'CANCELLED' && c.status !== 'COMPLETED' && !c.due_at);
      if (undatedCommitments.length > 0) {
        missing.push(`${undatedCommitments.length} compromiso(s) activo(s) no especifican fecha/hora límite (due_at).`);
      }
      return missing;
    },

    identifyPlanningConstraints({ period_start, period_end }) {
      const events = calendarService ? calendarService.getEventsByPeriod(period_start, period_end, { status: 'CONFIRMED' }) : [];
      const commitments = commitmentService ? commitmentService.listCommitments({ from: period_start, to: period_end }) : [];
      const financial_summary = financialTransactionService ? financialTransactionService.getFinancialSummary() : { currencies: {} };
      const replenishment_alerts = replenishmentService ? replenishmentService.getReplenishmentStatus({ onlyAlerts: true }) : [];
      return { confirmed_events: events, commitments, financial_summary, replenishment_alerts };
    },

    collectPlanningInputs({ period_start, period_end, includePotentialAvailability = false }) {
      if (!period_start || !period_end) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'period_start y period_end son obligatorios.');
      }
      const timezone = clock?.timezone ?? 'UTC';
      const rawGoals = goalService ? goalService.listGoals({ status: 'ACTIVE' }) : [];
      const goals = rawGoals.map(g => ({
        ...g,
        project_ids: personalRepository ? personalRepository.listProjectsForGoal(g.id).map(p => p.id) : [],
        task_ids: personalRepository ? personalRepository.listTasksForGoal(g.id).map(t => t.id) : [],
      }));

      // Se recopilan TODOS los proyectos para conocer también cuáles están PAUSED o BLOCKED
      const projects = projectService ? projectService.listProjects({}) : [];
      const tasks = taskService ? taskService.listTasks({}) : [];
      const task_dependencies = personalRepository ? personalRepository.listAllDependencies('task') : [];
      const priorities = activityService ? activityService.listPriorities() : [];
      const habits = habitService ? habitService.listHabits({ status: 'ACTIVE' }) : [];
      const routines = routineService ? routineService.listRoutines({ status: 'ACTIVE' }) : [];
      const events = calendarService ? calendarService.getEventsByPeriod(period_start, period_end) : [];
      const eventConflicts = calendarService ? calendarService.detectEventConflicts({ from: period_start, to: period_end }) : [];
      const commitments = commitmentService ? commitmentService.listCommitments({ from: period_start, to: period_end }) : [];
      const availability = availabilityService ? availabilityService.getAvailability({ from: period_start, to: period_end }) : null;
      const freeInfo = availabilityService
        ? availabilityService.calculateFreeWindows({ from: period_start, to: period_end, includePotential: includePotentialAvailability })
        : { free_windows: [] };

      const financial_summary = financialTransactionService ? financialTransactionService.getFinancialSummary() : { currencies: {} };
      const financial_commitments = financialCommitmentService ? financialCommitmentService.listPendingCommitments() : [];
      const replenishment_alerts = replenishmentService ? replenishmentService.getReplenishmentStatus({ onlyAlerts: true }) : [];
      const resource_relations = relationService
        ? [
          ...relationService.listRelations({ relation_type: 'REQUIRES' }),
          ...relationService.listRelations({ relation_type: 'CONSUMES' }),
        ]
        : [];

      const missing_information = this.identifyMissingInformation({ availability, tasks, commitments });

      return {
        period_start,
        period_end,
        timezone,
        goals,
        projects,
        tasks,
        task_dependencies,
        priorities,
        habits,
        routines,
        events,
        event_conflicts: eventConflicts,
        commitments,
        availability,
        free_windows: freeInfo.free_windows,
        financial_summary,
        financial_commitments,
        replenishment_alerts,
        resource_relations,
        missing_information,
      };
    },

    getPlanningContext(options) {
      return this.collectPlanningInputs(options);
    },
  };
}

export function createPlanningService({ planningRepository, transactionService, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function resolveBaseVersion(planOrVersionId) {
    const byVer = planningRepository.findPlanVersionById(planOrVersionId);
    if (byVer) return byVer;
    const byPlan = planningRepository.findPlanById(planOrVersionId);
    if (byPlan) {
      if (byPlan.current_version_id) {
        return planningRepository.findPlanVersionById(byPlan.current_version_id);
      }
      const versions = planningRepository.listPlanVersions(byPlan.id);
      if (versions.length > 0) return versions[0];
    }
    throw new NexusError(ERROR_CODES.NOT_FOUND, `Plan o versión de plan no encontrada: ${planOrVersionId}`);
  }

  return {
    createPlan({ name, period_start, period_end, plan_type = 'WEEKLY' }) {
      if (!name || !period_start || !period_end) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name, period_start y period_end son obligatorios en Plan.');
      }
      if (!PLAN_TYPES.includes(plan_type)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `plan_type inválido: ${plan_type}`);
      }
      const now = nowIso();
      const plan = {
        id: randomUUID(),
        name: name.trim(),
        period_start,
        period_end,
        plan_type,
        status: 'DRAFT',
        current_version_id: null,
        approved_at: null,
        created_at: now,
        updated_at: now,
      };
      return planningRepository.insertPlan(plan);
    },

    getPlan(id) {
      const p = planningRepository.findPlanById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Plan no encontrado: ${id}`, { entity: 'Plan' });
      const versions = planningRepository.listPlanVersions(id);
      const currentItems = p.current_version_id ? planningRepository.listPlanItems(p.current_version_id) : [];
      return { ...p, versions, current_items: currentItems };
    },

    listPlans(filters = {}) { return planningRepository.listPlans(filters); },

    createPlanVersion(planId, { items = [], parent_version_id = null, proposal_id = null, change_summary = '', source = 'PLANNING_ENGINE' } = {}) {
      const plan = planningRepository.findPlanById(planId);
      if (!plan) throw new NexusError(ERROR_CODES.NOT_FOUND, `Plan no encontrado: ${planId}`);
      return transactionService.executeAtomicOperation(() => {
        const versions = planningRepository.listPlanVersions(planId);
        const nextNumber = versions.length > 0 ? versions[0].version_number + 1 : 1;
        const version = planningRepository.insertPlanVersion({
          id: randomUUID(),
          plan_id: planId,
          version_number: nextNumber,
          parent_version_id: parent_version_id ?? plan.current_version_id,
          proposal_id,
          created_at: nowIso(),
          approved_at: null,
          approval_status: 'DRAFT',
          change_summary,
          source,
        });
        const insertedItems = items.map(it => planningRepository.insertPlanItem({
          id: randomUUID(),
          plan_version_id: version.id,
          related_entity_type: it.related_entity_type,
          related_entity_id: it.related_entity_id ?? null,
          title: it.title,
          planned_start: it.planned_start ?? null,
          planned_end: it.planned_end ?? null,
          duration_minutes: it.duration_minutes ?? null,
          priority_tier: it.priority_tier ?? 'IMPORTANT',
          flexibility: it.flexibility ?? 'FLEXIBLE',
          status: it.status ?? 'PLANNED',
          explanation: it.explanation ?? '',
        }));
        return { ...version, items: insertedItems };
      });
    },

    approvePlanVersion(versionId, { authorizedBy = null } = {}) {
      if (!authorizedBy) {
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'PLN-001: Aprobar una versión de plan requiere autorización explícita del usuario (authorizedBy).');
      }
      const ver = planningRepository.findPlanVersionById(versionId);
      if (!ver) throw new NexusError(ERROR_CODES.NOT_FOUND, `Versión de plan no encontrada: ${versionId}`);
      if (ver.approval_status === 'APPROVED') {
        throw new NexusError(ERROR_CODES.CONFLICT, 'INV-014: Una versión ya aprobada es inmutable y no puede re-aprobarse.');
      }
      return transactionService.executeAtomicOperation(() => {
        const plan = planningRepository.findPlanById(ver.plan_id);
        const now = nowIso();
        // Si había una versión aprobada previa, marcarla SUPERSEDED conservando historial (PLN-002/003)
        if (plan.current_version_id && plan.current_version_id !== versionId) {
          const prev = planningRepository.findPlanVersionById(plan.current_version_id);
          if (prev && prev.approval_status === 'APPROVED') {
            planningRepository.updatePlanVersion({ ...prev, approval_status: 'SUPERSEDED' });
          }
        }
        const approved = planningRepository.updatePlanVersion({ ...ver, approval_status: 'APPROVED', approved_at: now });
        planningRepository.updatePlan({ ...plan, status: 'ACTIVE', current_version_id: versionId, approved_at: now, updated_at: now });
        auditService?.recordChange({
          entity_type: 'plan_version',
          entity_id: versionId,
          operation_type: 'plan.approve',
          new_state: { plan_id: plan.id, version_number: ver.version_number, approval_status: 'APPROVED' },
          source_id: authorizedBy,
        });
        return { ...approved, items: planningRepository.listPlanItems(versionId) };
      });
    },

    rejectPlanVersion(versionId, { reason = 'Rechazada por el usuario' } = {}) {
      const ver = planningRepository.findPlanVersionById(versionId);
      if (!ver) throw new NexusError(ERROR_CODES.NOT_FOUND, `Versión de plan no encontrada: ${versionId}`);
      if (ver.approval_status === 'APPROVED') {
        throw new NexusError(ERROR_CODES.CONFLICT, 'INV-014: No se puede rechazar una versión ya aprobada; crea una nueva versión de replanificación.');
      }
      return planningRepository.updatePlanVersion({ ...ver, approval_status: 'REJECTED', change_summary: reason });
    },

    comparePlanVersions(versionIdA, versionIdB) {
      const verA = planningRepository.findPlanVersionById(versionIdA);
      const verB = planningRepository.findPlanVersionById(versionIdB);
      if (!verA || !verB) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, 'Una de las versiones a comparar no existe.');
      }
      const itemsA = planningRepository.listPlanItems(versionIdA);
      const itemsB = planningRepository.listPlanItems(versionIdB);
      return {
        from_version: { id: verA.id, version_number: verA.version_number, approval_status: verA.approval_status },
        to_version: { id: verB.id, version_number: verB.version_number, approval_status: verB.approval_status },
        version_diff: computePlanVersionDiff(itemsA, itemsB),
      };
    },

    supersedePlanVersion(planOrVersionId, { items = [], proposal_id = null, change_summary = null, authorizedBy = null } = {}) {
      const oldVer = resolveBaseVersion(planOrVersionId);
      const oldItems = planningRepository.listPlanItems(oldVer.id);
      const version_diff = computePlanVersionDiff(oldItems, items);
      const computedSummary = change_summary
        ? `${change_summary} (${version_diff.summary})`
        : `Replanificación derivada de v${oldVer.version_number}: ${version_diff.summary}`;

      return transactionService.executeAtomicOperation(() => {
        const newVer = this.createPlanVersion(oldVer.plan_id, {
          items,
          parent_version_id: oldVer.id,
          proposal_id,
          change_summary: computedSummary,
        });
        if (authorizedBy) {
          const approved = this.approvePlanVersion(newVer.id, { authorizedBy });
          return { ...approved, previous_version_id: oldVer.id, version_diff };
        }
        return { ...newVer, previous_version_id: oldVer.id, version_diff };
      });
    },

    getPlanHistory(planId) {
      this.getPlan(planId);
      const versions = planningRepository.listPlanVersions(planId).map(v => ({
        ...v,
        items: planningRepository.listPlanItems(v.id),
      }));
      // Adjuntar diff respecto a parent_version_id para trazabilidad histórica completa
      const byId = new Map(versions.map(v => [v.id, v]));
      return versions.map(v => ({
        ...v,
        version_diff: v.parent_version_id && byId.has(v.parent_version_id)
          ? computePlanVersionDiff(byId.get(v.parent_version_id).items, v.items)
          : null,
      }));
    },
  };
}

export function createPlanningProposalService({ planningRepository, planningInputService, planningEngine, planningService, transactionService, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createProposal(planId, { includePotentialAvailability = false } = {}) {
      const plan = planningRepository.findPlanById(planId);
      if (!plan) throw new NexusError(ERROR_CODES.NOT_FOUND, `Plan no encontrado: ${planId}`);
      const inputs = planningInputService.collectPlanningInputs({
        period_start: plan.period_start,
        period_end: plan.period_end,
        includePotentialAvailability,
      });
      const generated = planningEngine.generateProposal(inputs);

      // Si el plan ya tiene una versión activa, calcular también el diff previo para explicar qué cambiaría al replanificar
      let replan_diff = null;
      if (plan.current_version_id) {
        const currentItems = planningRepository.listPlanItems(plan.current_version_id);
        replan_diff = computePlanVersionDiff(currentItems, generated.proposed_items);
      }

      return transactionService.executeAtomicOperation(() => {
        const proposal = planningRepository.insertProposal({
          id: randomUUID(),
          plan_id: planId,
          generated_at: nowIso(),
          proposal_status: 'DRAFT',
          reliable: generated.reliable,
          generation_context: {
            period_start: plan.period_start,
            period_end: plan.period_end,
            timezone: generated.timezone,
            available: generated.available,
            constraints_count: (generated.constraints ?? []).length,
            replan_diff,
          },
          proposed_items: generated.proposed_items,
          explanation: {
            ...generated.explanation,
            ...(replan_diff ? { replan_diff } : {}),
          },
          conflict_summary: generated.conflicts,
          missing_information: generated.missing_information,
        });
        for (const c of generated.conflicts) {
          planningRepository.insertConflict({
            id: randomUUID(),
            proposal_id: proposal.id,
            conflict_type: c.conflict_type,
            related_entities: c.related_entities ?? [],
            severity: c.severity,
            description: c.description,
            suggested_resolution: c.suggested_resolution ?? '',
            status: 'OPEN',
          });
        }
        return this.getProposal(proposal.id);
      });
    },

    getProposal(id) {
      const p = planningRepository.findProposalById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta no encontrada: ${id}`, { entity: 'PlanningProposal' });
      return { ...p, conflicts: planningRepository.listConflictsByProposal(id) };
    },

    updateProposal(id, { proposed_items, explanation } = {}) {
      const p = planningRepository.findProposalById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta no encontrada: ${id}`);
      if (p.proposal_status === 'ACCEPTED') {
        throw new NexusError(ERROR_CODES.CONFLICT, 'Una propuesta aceptada se conserva intacta (NL-MASTER-01 §12.4).');
      }
      return planningRepository.updateProposal({
        ...p,
        proposed_items: proposed_items ?? p.proposed_items,
        explanation: explanation ?? p.explanation,
      });
    },

    presentProposal(id) {
      const p = planningRepository.findProposalById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta no encontrada: ${id}`);
      return planningRepository.updateProposal({ ...p, proposal_status: 'PRESENTED' });
    },

    acceptProposal(id, { authorizedBy = null, authorized_by = null, change_summary = 'Aprobación de propuesta' } = {}) {
      const authorizer = authorizedBy ?? authorized_by;
      if (!authorizer) {
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'PLN-001: Aceptar una propuesta requiere autorización explícita del usuario (authorizedBy).');
      }
      const p = planningRepository.findProposalById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta no encontrada: ${id}`);
      return transactionService.executeAtomicOperation(() => {
        const plan = planningRepository.findPlanById(p.plan_id);
        planningRepository.updateProposal({ ...p, proposal_status: 'ACCEPTED' });
        if (plan.current_version_id) {
          return planningService.supersedePlanVersion(plan.current_version_id, {
            items: p.proposed_items,
            proposal_id: p.id,
            change_summary,
            authorizedBy: authorizer,
          });
        }
        const version = planningService.createPlanVersion(p.plan_id, {
          items: p.proposed_items,
          proposal_id: p.id,
          change_summary,
        });
        return planningService.approvePlanVersion(version.id, { authorizedBy: authorizer });
      });
    },

    rejectProposal(id) {
      const p = planningRepository.findProposalById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta no encontrada: ${id}`);
      return planningRepository.updateProposal({ ...p, proposal_status: 'REJECTED' });
    },

    compareProposals(idA, idB) {
      const a = this.getProposal(idA);
      const b = this.getProposal(idB);
      return {
        proposal_a: { id: a.id, items: a.proposed_items.length, conflicts: a.conflicts.length, reliable: a.reliable },
        proposal_b: { id: b.id, items: b.proposed_items.length, conflicts: b.conflicts.length, reliable: b.reliable },
        items_diff: computePlanVersionDiff(a.proposed_items, b.proposed_items),
      };
    },
  };
}

export function createAgendaService({ planningService, planningProposalService, planningRepository, clock = null }) {
  const defaultTz = () => clock?.timezone ?? 'UTC';

  return {
    generateWeeklyAgenda({ name, week_start, week_end, includePotentialAvailability = false }) {
      const tz = defaultTz();
      const startIso = week_start.length === 10 ? localDateBoundsToUtc(week_start, tz).startUtc : week_start;
      const endIso = week_end.length === 10 ? localDateBoundsToUtc(week_end, tz).endUtc : week_end;
      const labelDate = formatDateInTimeZone(startIso, tz);

      const plan = planningService.createPlan({
        name: name ?? `Preagenda semanal ${labelDate}`,
        period_start: startIso,
        period_end: endIso,
        plan_type: 'WEEKLY',
      });
      const proposal = planningProposalService.createProposal(plan.id, { includePotentialAvailability });
      return { plan, proposal };
    },

    generateDailyAgenda({ date, includePotentialAvailability = false }) {
      const tz = defaultTz();
      const bounds = localDateBoundsToUtc(date, tz);
      const plan = planningService.createPlan({
        name: `Agenda diaria ${date}`,
        period_start: bounds.startUtc,
        period_end: bounds.endUtc,
        plan_type: 'DAILY',
      });
      const proposal = planningProposalService.createProposal(plan.id, { includePotentialAvailability });
      return { plan, proposal };
    },

    replanAgenda(planId, { includePotentialAvailability = false } = {}) {
      return planningProposalService.createProposal(planId, { includePotentialAvailability });
    },

    getAgenda(planId) {
      return planningService.getPlan(planId);
    },

    updateAgendaItem(itemId, patch) {
      const item = planningRepository.findPlanItemById(itemId);
      if (!item) throw new NexusError(ERROR_CODES.NOT_FOUND, `Elemento de agenda no encontrado: ${itemId}`);
      const ver = planningRepository.findPlanVersionById(item.plan_version_id);
      if (ver?.approval_status === 'APPROVED') {
        throw new NexusError(ERROR_CODES.CONFLICT, 'INV-014: Un plan aprobado es inmutable; crea una nueva versión de replanificación con supersedePlanVersion().');
      }
      return planningRepository.updatePlanItem({ ...item, ...patch });
    },

    rescheduleAgendaItem(itemId, { planned_start, planned_end }) {
      return this.updateAgendaItem(itemId, { planned_start, planned_end, status: 'RESCHEDULED' });
    },

    getAgendaConflicts(proposalId) {
      return planningRepository.listConflictsByProposal(proposalId);
    },
  };
}

export function createDailyReviewService({
  planningRepository,
  executionService = null,
  habitService = null,
  routineService = null,
  clock = null,
}) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const defaultTz = () => clock?.timezone ?? 'UTC';

  return {
    generateDailyReview(reviewDate) {
      const tz = defaultTz();
      const bounds = localDateBoundsToUtc(reviewDate, tz);
      const from = bounds.startUtc;
      const to = bounds.endUtc;

      const plans = planningRepository.listPlans({ status: 'ACTIVE' })
        .filter(p => p.period_start <= to && p.period_end >= from);
      const planned = [];
      for (const p of plans) {
        if (!p.current_version_id) continue;
        const items = planningRepository.listPlanItems(p.current_version_id)
          .filter(it => it.related_entity_type !== 'buffer' && it.status !== 'DEFERRED' && (!it.planned_start || (it.planned_start >= from && it.planned_start <= to)));
        planned.push(...items);
      }

      const executions = executionService ? executionService.listExecutions({ from, to }) : [];
      const routineExecs = routineService ? routineService.listRoutineExecutions({ from: reviewDate, to: reviewDate }) : [];
      const habits = habitService ? habitService.listHabits({ status: 'ACTIVE' }) : [];
      const habitStates = habits.map(h => {
        const occs = habitService.getHabitOccurrences(h.id, { from: reviewDate, to: reviewDate, fillUnknown: true });
        return {
          habit_id: h.id,
          name: h.name,
          scheduled_today: occs.length > 0,
          status: occs[0]?.status ?? 'NOT_SCHEDULED',
        };
      });

      const execByEntity = new Map();
      for (const ex of executions) {
        const key = `${ex.related_entity_type}:${ex.related_entity_id}`;
        if (!execByEntity.has(key)) execByEntity.set(key, []);
        execByEntity.get(key).push(ex);
      }
      const routineExecByRoutine = new Map();
      for (const re of routineExecs) {
        if (!routineExecByRoutine.has(re.routine_id)) routineExecByRoutine.set(re.routine_id, []);
        routineExecByRoutine.get(re.routine_id).push(re);
      }
      const habitStateMap = new Map(habitStates.map(h => [h.habit_id, h]));

      // Comparación ítem por ítem entre lo planeado y lo realmente ejecutado (PLN-006 / PLN-010)
      const itemComparisons = [];
      const missingResults = [];
      const seenMissingKeys = new Set();

      for (const it of planned) {
        let actualStatus = 'UNKNOWN';
        let evaluation = 'UNKNOWN';

        if (it.related_entity_type === 'habit') {
          const hs = habitStateMap.get(it.related_entity_id);
          actualStatus = hs?.status ?? 'UNKNOWN';
          evaluation = actualStatus === 'COMPLETED'
            ? 'EXECUTED_AS_PLANNED'
            : (actualStatus === 'PARTIAL' ? 'PARTIAL' : (actualStatus === 'SKIPPED' || actualStatus === 'MISSED' ? actualStatus : 'UNKNOWN'));
        } else if (it.related_entity_type === 'routine') {
          const rList = routineExecByRoutine.get(it.related_entity_id) ?? [];
          if (rList.length > 0) {
            actualStatus = rList[0].status;
            evaluation = actualStatus === 'COMPLETED' ? 'EXECUTED_AS_PLANNED' : 'PARTIAL';
          }
        } else {
          const exList = execByEntity.get(`${it.related_entity_type}:${it.related_entity_id}`) ?? [];
          if (exList.length > 0) {
            const anyCompleted = exList.some(e => e.execution_status === 'COMPLETED');
            actualStatus = anyCompleted ? 'COMPLETED' : exList[0].execution_status;
            evaluation = anyCompleted ? 'EXECUTED_AS_PLANNED' : 'PARTIAL';
          }
        }

        itemComparisons.push({
          plan_item_id: it.id,
          entity_type: it.related_entity_type,
          entity_id: it.related_entity_id,
          title: it.title,
          planned_start: it.planned_start,
          planned_end: it.planned_end,
          planned_duration_minutes: it.duration_minutes,
          actual_status: actualStatus,
          evaluation,
        });

        if (evaluation === 'UNKNOWN') {
          const mKey = `${it.related_entity_type}:${it.related_entity_id}`;
          if (!seenMissingKeys.has(mKey)) {
            seenMissingKeys.add(mKey);
            missingResults.push({
              entity_type: it.related_entity_type,
              entity_id: it.related_entity_id,
              title: it.title,
              status: 'UNKNOWN', // PLN-010: ausencia de registro jamás equivale a MISSED
            });
          }
        }
      }

      for (const hs of habitStates) {
        const mKey = `habit:${hs.habit_id}`;
        if (hs.scheduled_today && hs.status === 'UNKNOWN' && !seenMissingKeys.has(mKey)) {
          seenMissingKeys.add(mKey);
          missingResults.push({ entity_type: 'habit', entity_id: hs.habit_id, title: hs.name, status: 'UNKNOWN' });
        }
      }

      const existing = planningRepository.findDailyReviewByDate(reviewDate);
      return planningRepository.upsertDailyReview({
        id: existing?.id ?? randomUUID(),
        review_date: reviewDate,
        planned_summary: planned,
        executed_summary: {
          timezone: tz,
          bounds: { from, to },
          executions,
          routine_executions: routineExecs,
          habits: habitStates,
          item_comparisons: itemComparisons,
        },
        missing_results: missingResults,
        corrections: existing?.corrections ?? [],
        obstacles: existing?.obstacles ?? [],
        context_changes: existing?.context_changes ?? [],
        summary_text: `Cierre diario ${reviewDate} (${tz}): ${planned.length} elementos planeados, ${executions.length} ejecuciones, ${routineExecs.length} rutinas, ${missingResults.length} elementos sin resultado confirmado (UNKNOWN).`,
        status: existing?.status ?? 'OPEN',
        created_at: existing?.created_at ?? nowIso(),
        closed_at: existing?.closed_at ?? null,
      });
    },

    identifyMissingResults(reviewDate) {
      const review = planningRepository.findDailyReviewByDate(reviewDate) ?? this.generateDailyReview(reviewDate);
      return review.missing_results;
    },

    registerDailyCorrection(reviewDate, { entity_type, entity_id, actual_status, obstacle = null, context_change = null, notes = '' }) {
      const review = planningRepository.findDailyReviewByDate(reviewDate) ?? this.generateDailyReview(reviewDate);
      const corrections = [...review.corrections, { entity_type, entity_id, actual_status, notes, recorded_at: nowIso() }];
      const obstacles = obstacle ? [...review.obstacles, obstacle] : review.obstacles;
      const context_changes = context_change ? [...review.context_changes, context_change] : review.context_changes;
      const missing_results = review.missing_results.filter(m => !(m.entity_type === entity_type && m.entity_id === entity_id));
      return planningRepository.upsertDailyReview({
        ...review,
        corrections,
        obstacles,
        context_changes,
        missing_results,
      });
    },

    closeDay(reviewDate, { summary_text = null } = {}) {
      const review = planningRepository.findDailyReviewByDate(reviewDate) ?? this.generateDailyReview(reviewDate);
      return planningRepository.upsertDailyReview({
        ...review,
        summary_text: summary_text ?? review.summary_text,
        status: 'CLOSED',
        closed_at: nowIso(),
      });
    },

    getDailySummary(reviewDate) {
      const review = planningRepository.findDailyReviewByDate(reviewDate);
      if (!review) throw new NexusError(ERROR_CODES.NOT_FOUND, `No existe cierre diario para ${reviewDate}.`);
      return review;
    },
  };
}
