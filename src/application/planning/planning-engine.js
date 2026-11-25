import {
  addDays,
  formatDateInTimeZone,
  isValidTime,
  localTimeWindowToUtc,
} from '../../shared/clock.js';
import { isHabitScheduledOnDate } from '../../domain/habits/habit-validators.js';

export const DEFAULT_PLANNING_RULES = Object.freeze({
  default_task_duration_minutes: 45,
  default_habit_duration_minutes: 20,
  default_routine_duration_minutes: 30,
  buffer_ratio: 0.15,
  preagenda_day_of_week: 6, // Sábado (NL-MASTER-01 §12.3, configurable)
  preagenda_hour: '20:00',
});

function compareLex(aKey, bKey) {
  const len = Math.min(aKey.length, bKey.length);
  for (let i = 0; i < len; i += 1) {
    if (aKey[i] < bKey[i]) return -1;
    if (aKey[i] > bKey[i]) return 1;
  }
  return aKey.length - bKey.length;
}

function normalizePreferredWindow(pref, defaultMinutes = 120) {
  if (!pref || typeof pref !== 'object') return null;
  const start = pref.start ?? pref.start_time ?? null;
  const end = pref.end ?? pref.end_time ?? null;
  if (!isValidTime(start)) return null;
  if (isValidTime(end)) return { start, end };
  const [h, m] = start.split(':').map(Number);
  const totalMins = Math.min(23 * 60 + 59, h * 60 + m + defaultMinutes);
  const endH = String(Math.floor(totalMins / 60)).padStart(2, '0');
  const endM = String(totalMins % 60).padStart(2, '0');
  return { start, end: `${endH}:${endM}` };
}

