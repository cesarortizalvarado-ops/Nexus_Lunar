import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { INTERVENTION_CLASSIFICATIONS } from '../../domain/shared/enums.js';

export function createAdaptiveAnalysisService({
  adaptationRepository,
  projectService = null,
  taskService = null,
  executionService = null,
  workSessionService = null,
  observationService = null,
  habitService = null,
  planningService = null,
  replenishmentService = null,
  transactionService = null,
  auditService = null,
  clock = null,
  minSampleSize = 2,
}) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));

  function inTx(fn) {
    return transactionService ? transactionService.executeAtomicOperation(fn) : fn();
  }

  function upsertCandidateObservation({ observation_type, related_entity_type = null, related_entity_id = null, description, evidence_references = [], confidence = 0.7 }) {
    const existing = adaptationRepository.findOpenObservation(observation_type, related_entity_type, related_entity_id);
    if (existing) {
      return adaptationRepository.updateObservation({
        ...existing,
        description,
        evidence_references,
        confidence,
        observed_at: nowIso(),
      });
    }
    return adaptationRepository.insertObservation({
      id: randomUUID(),
      observation_type,
      related_entity_type,
      related_entity_id,
      description,
      evidence_references,
      confidence,
      observed_at: nowIso(),
      status: 'CANDIDATE', // Nunca se promueve automáticamente a regla permanente
    });
  }

  function buildSuggestedHabitFrequency(habit) {
    const freq = habit.frequency ?? { type: 'DAILY' };
    if (freq.type === 'DAILY') {
      return { type: 'TIMES_PER_WEEK', times_per_week: 4 };
    }
    if (freq.type === 'TIMES_PER_WEEK' && Number(freq.times_per_week) > 2) {
      return { type: 'TIMES_PER_WEEK', times_per_week: Number(freq.times_per_week) - 1 };
    }
    if (freq.type === 'SPECIFIC_DAYS' && Array.isArray(freq.weekdays) && freq.weekdays.length > 2) {
      return { type: 'SPECIFIC_DAYS', weekdays: freq.weekdays.slice(0, freq.weekdays.length - 1) };
    }
    return { type: 'TIMES_PER_WEEK', times_per_week: 3 };
  }

  return {
    listObservations(filters = {}) {
      return adaptationRepository.listObservations(filters);
    },

    listSuggestions(filters = {}) {
      return adaptationRepository.listSuggestions(filters);
    },

    analyzeExecutionHistory({ related_entity_type = null, related_entity_id = null } = {}) {
      const executions = executionService ? executionService.listExecutions({ related_entity_type, related_entity_id }) : [];
      let totalMinutes = 0;
      let sessionCount = 0;
      for (const ex of executions) {
        const sessions = workSessionService ? workSessionService.listSessionsByExecution(ex.id) : [];
        for (const s of sessions) {
          if (s.duration_minutes != null) {
            totalMinutes += s.duration_minutes;
            sessionCount += 1;
          }
        }
      }
      return {
        executions_count: executions.length,
        sessions_count: sessionCount,
        total_real_minutes: totalMinutes,
        average_session_minutes: sessionCount > 0 ? Math.round(totalMinutes / sessionCount) : null,
      };
    },

    calculateDurationEstimates(taskId) {
      if (!taskService || !executionService || !workSessionService) {
        return { task_id: taskId, suggested_minutes: null, sufficient_data: false, is_estimate: true };
      }
      const task = taskService.getTask(taskId);
      const execs = executionService.listExecutions({ related_entity_type: 'task', related_entity_id: taskId });
      const durations = [];
      for (const ex of execs) {
        const mins = workSessionService.listSessionsByExecution(ex.id)
          .reduce((acc, s) => acc + (s.duration_minutes ?? 0), 0);
        if (mins > 0) durations.push(mins);
      }
      if (durations.length < minSampleSize) {
        return {
          task_id: taskId,
          original_estimate: task.estimated_duration_minutes,
          sample_size: durations.length,
          suggested_minutes: null,
          sufficient_data: false,
          is_estimate: true,
        };
      }
      const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      return {
        task_id: taskId,
        original_estimate: task.estimated_duration_minutes,
        sample_size: durations.length,
        suggested_minutes: avg,
        deviation_minutes: task.estimated_duration_minutes ? avg - task.estimated_duration_minutes : null,
        sufficient_data: true,
        is_estimate: true,
      };
    },

    detectRecurringObstacles() {
      const observations = observationService ? observationService.listObservations({}) : [];
      const freq = new Map();
      for (const o of observations) {
        const key = o.content.trim().toLowerCase();
        if (!freq.has(key)) freq.set(key, { text: o.content, count: 0, ids: [], entity_type: o.related_entity_type, entity_id: o.related_entity_id });
        const entry = freq.get(key);
        entry.count += 1;
        entry.ids.push(o.id);
      }
      return [...freq.values()].filter(e => e.count >= minSampleSize);
    },

    identifyPatterns() {
      return inTx(() => {
        const recordedObservations = [];
        const tasks = taskService ? taskService.listTasks({}) : [];
        const today = todayDate();

        // 1. Desviación sistemática de duración en tareas
        for (const t of tasks) {
          const est = this.calculateDurationEstimates(t.id);
          if (est.sufficient_data && est.original_estimate && Math.abs(est.deviation_minutes) >= 15) {
            recordedObservations.push(upsertCandidateObservation({
              observation_type: 'DURATION_DEVIATION',
              related_entity_type: 'task',
              related_entity_id: t.id,
              description: `La tarea '${t.title}' promedia ${est.suggested_minutes} min reales frente a ${est.original_estimate} min estimados (${est.sample_size} ejecuciones).`,
              evidence_references: [t.id, `suggested_minutes:${est.suggested_minutes}`, `original_minutes:${est.original_estimate}`],
              confidence: Math.min(0.95, Number((0.5 + est.sample_size * 0.1).toFixed(2))),
            }));
          }
        }

        // 2. Cumplimiento irregular de hábitos (sobre ocurrencias conocidas)
        const habits = habitService ? habitService.listHabits({ status: 'ACTIVE' }) : [];
        for (const h of habits) {
          const stats = habitService.calculateHabitStatistics(h.id);
          if (stats.known_occurrences >= minSampleSize && stats.completion_rate_of_known !== null && stats.completion_rate_of_known < 0.5) {
            recordedObservations.push(upsertCandidateObservation({
              observation_type: 'HABIT_IRREGULAR_COMPLIANCE',
              related_entity_type: 'habit',
              related_entity_id: h.id,
              description: `El hábito '${h.name}' registra cumplimiento de ${(stats.completion_rate_of_known * 100).toFixed(0)}% sobre ${stats.known_occurrences} ocurrencias conocidas.`,
              evidence_references: [h.id],
              confidence: 0.7,
            }));
          }
        }

        // 3. Obstáculos recurrentes en observaciones de ejecución
        for (const obsGroup of this.detectRecurringObstacles()) {
          recordedObservations.push(upsertCandidateObservation({
            observation_type: 'RECURRING_OBSTACLE',
            related_entity_type: obsGroup.entity_type,
            related_entity_id: obsGroup.entity_id,
            description: `Obstáculo recurrente detectado ${obsGroup.count} veces: "${obsGroup.text}".`,
            evidence_references: obsGroup.ids,
            confidence: Math.min(0.9, 0.5 + obsGroup.count * 0.1),
          }));
        }

        // 4. Proyectos activos estancados (con tareas bloqueadas o vencidas sin ejecuciones recientes)
        const activeProjects = projectService ? projectService.listProjects({ status: 'ACTIVE' }) : [];
        for (const proj of activeProjects) {
          const projTasks = tasks.filter(t => t.project_id === proj.id && !['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(t.status));
          if (projTasks.length === 0) continue;
          const blockedOrOverdue = projTasks.filter(t => t.status === 'BLOCKED' || (t.due_date && t.due_date < today));
          if (blockedOrOverdue.length >= 1) {
            const anyRecentExec = executionService
              ? projTasks.some(t => executionService.listExecutions({ related_entity_type: 'task', related_entity_id: t.id }).length > 0)
              : false;
            if (!anyRecentExec) {
              recordedObservations.push(upsertCandidateObservation({
                observation_type: 'STALLED_PROJECT',
                related_entity_type: 'project',
                related_entity_id: proj.id,
                description: `El proyecto activo '${proj.name}' presenta ${blockedOrOverdue.length} tarea(s) bloqueada(s) o vencida(s) sin ejecuciones registradas.`,
                evidence_references: [proj.id, ...blockedOrOverdue.map(t => t.id)],
                confidence: 0.75,
              }));
            }
          }
        }

        // 5. Cuellos de botella por dependencias entre tareas
        const blockersCount = new Map();
        for (const t of tasks) {
          if (['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(t.status)) continue;
          const fullTask = taskService.getTask(t.id);
          for (const dep of fullTask.dependencies ?? []) {
            const prereq = tasks.find(pt => pt.id === dep.target_entity_id);
            if (prereq && prereq.status !== 'COMPLETED') {
              if (!blockersCount.has(prereq.id)) blockersCount.set(prereq.id, { prereq, dependents: [] });
              blockersCount.get(prereq.id).dependents.push(t.id);
            }
          }
        }
        for (const { prereq, dependents } of blockersCount.values()) {
          if (dependents.length >= 2 || prereq.status === 'BLOCKED' || (prereq.due_date && prereq.due_date <= today)) {
            recordedObservations.push(upsertCandidateObservation({
              observation_type: 'DEPENDENCY_BOTTLENECK',
              related_entity_type: 'task',
              related_entity_id: prereq.id,
              description: `La tarea '${prereq.title}' (${prereq.status}) condiciona el avance de ${dependents.length} tarea(s) dependiente(s).`,
              evidence_references: [prereq.id, ...dependents],
              confidence: 0.85,
            }));
          }
        }

        // 6. Insumos en umbral de reposición o agotamiento
        const repAlerts = replenishmentService ? replenishmentService.getReplenishmentStatus({ onlyAlerts: true }) : [];
        for (const rep of repAlerts) {
          recordedObservations.push(upsertCandidateObservation({
            observation_type: 'DEPLETING_RESOURCE',
            related_entity_type: 'product',
            related_entity_id: rep.product_id,
            description: `El recurso '${rep.product_name ?? rep.product_id}' está en estado ${rep.cycle_status} (disponible: ${rep.current_quantity} ${rep.unit ?? ''}, mínimo: ${rep.minimum_quantity}).`,
            evidence_references: [rep.product_id],
            confidence: 0.9,
          }));
        }

        return recordedObservations;
      });
    },

    generateAdaptationSuggestions() {
      return inTx(() => {
        const candidates = adaptationRepository.listObservations({ status: 'CANDIDATE' });
        const suggestions = [];

        for (const obs of candidates) {
          // Deduplicación: reutilizar sugerencia activa (PROPOSED o ACCEPTED) para la misma observación
          const existingSug = adaptationRepository.findActiveSuggestionForObservation(obs.id);
          if (existingSug) {
            suggestions.push(existingSug);
            continue;
          }

          let suggestion_type = 'REVIEW_CONTEXT_OBSTACLE';
          let proposed_change = {
            entity_type: obs.related_entity_type,
            entity_id: obs.related_entity_id,
            action: 'MANUAL_REVIEW',
            requires_user_authorization: true,
          };
          let proposedDesc = 'Revisar factores de contexto y decidir ajuste manual.';

          if (obs.observation_type === 'DURATION_DEVIATION' && taskService && obs.related_entity_id) {
            const est = this.calculateDurationEstimates(obs.related_entity_id);
            suggestion_type = 'ADJUST_ESTIMATED_DURATION';
            proposed_change = {
              entity_type: 'task',
              entity_id: obs.related_entity_id,
              field: 'estimated_duration_minutes',
              previous_value: est.original_estimate,
              suggested_value: est.suggested_minutes,
              requires_user_authorization: true,
            };
            proposedDesc = `Actualizar estimated_duration_minutes de ${est.original_estimate} min a ${est.suggested_minutes} min conservando historial.`;
          } else if (obs.observation_type === 'HABIT_IRREGULAR_COMPLIANCE' && habitService && obs.related_entity_id) {
            const habit = habitService.getHabit(obs.related_entity_id);
            const nextFreq = buildSuggestedHabitFrequency(habit);
            suggestion_type = 'ADJUST_HABIT_FREQUENCY';
            proposed_change = {
              entity_type: 'habit',
              entity_id: obs.related_entity_id,
              field: 'frequency',
              previous_value: habit.frequency,
              suggested_value: nextFreq,
              effective_from: todayDate(),
              requires_user_authorization: true,
            };
            proposedDesc = `Ajustar frecuencia futura del hábito desde ${todayDate()} a ${JSON.stringify(nextFreq)} sin modificar ocurrencias pasadas.`;
          } else if (obs.observation_type === 'DEPENDENCY_BOTTLENECK' && obs.related_entity_id) {
            suggestion_type = 'PRIORITIZE_BOTTLENECK_TASK';
            proposed_change = {
              entity_type: 'task',
              entity_id: obs.related_entity_id,
              field: 'priority_id',
              suggested_value: 'prio_critical',
              requires_user_authorization: true,
            };
            proposedDesc = 'Elevar prioridad de la tarea cuello de botella a CRITICAL para desbloquear tareas dependientes.';
          } else if (obs.observation_type === 'STALLED_PROJECT') {
            suggestion_type = 'REVIEW_STALLED_PROJECT';
          } else if (obs.observation_type === 'DEPLETING_RESOURCE') {
            suggestion_type = 'EVALUATE_REPLENISHMENT';
          }

          const sug = adaptationRepository.insertSuggestion({
            id: randomUUID(),
            observation_id: obs.id,
            suggestion_type,
            proposed_change,
            explanation: {
              information_used: obs.evidence_references,
              pattern_detected: obs.observation_type,
              provisional_conclusion: obs.description,
              proposed_change: proposedDesc,
              expected_benefit: 'Mejorar viabilidad operativa sin reducir silenciosamente objetivos estratégicos (PLN-018).',
              uncertainty: `Confianza estimada: ${obs.confidence ?? 'desconocida'}. Correlación observada no implica causalidad confirmada.`,
            },
            created_at: nowIso(),
            status: 'PROPOSED',
          });
          suggestions.push(sug);
        }

        return suggestions;
      });
    },

    respondToSuggestion(suggestionId, { decision, authorizedBy = null, authorized_by = null } = {}) {
      const authorizer = authorizedBy ?? authorized_by;
      const sug = adaptationRepository.findSuggestionById(suggestionId);
      if (!sug) throw new NexusError(ERROR_CODES.NOT_FOUND, `Sugerencia no encontrada: ${suggestionId}`);
      if (sug.status === 'APPLIED') {
        throw new NexusError(ERROR_CODES.CONFLICT, 'La sugerencia ya fue aplicada previamente.');
      }

      return inTx(() => {
        if (decision === 'REJECT') {
          adaptationRepository.updateSuggestionStatus(suggestionId, 'REJECTED');
          adaptationRepository.updateObservationStatus(sug.observation_id, 'REJECTED');
          auditService?.recordChange({
            entity_type: 'adaptation_suggestion',
            entity_id: suggestionId,
            operation_type: 'adaptation.suggestion_reject',
            previous_state: { status: sug.status },
            new_state: { status: 'REJECTED' },
            source_id: authorizer ?? 'USER',
          });
          return { id: suggestionId, status: 'REJECTED' };
        }
        if (decision === 'ACCEPT') {
          if (!authorizer) {
            throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'PLN-011: Aceptar una sugerencia de adaptación requiere identificar al usuario (authorizedBy).');
          }
          // DP-03: respondToSuggestion(ACCEPT) únicamente registra la aceptación; NO ejecuta el cambio automáticamente
          adaptationRepository.updateSuggestionStatus(suggestionId, 'ACCEPTED');
          adaptationRepository.updateObservationStatus(sug.observation_id, 'CONFIRMED');
          auditService?.recordChange({
            entity_type: 'adaptation_suggestion',
            entity_id: suggestionId,
            operation_type: 'adaptation.suggestion_accept',
            previous_state: { status: sug.status },
            new_state: { status: 'ACCEPTED' },
            source_id: authorizer,
          });
          return {
            id: suggestionId,
            status: 'ACCEPTED',
            authorized_by: authorizer,
            applied: false,
            next_step: 'Invoca applySuggestion(id, { authorizedBy }) para ejecutar el cambio mediante el servicio propietario.',
          };
        }
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'decision debe ser ACCEPT o REJECT.');
      });
    },

    applySuggestion(suggestionId, { authorizedBy = null, authorized_by = null } = {}) {
      const authorizer = authorizedBy ?? authorized_by;
      if (!authorizer) {
        throw new NexusError(
          ERROR_CODES.PERMISSION_DENIED,
          'DP-03 / PLN-011: Ejecutar una sugerencia adaptativa requiere autorización explícita verificable (authorizedBy).'
        );
      }
      const sug = adaptationRepository.findSuggestionById(suggestionId);
      if (!sug) throw new NexusError(ERROR_CODES.NOT_FOUND, `Sugerencia no encontrada: ${suggestionId}`);
      if (sug.status !== 'ACCEPTED') {
        throw new NexusError(
          ERROR_CODES.CONFLICT,
          `DP-03: Solo puede aplicarse una sugerencia previamente en estado ACCEPTED (estado actual: ${sug.status}).`,
          { remediation: 'Acepta primero la sugerencia mediante respondToSuggestion(id, { decision: "ACCEPT", authorizedBy }).' }
        );
      }

      return inTx(() => {
        const change = sug.proposed_change ?? {};
        let appliedResult = null;

        if (sug.suggestion_type === 'ADJUST_ESTIMATED_DURATION') {
          if (!taskService || !change.entity_id || !Number.isInteger(Number(change.suggested_value))) {
            throw new NexusError(ERROR_CODES.OPERATION_FAILED, 'No se dispone de TaskService o duración válida para aplicar la sugerencia.');
          }
          appliedResult = taskService.updateTask(change.entity_id, {
            estimated_duration_minutes: Number(change.suggested_value),
          });
        } else if (sug.suggestion_type === 'ADJUST_HABIT_FREQUENCY') {
          if (!habitService || !change.entity_id || !change.suggested_value) {
            throw new NexusError(ERROR_CODES.OPERATION_FAILED, 'No se dispone de HabitService o frecuencia válida para aplicar la sugerencia.');
          }
          appliedResult = habitService.updateHabitFrequency(change.entity_id, {
            frequency: change.suggested_value,
            effective_from: change.effective_from ?? todayDate(),
            reason: `Aplicación autorizada de sugerencia adaptativa ${suggestionId}`,
            authorized_by: authorizer,
          });
        } else if (sug.suggestion_type === 'PRIORITIZE_BOTTLENECK_TASK') {
          if (!taskService || !change.entity_id) {
            throw new NexusError(ERROR_CODES.OPERATION_FAILED, 'No se dispone de TaskService para priorizar la tarea cuello de botella.');
          }
          appliedResult = taskService.updateTask(change.entity_id, {
            priority_id: change.suggested_value ?? 'prio_critical',
          });
        } else {
          appliedResult = { acknowledged_review: true, entity_type: change.entity_type, entity_id: change.entity_id };
        }

        // DP-03: Marca APPLIED únicamente después de completar satisfactoriamente la operación en el servicio propietario
        adaptationRepository.updateSuggestionStatus(suggestionId, 'APPLIED');
        auditService?.recordChange({
          entity_type: 'adaptation_suggestion',
          entity_id: suggestionId,
          operation_type: 'adaptation.suggestion_apply',
          previous_state: { status: 'ACCEPTED' },
          new_state: { status: 'APPLIED', suggestion_type: sug.suggestion_type },
          source_id: authorizer,
        });

        return {
          id: suggestionId,
          status: 'APPLIED',
          suggestion_type: sug.suggestion_type,
          authorized_by: authorizer,
          applied_result: appliedResult,
        };
      });
    },

    comparePlanningResults(planId) {
      if (!planningService) return null;
      const plan = planningService.getPlan(planId);
      const execs = executionService ? executionService.listExecutions({ from: plan.period_start, to: plan.period_end }) : [];
      return {
        plan_id: planId,
        planned_items_count: plan.current_items.length,
        recorded_executions_count: execs.length,
        note: 'La comparación distingue lo planeado de lo ejecutado sin modificar retrospectivamente el plan (PLN-006).',
      };
    },
  };
}

export function createProactivityService({ adaptationRepository, calendarService = null, taskService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));
  const severityOrder = Object.fromEntries(INTERVENTION_CLASSIFICATIONS.map((c, i) => [c, i]));

  return {
    configureProactivity({ enabled, max_daily_interactions, minimum_classification } = {}) {
      const current = adaptationRepository.getProactivityConfig();
      if (minimum_classification && !INTERVENTION_CLASSIFICATIONS.includes(minimum_classification)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Clasificación inválida: ${minimum_classification}`);
      }
      return adaptationRepository.saveProactivityConfig({
        enabled: enabled !== undefined ? Boolean(enabled) : current.enabled,
        max_daily_interactions: max_daily_interactions !== undefined ? Number(max_daily_interactions) : current.max_daily_interactions,
        minimum_classification: minimum_classification ?? current.minimum_classification,
        updated_at: nowIso(),
      });
    },

    classifyIntervention({ type, urgent = false }) {
      if (urgent) return 'URGENT';
      if (type === 'EVENT_CONFLICT') return 'CONFLICT';
      if (type === 'DEADLINE_APPROACHING') return 'WARNING';
      if (type === 'PENDING_APPROVAL') return 'PENDING_DECISION';
      if (type === 'ADAPTATION_SUGGESTION') return 'RECOMMENDATION';
      return 'INFO';
    },

    generateNotificationCandidate({ dedup_key, type, title, message, suggested_action = null, evidence = {}, urgent = false }) {
      return {
        dedup_key,
        classification: this.classifyIntervention({ type, urgent }),
        title,
        message,
        suggested_action,
        evidence,
      };
    },

    registerIntervention(candidate) {
      const cfg = adaptationRepository.getProactivityConfig();
      if (!cfg.enabled && candidate.classification !== 'URGENT') {
        return { registered: false, reason: 'PROACTIVITY_DISABLED' };
      }
      if (severityOrder[candidate.classification] < severityOrder[cfg.minimum_classification]) {
        return { registered: false, reason: 'BELOW_MINIMUM_CLASSIFICATION' };
      }
      // Deduplicación: no repetir advertencia sin cambio relevante (NL-MASTER-04 §47)
      const existing = adaptationRepository.findActiveInterventionByDedupKey(candidate.dedup_key);
      if (existing) {
        return { registered: false, reason: 'DUPLICATE_ACTIVE', existing_id: existing.id };
      }
      const todayCount = adaptationRepository.listInterventions({ datePrefix: todayDate() }).length;
      if (todayCount >= cfg.max_daily_interactions && candidate.classification !== 'URGENT') {
        return { registered: false, reason: 'DAILY_LIMIT_REACHED' };
      }
      const now = nowIso();
      const saved = adaptationRepository.insertIntervention({
        id: randomUUID(),
        dedup_key: candidate.dedup_key,
        classification: candidate.classification,
        title: candidate.title,
        message: candidate.message,
        suggested_action: candidate.suggested_action,
        evidence: candidate.evidence ?? {},
        status: 'PENDING',
        created_at: now,
        updated_at: now,
      });
      return { registered: true, intervention: saved };
    },

    evaluateInterventionConditions() {
      const registered = [];
      if (calendarService) {
        const conflicts = calendarService.detectEventConflicts({});
        for (const c of conflicts) {
          const cand = this.generateNotificationCandidate({
            dedup_key: `event_conflict:${[c.first.id, c.second.id].sort().join(':')}`,
            type: 'EVENT_CONFLICT',
            title: 'Conflicto entre eventos',
            message: `Solapamiento entre '${c.first.title}' y '${c.second.title}'.`,
            suggested_action: 'Revisa ambos eventos y decide cuál reprogramar.',
            evidence: { first_id: c.first.id, second_id: c.second.id },
          });
          const res = this.registerIntervention(cand);
          if (res.registered) registered.push(res.intervention);
        }
      }
      if (taskService) {
        const today = todayDate();
        const dueTasks = taskService.listTasks({ status: 'PENDING' }).filter(t => t.due_date && t.due_date <= today);
        for (const t of dueTasks) {
          const cand = this.generateNotificationCandidate({
            dedup_key: `task_due:${t.id}:${t.due_date}`,
            type: 'DEADLINE_APPROACHING',
            title: 'Tarea próxima o vencida',
            message: `La tarea '${t.title}' tiene fecha límite ${t.due_date}.`,
            suggested_action: 'Evalúa priorizarla o replanificarla.',
            evidence: { task_id: t.id, due_date: t.due_date },
          });
          const res = this.registerIntervention(cand);
          if (res.registered) registered.push(res.intervention);
        }
      }
      return registered;
    },

    dismissIntervention(id) {
      adaptationRepository.updateInterventionStatus(id, 'DISMISSED', nowIso());
      return { id, status: 'DISMISSED' };
    },

    listInterventions(filters = {}) {
      return adaptationRepository.listInterventions(filters);
    },
  };
}