export function createPlanningEngine(options = {}) {
  const { clock = null, ...rulesOverrides } = options ?? {};
  const rules = { ...DEFAULT_PLANNING_RULES, ...rulesOverrides };

  function resolveTimezone(inputs) {
    return inputs?.timezone ?? clock?.timezone ?? 'UTC';
  }

  function calculateAvailableTime(inputs) {
    const free = inputs.free_windows ?? [];
    let totalMinutes = 0;
    let allocatableMinutes = 0;
    let bufferMinutes = 0;

    for (const w of free) {
      const dur = w.duration_minutes ?? Math.max(0, Math.round((new Date(w.end_at).getTime() - new Date(w.start_at).getTime()) / 60000));
      const buf = Math.floor(dur * rules.buffer_ratio);
      const net = Math.max(0, dur - buf);
      totalMinutes += dur;
      bufferMinutes += buf;
      allocatableMinutes += net;
    }

    return {
      total_free_minutes: totalMinutes,
      buffer_minutes: bufferMinutes,
      allocatable_minutes: allocatableMinutes,
      buffer_ratio: rules.buffer_ratio,
      window_count: free.length,
    };
  }

  function evaluateConstraints(inputs) {
    const constraints = [];
    if ((inputs.free_windows ?? []).length === 0) {
      constraints.push({
        type: 'MISSING_AVAILABILITY',
        severity: 'CRITICAL',
        description: 'No existen ventanas de disponibilidad confirmadas en el periodo; la ausencia de eventos no equivale a tiempo libre (PLN-004).',
        suggested_resolution: 'Registra ventanas AvailabilityWindow CONFIRMED antes de generar una propuesta fiable.',
      });
    }

    for (const c of inputs.commitments ?? []) {
      if (c.status === 'CANCELLED') continue;
      constraints.push({
        type: 'CONFIRMED_COMMITMENT',
        severity: 'HIGH',
        entity: { type: 'commitment', id: c.id },
        due_at: c.due_at ?? null,
        description: `Compromiso registrado (${c.status}): ${c.title}${c.due_at ? ` [vence ${c.due_at}]` : ''}`,
      });
    }

    // Restricciones de proyectos detenidos/bloqueados
    for (const p of inputs.projects ?? []) {
      if (p.status === 'PAUSED' || p.status === 'BLOCKED') {
        constraints.push({
          type: 'PROJECT_PAUSED_OR_BLOCKED',
          severity: 'MEDIUM',
          entity: { type: 'project', id: p.id },
          description: `El proyecto '${p.name}' está en estado ${p.status}; sus tareas no se programan como activas.`,
        });
      }
    }

    // Restricciones financieras
    const currencies = inputs.financial_summary?.currencies ?? {};
    for (const [cur, summary] of Object.entries(currencies)) {
      if (Number(summary.available_money) < 0) {
        constraints.push({
          type: 'FINANCIAL_DEFICIT',
          severity: 'HIGH',
          currency: cur,
          available_money: summary.available_money,
          description: `Saldo disponible negativo en ${cur} (${summary.available_money} tras descontar reservas y compromisos pendientes).`,
          suggested_resolution: 'Revisa compromisos financieros pendientes o pospón actividades que requieran gasto.',
        });
      }
    }

    // Restricciones de inventario / reposición
    for (const rep of inputs.replenishment_alerts ?? []) {
      if (rep.cycle_status === 'NEEDS_REPLENISHMENT') {
        constraints.push({
          type: 'DEPLETED_INVENTORY_ITEM',
          severity: 'MEDIUM',
          entity: { type: 'product', id: rep.product_id },
          description: `Insumo '${rep.product_name ?? rep.product_id}' requiere reposición (stock actual: ${rep.current_quantity} ${rep.unit ?? ''}, mínimo: ${rep.minimum_quantity}).`,
          suggested_resolution: 'Evalúa reponer el insumo antes de ejecutar actividades dependientes.',
        });
      }
    }

    return constraints;
  }

  function prioritizeActivities(inputs) {
    const tz = resolveTimezone(inputs);
    const prioRank = new Map((inputs.priorities ?? []).map(p => [p.id, p.rank]));
    const projectsById = new Map((inputs.projects ?? []).map(p => [p.id, p]));

    // Mapear contribución a objetivos activos (directa o vía proyecto)
    const taskGoalsMap = new Map();
    const projectGoalsMap = new Map();
    for (const g of inputs.goals ?? []) {
      if (g.status !== 'ACTIVE') continue;
      for (const pid of g.project_ids ?? []) {
        if (!projectGoalsMap.has(pid)) projectGoalsMap.set(pid, []);
        projectGoalsMap.get(pid).push(g);
      }
      for (const tid of g.task_ids ?? []) {
        if (!taskGoalsMap.has(tid)) taskGoalsMap.set(tid, []);
        taskGoalsMap.get(tid).push(g);
      }
    }

    // Mapear insumos agotados vinculados mediante DomainRelation (REQUIRES / CONSUMES)
    const depletedProducts = new Map(
      (inputs.replenishment_alerts ?? [])
        .filter(r => r.cycle_status === 'NEEDS_REPLENISHMENT')
        .map(r => [r.product_id, r])
    );
    const hasFinancialDeficit = Object.values(inputs.financial_summary?.currencies ?? {})
      .some(s => Number(s.available_money) < 0);

    const entityResourceIssues = new Map();
    for (const rel of inputs.resource_relations ?? []) {
      if (!['REQUIRES', 'CONSUMES'].includes(rel.relation_type)) continue;
      const key = `${rel.source_entity_type}:${rel.source_entity_id}`;
      if (rel.target_entity_type === 'product' && depletedProducts.has(rel.target_entity_id)) {
        const prod = depletedProducts.get(rel.target_entity_id);
        if (!entityResourceIssues.has(key)) entityResourceIssues.set(key, []);
        entityResourceIssues.get(key).push({
          resource_type: 'product',
          resource_id: prod.product_id,
          reason: `Insumo requerido '${prod.product_name ?? prod.product_id}' en estado NEEDS_REPLENISHMENT (${prod.current_quantity}/${prod.minimum_quantity} ${prod.unit ?? ''}).`,
        });
      }
      if (['financial_commitment', 'budget', 'financial_account'].includes(rel.target_entity_type) && hasFinancialDeficit) {
        if (!entityResourceIssues.has(key)) entityResourceIssues.set(key, []);
        entityResourceIssues.get(key).push({
          resource_type: rel.target_entity_type,
          resource_id: rel.target_entity_id,
          reason: 'Restricción financiera activa: el saldo disponible neto es insuficiente.',
        });
      }
    }

    const startDate = inputs.period_start.length === 10
      ? inputs.period_start
      : formatDateInTimeZone(inputs.period_start, tz);
    const endDate = inputs.period_end.length === 10
      ? inputs.period_end
      : formatDateInTimeZone(inputs.period_end, tz);

    const allTasksById = new Map((inputs.tasks ?? []).map(t => [t.id, t]));
    const blockedByProject = [];
    const blockedByDependencies = [];
    const blockedByResources = [];
    const candidateTasks = [];

    // Construir mapa de dependencias activas entre tareas (origin depende de target)
    const rawDeps = inputs.task_dependencies ?? [];
    const prereqsOf = new Map();
    for (const dep of rawDeps) {
      if (dep.origin_entity_type === 'task' && dep.target_entity_type === 'task') {
        if (!prereqsOf.has(dep.origin_entity_id)) prereqsOf.set(dep.origin_entity_id, []);
        prereqsOf.get(dep.origin_entity_id).push(dep.target_entity_id);
      }
    }

    for (const t of inputs.tasks ?? []) {
      if (['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(t.status)) continue;

      // Filtrado por estado de proyecto padre
      if (t.project_id) {
        const parentProj = projectsById.get(t.project_id);
        if (parentProj && ['PAUSED', 'BLOCKED', 'CANCELLED', 'ARCHIVED'].includes(parentProj.status)) {
          if (parentProj.status === 'PAUSED' || parentProj.status === 'BLOCKED') {
            blockedByProject.push({
              task: t,
              project: parentProj,
              reason: `Excluida de programación activa porque su proyecto '${parentProj.name}' está ${parentProj.status}.`,
            });
          }
          continue;
        }
      }

      if (t.status === 'BLOCKED') {
        blockedByDependencies.push({
          task: t,
          missing_prereqs: prereqsOf.get(t.id) ?? [],
          reason: `La tarea '${t.title}' se encuentra explícitamente en estado BLOCKED.`,
        });
        continue;
      }

      // Verificar restricciones críticas de recursos vinculados directamente o vía proyecto
      const taskResIssues = [
        ...(entityResourceIssues.get(`task:${t.id}`) ?? []),
        ...(t.project_id ? (entityResourceIssues.get(`project:${t.project_id}`) ?? []) : []),
      ];
      if (taskResIssues.length > 0) {
        blockedByResources.push({
          task: t,
          issues: taskResIssues,
          reason: taskResIssues.map(i => i.reason).join(' '),
        });
        continue;
      }

      candidateTasks.push(t);
    }

    // Filtrar recursivamente tareas cuyos prerrequisitos no están COMPLETED ni en candidateTasks
    let changed = true;
    const candidateIds = new Set(candidateTasks.map(t => t.id));
    while (changed) {
      changed = false;
      for (const id of [...candidateIds]) {
        const prereqs = prereqsOf.get(id) ?? [];
        const unmetExternal = prereqs.filter(pid => {
          const pt = allTasksById.get(pid);
          if (pt && pt.status === 'COMPLETED') return false;
          return !candidateIds.has(pid);
        });
        if (unmetExternal.length > 0) {
          candidateIds.delete(id);
          const taskObj = allTasksById.get(id);
          blockedByDependencies.push({
            task: taskObj,
            missing_prereqs: unmetExternal,
            reason: `La tarea '${taskObj.title}' depende de prerrequisito(s) bloqueado(s) o no elegibles (${unmetExternal.join(', ')}).`,
          });
          changed = true;
        }
      }
    }

    // Construir metadatos base de puntuación determinista para cada tarea elegible
    const baseTaskMeta = new Map();
    for (const t of candidateTasks) {
      if (!candidateIds.has(t.id)) continue;
      const rank = prioRank.get(t.priority_id) ?? 3;
      const urgency = Number(t.urgency ?? 2);
      const contributingGoals = [
        ...(taskGoalsMap.get(t.id) ?? []),
        ...(t.project_id ? (projectGoalsMap.get(t.project_id) ?? []) : []),
      ];
      const uniqueGoalNames = [...new Set(contributingGoals.map(g => g.name))];
      const goalBoost = uniqueGoalNames.length > 0 ? 1 : 0;
      const dueInHorizon = Boolean(t.due_date && t.due_date <= endDate);
      const tier = (rank === 1 || dueInHorizon || (rank <= 2 && goalBoost > 0))
        ? 'ESSENTIAL'
        : (rank === 2 || goalBoost > 0 ? 'IMPORTANT' : 'COMPLEMENTARY');

      const activePrereqs = (prereqsOf.get(t.id) ?? []).filter(pid => candidateIds.has(pid));
      const baseSortKey = [
        tier === 'ESSENTIAL' ? 0 : (tier === 'IMPORTANT' ? 1 : 2),
        rank - goalBoost,
        -urgency,
        t.due_date ?? '9999-12-31',
        t.id,
      ];

      const explanationParts = [
        `Tarea (${t.status}) — prioridad rank=${rank}, urgencia=${urgency}`,
      ];
      if (t.project_id && projectsById.has(t.project_id)) {
        explanationParts.push(`proyecto='${projectsById.get(t.project_id).name}'`);
      }
      if (uniqueGoalNames.length > 0) {
        explanationParts.push(`contribuye a objetivo(s): ${uniqueGoalNames.join(', ')}`);
      }
      if (t.due_date) {
        explanationParts.push(`fecha límite=${t.due_date}`);
      }
      if (activePrereqs.length > 0) {
        const prereqTitles = activePrereqs.map(pid => allTasksById.get(pid)?.title ?? pid);
        explanationParts.push(`depende de: [${prereqTitles.join(', ')}]`);
      }

      baseTaskMeta.set(t.id, {
        related_entity_type: 'task',
        related_entity_id: t.id,
        title: t.title,
        duration_minutes: t.estimated_duration_minutes ?? rules.default_task_duration_minutes,
        duration_is_estimate: !t.estimated_duration_minutes,
        priority_tier: tier,
        own_tier_num: tier === 'ESSENTIAL' ? 0 : (tier === 'IMPORTANT' ? 1 : 2),
        effective_tier_num: tier === 'ESSENTIAL' ? 0 : (tier === 'IMPORTANT' ? 1 : 2),
        flexibility: 'FLEXIBLE',
        depends_on_task_ids: activePrereqs,
        preferred_time_window: null,
        base_sort_key: baseSortKey,
        explanation: `${explanationParts.join(', ')}.`,
      });
    }

    // Herencia de prioridad sobre el DAG: si una tarea ESSENTIAL depende de A, A hereda al menos su nivel efectivo
    const tierNames = ['ESSENTIAL', 'IMPORTANT', 'COMPLEMENTARY'];
    let inheritedChanged = true;
    while (inheritedChanged) {
      inheritedChanged = false;
      for (const meta of baseTaskMeta.values()) {
        for (const prereqId of meta.depends_on_task_ids) {
          const prereqMeta = baseTaskMeta.get(prereqId);
          if (prereqMeta && meta.effective_tier_num < prereqMeta.effective_tier_num) {
            prereqMeta.effective_tier_num = meta.effective_tier_num;
            prereqMeta.priority_tier = tierNames[meta.effective_tier_num];
            prereqMeta.base_sort_key[0] = meta.effective_tier_num;
            if (!prereqMeta.promoted_by) prereqMeta.promoted_by = meta.title;
            inheritedChanged = true;
          }
        }
      }
    }
    for (const meta of baseTaskMeta.values()) {
      if (meta.promoted_by) {
        meta.explanation = `${meta.explanation} Prioridad efectiva promovida a ${meta.priority_tier} por ser prerrequisito de '${meta.promoted_by}'.`;
      }
    }

    // Ordenación topológica determinista (Kahn con cola de prioridad lexicográfica)
    const inDegree = new Map();
    const dependentsOf = new Map();
    for (const [tid, meta] of baseTaskMeta.entries()) {
      inDegree.set(tid, meta.depends_on_task_ids.length);
      for (const prereqId of meta.depends_on_task_ids) {
        if (!dependentsOf.has(prereqId)) dependentsOf.set(prereqId, []);
        dependentsOf.get(prereqId).push(tid);
      }
    }

    const ready = [...baseTaskMeta.values()]
      .filter(m => inDegree.get(m.related_entity_id) === 0)
      .sort((a, b) => compareLex(a.base_sort_key, b.base_sort_key));

    const orderedTasks = [];
    let topoIndex = 0;
    while (ready.length > 0) {
      const next = ready.shift();
      next.topo_order = topoIndex;
      // effective_tier_num(prereq) <= effective_tier_num(dep) y topo_order(prereq) < topo_order(dep) garantizan orden estricto
      next.sort_key = [
        next.effective_tier_num,
        topoIndex,
        ...next.base_sort_key.slice(1),
      ];
      topoIndex += 1;
      orderedTasks.push(next);

      for (const depTaskId of dependentsOf.get(next.related_entity_id) ?? []) {
        const rem = inDegree.get(depTaskId) - 1;
        inDegree.set(depTaskId, rem);
        if (rem === 0) {
          ready.push(baseTaskMeta.get(depTaskId));
          ready.sort((a, b) => compareLex(a.base_sort_key, b.base_sort_key));
        }
      }
    }

    const items = [...orderedTasks];

    // 2. Hábitos activos como ocurrencias propias por día civil local (PLN-008)
    for (const h of inputs.habits ?? []) {
      if (h.status !== 'ACTIVE') continue;
      let cursor = startDate;
      let count = 0;
      const maxPerWeek = h.frequency?.type === 'TIMES_PER_WEEK' ? Number(h.frequency.times_per_week) : 31;
      while (cursor <= endDate && count < maxPerWeek) {
        if ((!h.end_date || cursor <= h.end_date) && isHabitScheduledOnDate(h.frequency, cursor, h.start_date, tz)) {
          const prefWin = normalizePreferredWindow(h.preferred_time_window, 90);
          items.push({
            related_entity_type: 'habit',
            related_entity_id: h.id,
            title: `${h.name} (${cursor})`,
            target_date: cursor,
            preferred_time_window: prefWin,
            duration_minutes: rules.default_habit_duration_minutes,
            duration_is_estimate: true,
            priority_tier: 'IMPORTANT',
            flexibility: 'FLEXIBLE',
            depends_on_task_ids: [],
            sort_key: [1, 1000, cursor, prefWin?.start ?? '12:00', h.id],
            explanation: `Ocurrencia propia del hábito '${h.name}' (${h.frequency.type}) para ${cursor}${prefWin ? ` [ventana preferida ${prefWin.start}-${prefWin.end}]` : ''}; no se duplica como tarea ordinaria (PLN-008).`,
          });
          count += 1;
        }
        cursor = addDays(cursor, 1);
      }
    }

    // 3. Rutinas activas iteradas por cada fecha aplicable del periodo según su frecuencia (PLN-009)
    for (const r of inputs.routines ?? []) {
      if (r.status !== 'ACTIVE') continue;
      const duration = r.expected_duration_minutes
        ?? (r.steps ?? []).reduce((acc, s) => acc + (s.estimated_duration_minutes ?? 10), 0)
        ?? rules.default_routine_duration_minutes;
      const freq = r.frequency ?? { type: 'DAILY' };
      const prefWin = normalizePreferredWindow(r.preferred_time_window, Math.max(90, duration * 2));
      let cursor = startDate;
      let count = 0;
      const maxPerWeek = freq.type === 'TIMES_PER_WEEK' ? Number(freq.times_per_week) : 31;

      while (cursor <= endDate && count < maxPerWeek) {
        if (isHabitScheduledOnDate(freq, cursor, null, tz)) {
          items.push({
            related_entity_type: 'routine',
            related_entity_id: r.id,
            title: `${r.name} (${cursor})`,
            target_date: cursor,
            preferred_time_window: prefWin,
            duration_minutes: duration || rules.default_routine_duration_minutes,
            duration_is_estimate: !r.expected_duration_minutes,
            priority_tier: 'IMPORTANT',
            flexibility: 'FLEXIBLE',
            depends_on_task_ids: [],
            sort_key: [1, 900, cursor, prefWin?.start ?? '08:00', r.id],
            explanation: `Ejecución planificada de rutina '${r.name}' (${(r.steps ?? []).length} pasos) en ${cursor}${prefWin ? ` [ventana preferida ${prefWin.start}-${prefWin.end}]` : ''}; conserva identidad propia (PLN-009).`,
          });
          count += 1;
        }
        cursor = addDays(cursor, 1);
      }
    }

    // Orden determinista global respetando dependencias entre tareas cuando comparten tier
    // (las tareas ya están ordenadas topológicamente con topo_order creciente)
    items.sort((a, b) => compareLex(a.sort_key, b.sort_key));

    return {
      items,
      blocked_by_project: blockedByProject,
      blocked_by_dependencies: blockedByDependencies,
      blocked_by_resources: blockedByResources,
    };
  }

  function distributeActivities(prioritizedResult, freeWindows, { timezone = 'UTC' } = {}) {
    const prioritizedItems = Array.isArray(prioritizedResult) ? prioritizedResult : prioritizedResult.items;
    const slots = (freeWindows ?? []).map((w, idx) => {
      const winStartMs = new Date(w.start_at).getTime();
      const winEndMs = new Date(w.end_at).getTime();
      const rawMs = Math.max(0, winEndMs - winStartMs);
      const bufferMs = Math.floor(rawMs * rules.buffer_ratio);
      const allocatableEndMs = winStartMs + (rawMs - bufferMs);
      const civilDate = formatDateInTimeZone(w.start_at, timezone);

      return {
        index: idx,
        civilDate,
        winStartMs,
        winEndMs,
        allocatableEndMs,
        bufferMs,
        availability_type: w.availability_type,
        segments: allocatableEndMs > winStartMs ? [{ startMs: winStartMs, endMs: allocatableEndMs }] : [],
      };
    });

    const scheduled = [];
    const unscheduled = [];
    const scheduledTaskEndMs = new Map();
    const unscheduledTaskIds = new Set();

    function tryAllocateInSlot(slot, neededMs, minStartMs, maxEndMs = Infinity) {
      for (let i = 0; i < slot.segments.length; i += 1) {
        const seg = slot.segments[i];
        const candidateStart = Math.max(seg.startMs, minStartMs);
        const candidateEnd = Math.min(seg.endMs, maxEndMs);
        if (candidateEnd - candidateStart >= neededMs) {
          const chosenEnd = candidateStart + neededMs;
          const nextSegs = [];
          if (candidateStart > seg.startMs) {
            nextSegs.push({ startMs: seg.startMs, endMs: candidateStart });
          }
          if (chosenEnd < seg.endMs) {
            nextSegs.push({ startMs: chosenEnd, endMs: seg.endMs });
          }
          slot.segments.splice(i, 1, ...nextSegs);
          return { startMs: candidateStart, endMs: chosenEnd };
        }
      }
      return null;
    }

    for (const item of prioritizedItems) {
      // 1. Verificar prerrequisitos de tareas ya evaluadas
      let earliestStartMs = 0;
      let prereqDeferred = false;
      for (const prereqId of item.depends_on_task_ids ?? []) {
        if (unscheduledTaskIds.has(prereqId) || !scheduledTaskEndMs.has(prereqId)) {
          prereqDeferred = true;
          break;
        }
        earliestStartMs = Math.max(earliestStartMs, scheduledTaskEndMs.get(prereqId));
      }

      if (prereqDeferred) {
        if (item.related_entity_type === 'task') unscheduledTaskIds.add(item.related_entity_id);
        unscheduled.push({
          ...item,
          status: 'DEFERRED',
          deferral_reason: 'PREREQUISITE_DEFERRED',
          planned_start: null,
          planned_end: null,
          explanation: `${item.explanation} Diferida porque al menos una tarea prerrequisito no pudo ubicarse en la capacidad disponible.`,
        });
        continue;
      }

      const neededMs = item.duration_minutes * 60000;
      const eligibleSlots = item.target_date
        ? slots.filter(s => s.civilDate === item.target_date)
        : slots;

      let placement = null;
      let matchedSlot = null;
      let usedPreferredWindow = false;

      // Pasada 1: Intentar ubicar dentro de preferred_time_window (en zona horaria local configurada)
      if (item.preferred_time_window) {
        for (const slot of eligibleSlots) {
          const prefBounds = localTimeWindowToUtc(
            slot.civilDate,
            item.preferred_time_window.start,
            item.preferred_time_window.end,
            timezone
          );
          const prefStartMs = Math.max(earliestStartMs, new Date(prefBounds.startUtc).getTime());
          const prefEndMs = new Date(prefBounds.endUtc).getTime();
          const found = tryAllocateInSlot(slot, neededMs, prefStartMs, prefEndMs);
          if (found) {
            placement = found;
            matchedSlot = slot;
            usedPreferredWindow = true;
            break;
          }
        }
      }

      // Pasada 2: Ubicar en cualquier segmento disponible que respete fecha y orden cronológico de dependencias
      if (!placement) {
        for (const slot of eligibleSlots) {
          const found = tryAllocateInSlot(slot, neededMs, earliestStartMs, Infinity);
          if (found) {
            placement = found;
            matchedSlot = slot;
            break;
          }
        }
      }

      if (placement && matchedSlot) {
        const startIso = new Date(placement.startMs).toISOString();
        const endIso = new Date(placement.endMs).toISOString();
        if (item.related_entity_type === 'task') {
          scheduledTaskEndMs.set(item.related_entity_id, placement.endMs);
        }
        scheduled.push({
          related_entity_type: item.related_entity_type,
          related_entity_id: item.related_entity_id,
          title: item.title,
          planned_start: startIso,
          planned_end: endIso,
          duration_minutes: item.duration_minutes,
          priority_tier: item.priority_tier,
          flexibility: item.flexibility,
          status: 'PLANNED',
          explanation: `${item.explanation} Asignado en ventana ${matchedSlot.availability_type}${usedPreferredWindow ? ' respetando horario preferido local' : ''} (margen reserva ${Math.round(rules.buffer_ratio * 100)}% protegido).`,
        });
      } else {
        if (item.related_entity_type === 'task') {
          unscheduledTaskIds.add(item.related_entity_id);
        }
        unscheduled.push({
          related_entity_type: item.related_entity_type,
          related_entity_id: item.related_entity_id,
          title: item.title,
          planned_start: null,
          planned_end: null,
          duration_minutes: item.duration_minutes,
          priority_tier: item.priority_tier,
          flexibility: item.flexibility,
          status: 'DEFERRED',
          deferral_reason: 'INSUFFICIENT_CAPACITY',
          explanation: `${item.explanation} Diferido por capacidad neta insuficiente tras reservar margen de contingencia (${Math.round(rules.buffer_ratio * 100)}%).`,
        });
      }
    }

    // Registrar explícitamente los bloques BUFFER reservados al final de cada ventana utilizada
    const bufferBlocks = slots
      .filter(s => s.bufferMs >= 60000)
      .map(s => ({
        related_entity_type: 'buffer',
        related_entity_id: null,
        title: `Margen de reserva (${s.civilDate})`,
        planned_start: new Date(s.allocatableEndMs).toISOString(),
        planned_end: new Date(s.winEndMs).toISOString(),
        duration_minutes: Math.round(s.bufferMs / 60000),
        priority_tier: 'OPTIONAL',
        flexibility: 'BUFFER',
        status: 'PLANNED',
        explanation: `Reserva explícita de imprevistos (${Math.round(rules.buffer_ratio * 100)}% de la ventana ${s.availability_type}).`,
      }));

    // Incluir también ítems diferidos por proyecto/dependencia/recursos en la propuesta como DEFERRED trazables
    if (!Array.isArray(prioritizedResult)) {
      for (const bp of prioritizedResult.blocked_by_project ?? []) {
        unscheduled.push({
          related_entity_type: 'task',
          related_entity_id: bp.task.id,
          title: bp.task.title,
          planned_start: null,
          planned_end: null,
          duration_minutes: bp.task.estimated_duration_minutes ?? rules.default_task_duration_minutes,
          priority_tier: 'COMPLEMENTARY',
          flexibility: 'FLEXIBLE',
          status: 'DEFERRED',
          deferral_reason: 'PROJECT_NOT_ACTIVE',
          explanation: bp.reason,
        });
      }
      for (const bd of prioritizedResult.blocked_by_dependencies ?? []) {
        unscheduled.push({
          related_entity_type: 'task',
          related_entity_id: bd.task.id,
          title: bd.task.title,
          planned_start: null,
          planned_end: null,
          duration_minutes: bd.task.estimated_duration_minutes ?? rules.default_task_duration_minutes,
          priority_tier: 'IMPORTANT',
          flexibility: 'FLEXIBLE',
          status: 'DEFERRED',
          deferral_reason: 'UNMET_TASK_DEPENDENCY',
          explanation: bd.reason,
        });
      }
      for (const br of prioritizedResult.blocked_by_resources ?? []) {
        unscheduled.push({
          related_entity_type: 'task',
          related_entity_id: br.task.id,
          title: br.task.title,
          planned_start: null,
          planned_end: null,
          duration_minutes: br.task.estimated_duration_minutes ?? rules.default_task_duration_minutes,
          priority_tier: 'IMPORTANT',
          flexibility: 'FLEXIBLE',
          status: 'DEFERRED',
          deferral_reason: 'INSUFFICIENT_RESOURCE',
          explanation: br.reason,
        });
      }
    }

    scheduled.sort((a, b) => a.planned_start.localeCompare(b.planned_start));
    return { scheduled, buffer_blocks: bufferBlocks, unscheduled };
  }

  function identifyConflicts(inputs, prioritizedResult, distribution, availableInfo) {
    const conflicts = [];
    if (availableInfo.window_count === 0) {
      conflicts.push({
        conflict_type: 'INSUFFICIENT_AVAILABILITY_INFO',
        severity: 'CRITICAL',
        related_entities: [],
        description: 'No hay ventanas de disponibilidad confirmadas en el periodo; no puede calcularse una propuesta fiable (PLN-004).',
        suggested_resolution: 'Registra ventanas de disponibilidad confirmadas y regenera la propuesta.',
      });
    }

    const capacityDeferred = distribution.unscheduled.filter(
      u => !u.deferral_reason || u.deferral_reason === 'INSUFFICIENT_CAPACITY' || u.deferral_reason === 'PREREQUISITE_DEFERRED'
    );
    if (capacityDeferred.length > 0) {
      conflicts.push({
        conflict_type: 'CAPACITY_OVERLOAD',
        severity: 'HIGH',
        related_entities: capacityDeferred.map(u => ({ type: u.related_entity_type, id: u.related_entity_id })),
        description: `${capacityDeferred.length} actividad(es) exceden la capacidad neta disponible (descontado ${Math.round(rules.buffer_ratio * 100)}% de margen) y quedaron diferidas.`,
        suggested_resolution: 'Pospón elementos complementarios, divide tareas extensas o amplía ventanas confirmadas.',
      });
    }

    for (const bd of prioritizedResult.blocked_by_dependencies ?? []) {
      conflicts.push({
        conflict_type: 'UNMET_TASK_DEPENDENCY',
        severity: 'HIGH',
        related_entities: [
          { type: 'task', id: bd.task.id },
          ...(bd.missing_prereqs ?? []).map(pid => ({ type: 'task', id: pid })),
        ],
        description: bd.reason,
        suggested_resolution: 'Desbloquea o completa primero las tareas prerrequisito antes de agendar esta tarea.',
      });
    }

    for (const bp of prioritizedResult.blocked_by_project ?? []) {
      conflicts.push({
        conflict_type: 'PROJECT_PAUSED_OR_BLOCKED',
        severity: 'MEDIUM',
        related_entities: [
          { type: 'project', id: bp.project.id },
          { type: 'task', id: bp.task.id },
        ],
        description: bp.reason,
        suggested_resolution: 'Reactiva el proyecto cuando desaparezca el bloqueo o mantén sus tareas diferidas.',
      });
    }

    for (const br of prioritizedResult.blocked_by_resources ?? []) {
      conflicts.push({
        conflict_type: 'INSUFFICIENT_RESOURCE',
        severity: 'HIGH',
        related_entities: [
          { type: 'task', id: br.task.id },
          ...br.issues.map(i => ({ type: i.resource_type, id: i.resource_id })),
        ],
        description: `Tarea '${br.task.title}' retenida por falta de recursos: ${br.reason}`,
        suggested_resolution: 'Repón el insumo requerido o ajusta la disponibilidad financiera antes de programar.',
      });
    }

    // Riesgo de compromisos con fecha límite próxima cuya entidad vinculada quedó diferida o vencida
    const scheduledByEntity = new Map(
      distribution.scheduled.map(it => [`${it.related_entity_type}:${it.related_entity_id}`, it])
    );
    for (const comm of inputs.commitments ?? []) {
      if (comm.status === 'COMPLETED' || comm.status === 'CANCELLED' || !comm.due_at) continue;
      if (comm.related_entity_type && comm.related_entity_id) {
        const key = `${comm.related_entity_type}:${comm.related_entity_id}`;
        const sched = scheduledByEntity.get(key);
        if (!sched || sched.planned_end > comm.due_at) {
          conflicts.push({
            conflict_type: 'COMMITMENT_AT_RISK',
            severity: 'HIGH',
            related_entities: [
              { type: 'commitment', id: comm.id },
              { type: comm.related_entity_type, id: comm.related_entity_id },
            ],
            description: !sched
              ? `El compromiso '${comm.title}' (vence ${comm.due_at}) está vinculado a ${key}, que no logró programarse en este horizonte.`
              : `El compromiso '${comm.title}' vence en ${comm.due_at}, pero ${key} terminaría después (${sched.planned_end}).`,
            suggested_resolution: 'Prioriza manualmente la actividad vinculada o negocia la fecha del compromiso.',
          });
        }
      }
    }

    // Déficit financiero general aunque no exista DomainRelation explícita
    for (const [cur, summary] of Object.entries(inputs.financial_summary?.currencies ?? {})) {
      if (Number(summary.available_money) < 0) {
        conflicts.push({
          conflict_type: 'INSUFFICIENT_RESOURCE',
          severity: 'HIGH',
          related_entities: [{ type: 'financial_account', id: cur }],
          description: `Compromisos financieros y reservas superan el saldo gastable en ${cur} (disponible neto: ${summary.available_money} ${cur}).`,
          suggested_resolution: 'Revisa compromisos financieros pendientes antes de asumir nuevos gastos.',
        });
      }
    }

    for (const evConf of inputs.event_conflicts ?? []) {
      conflicts.push({
        conflict_type: 'EVENT_OVERLAP',
        severity: 'HIGH',
        related_entities: [
          { type: 'calendar_event', id: evConf.first.id },
          { type: 'calendar_event', id: evConf.second.id },
        ],
        description: `Solapamiento detectado entre '${evConf.first.title}' y '${evConf.second.title}'. Los compromisos confirmados no se alteran automáticamente (INV-019).`,
        suggested_resolution: 'Revisa ambos eventos y decide manualmente cuál reprogramar.',
      });
    }

    return conflicts;
  }

  function explainProposal({ availableInfo, scheduled, bufferBlocks, unscheduled, conflicts, missingInfo, timezone }) {
    return {
      rules_applied: rules,
      timezone,
      summary: `Propuesta determinista (${timezone}): ${scheduled.length} actividades programadas, ${bufferBlocks.length} bloques de reserva protegidos (${availableInfo.buffer_minutes} min), ${unscheduled.length} diferidas y ${conflicts.length} conflictos detectados.`,
      available_minutes: availableInfo.total_free_minutes,
      allocatable_minutes: availableInfo.allocatable_minutes,
      buffer_minutes: availableInfo.buffer_minutes,
      missing_information: missingInfo,
      notes: [
        'Las propuestas son revisables y no constituyen un plan aprobado hasta contar con autorización explícita (PLN-001).',
        'El motor es 100% determinista y opera sin modelos de IA: mismas entradas producen idéntico resultado.',
        'Hábitos y rutinas conservan su identidad propia por fecha y ventana preferida sin duplicarse como tareas (PLN-008/009).',
        'Las dependencias entre tareas se ordenan topológica y cronológicamente; tareas de proyectos PAUSED/BLOCKED o sin recursos requeridos se difieren con explicación.',
      ],
    };
  }

  return {
    calculateAvailableTime,
    evaluateConstraints,
    prioritizeActivities,
    distributeActivities,
    identifyConflicts,
    explainProposal,

    generateProposal(inputs) {
      const timezone = resolveTimezone(inputs);
      const availableInfo = calculateAvailableTime(inputs);
      const constraints = evaluateConstraints(inputs);
      const prioritizedResult = prioritizeActivities(inputs);
      const distribution = distributeActivities(prioritizedResult, inputs.free_windows ?? [], { timezone });
      const conflicts = identifyConflicts(inputs, prioritizedResult, distribution, availableInfo);
      const missingInfo = inputs.missing_information ?? [];
      const reliable = availableInfo.window_count > 0;
      const explanation = explainProposal({
        availableInfo,
        scheduled: distribution.scheduled,
        bufferBlocks: distribution.buffer_blocks,
        unscheduled: distribution.unscheduled,
        conflicts,
        missingInfo,
        timezone,
      });

      return {
        reliable,
        timezone,
        available: availableInfo,
        constraints,
        proposed_items: [
          ...distribution.scheduled,
          ...distribution.buffer_blocks,
          ...distribution.unscheduled,
        ],
        scheduled_count: distribution.scheduled.length,
        buffer_blocks_count: distribution.buffer_blocks.length,
        deferred_count: distribution.unscheduled.length,
        conflicts,
        missing_information: missingInfo,
        explanation,
      };
    },
  };
}
