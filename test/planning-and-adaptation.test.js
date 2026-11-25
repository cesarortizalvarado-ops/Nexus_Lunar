import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-b05-test-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('B05.1 — Escenario integral realista del Motor Determinista: objetivos, proyectos, dependencias, compromisos, disponibilidad, hábitos, rutinas, recursos, aprobación, replanificación con diff y cierre diario (sin IA)', () => {
  const dirs = makeTempDirs();
  // Sábado 2026-11-21 20:00 America/Mexico_City (2026-11-22T02:00:00Z): momento típico de preagenda semanal
  const fixedNow = new Date('2026-11-22T02:00:00.000Z');
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => fixedNow,
  });

  try {
    // 1. Objetivo estratégico y proyectos (uno ACTIVE, uno PAUSED)
    const goal = core.goalService.createGoal({
      name: 'Lanzamiento Plataforma Local v1',
      priority_id: 'prio_critical',
      target_date: '2026-11-30',
    });
    const activeProject = core.projectService.createProject({
      name: 'Núcleo Determinista',
      priority_id: 'prio_high',
      status: 'ACTIVE',
      target_date: '2026-11-27',
    });
    core.goalService.relateProject(goal.id, activeProject.id);

    const pausedProject = core.projectService.createProject({
      name: 'Migración Experimental Pausada',
      status: 'PAUSED',
    });

    // 2. Tareas con grafo de dependencias (taskB depende de taskA) + tarea de proyecto pausado + tarea con restricción de inventario
    const taskA = core.taskService.createTask({
      project_id: activeProject.id,
      title: 'Diseñar esquema de validación',
      priority_id: 'prio_medium',
      urgency: 2,
      estimated_duration_minutes: 60,
      due_date: '2026-11-25',
    });
    const taskB = core.taskService.createTask({
      project_id: activeProject.id,
      title: 'Implementar validador sobre esquema',
      priority_id: 'prio_critical',
      urgency: 4,
      estimated_duration_minutes: 45,
      due_date: '2026-11-25',
    });
    // Aunque taskB tiene mayor urgencia/prioridad nominal que taskA, depende de taskA -> NUNCA puede programarse antes que taskA
    core.taskService.addDependency(taskB.id, taskA.id);

    const taskPaused = core.taskService.createTask({
      project_id: pausedProject.id,
      title: 'Tarea en proyecto pausado',
      priority_id: 'prio_critical',
      estimated_duration_minutes: 30,
    });

    const filament = core.productService.createProduct({
      name: 'Filamento PETG Técnico',
      unit: 'kg',
      minimum_quantity: 2,
    });
    core.inventoryService.registerInventory({ product_id: filament.id, quantity: 0.5, unit: 'kg' }); // Bajo mínimo -> NEEDS_REPLENISHMENT

    const taskNeedsMaterial = core.taskService.createTask({
      project_id: activeProject.id,
      title: 'Imprimir carcasa de nodo local',
      priority_id: 'prio_high',
      estimated_duration_minutes: 60,
    });
    core.relationService.createRelation({
      source_entity_type: 'task',
      source_entity_id: taskNeedsMaterial.id,
      target_entity_type: 'product',
      target_entity_id: filament.id,
      relation_type: 'REQUIRES',
    });

    // 3. Compromiso vinculado a la tarea retenida por material -> generará COMMITMENT_AT_RISK
    core.commitmentService.createCommitment({
      title: 'Entregar prototipo físico',
      due_at: '2026-11-24T23:00:00.000Z',
      status: 'CONFIRMED',
      related_entity_type: 'task',
      related_entity_id: taskNeedsMaterial.id,
    });

    // 4. Finanzas sanas (cuenta con saldo positivo)
    const acc = core.financialAccountService.createAccount({ name: 'Operativa', currency: 'MXN' });
    core.financialTransactionService.recordIncome({ account_id: acc.id, amount: 5000, category: 'ingresos' });

    // 5. Hábito con ventana preferida matutina (07:30-08:30 local) y Rutina diaria vespertina (11:00-12:00 local)
    const habit = core.habitService.createHabit({
      name: 'Ejercicio de movilidad',
      frequency: { type: 'DAILY' },
      preferred_time_window: { start: '07:30', end: '08:30' },
      start_date: '2026-11-20',
    });
    const routine = core.routineService.createRoutine({
      name: 'Revisión operativa diaria',
      frequency: { type: 'DAILY' },
      expected_duration_minutes: 25,
      preferred_time_window: { start: '11:00', end: '12:00' },
      steps: [
        { name: 'Revisar alertas del sistema', estimated_duration_minutes: 10, required: true },
        { name: 'Registrar bitácora', estimated_duration_minutes: 15, required: true },
      ],
    });

    // 6. Ventanas de disponibilidad confirmadas para lunes 23 y martes 24 de noviembre (07:00 a 13:00 hora Ciudad de México = 13:00Z a 19:00Z)
    // Más un evento fijo confirmado lunes 09:00-10:00 local (15:00Z-16:00Z)
    core.availabilityService.createAvailabilityWindow({
      start_at: '2026-11-23T13:00:00.000Z',
      end_at: '2026-11-23T19:00:00.000Z',
      availability_type: 'CONFIRMED',
    });
    core.availabilityService.createAvailabilityWindow({
      start_at: '2026-11-24T13:00:00.000Z',
      end_at: '2026-11-24T19:00:00.000Z',
      availability_type: 'CONFIRMED',
    });
    core.calendarService.createEvent({
      title: 'Consulta médica confirmada',
      start_at: '2026-11-23T15:00:00.000Z',
      end_at: '2026-11-23T16:00:00.000Z',
      timezone: 'America/Mexico_City',
      status: 'CONFIRMED',
    });

    // 7. Verificar reproducibilidad 100% determinista
    const inputsSnap = core.planningInputService.collectPlanningInputs({
      period_start: '2026-11-23T06:00:00.000Z',
      period_end: '2026-11-25T05:59:59.999Z',
    });
    const run1 = core.planningEngine.generateProposal(inputsSnap);
    const run2 = core.planningEngine.generateProposal(inputsSnap);
    assert.deepEqual(run1, run2, 'Mismas entradas deben producir exactamente la misma propuesta determinista');

    // 8. Generar preagenda oficial de 2 días vía AgendaService
    const { plan, proposal } = core.agendaService.generateWeeklyAgenda({
      name: 'Preagenda 23-24 Nov',
      week_start: '2026-11-23',
      week_end: '2026-11-24',
    });
    assert.equal(proposal.reliable, true);

    const plannedItems = proposal.proposed_items.filter(i => i.status === 'PLANNED' && i.related_entity_type !== 'buffer');
    const bufferItems = proposal.proposed_items.filter(i => i.related_entity_type === 'buffer');
    const deferredItems = proposal.proposed_items.filter(i => i.status === 'DEFERRED');

    assert.ok(bufferItems.length >= 2, 'Debe reservar bloques explícitos de margen BUFFER');

    // Verificar que taskA se programa estrictamente antes de que inicie taskB
    const itemA = plannedItems.find(i => i.related_entity_id === taskA.id);
    const itemB = plannedItems.find(i => i.related_entity_id === taskB.id);
    assert.ok(itemA && itemB, 'Ambas tareas elegibles deben programarse');
    assert.ok(itemA.planned_end <= itemB.planned_start, `Orden topológico y cronológico violado: A termina ${itemA.planned_end}, B inicia ${itemB.planned_start}`);
    assert.ok(itemA.explanation.includes(goal.name), 'La explicación incluye la contribución al objetivo activo');

    // Verificar rutina diaria programada en AMBOS días (23 y 24) dentro de su ventana preferida (11:00 local = 17:00Z)
    const routineItems = plannedItems.filter(i => i.related_entity_type === 'routine' && i.related_entity_id === routine.id);
    assert.equal(routineItems.length, 2, 'La rutina diaria debe programarse en los 2 días del horizonte');
    assert.equal(routineItems[0].planned_start, '2026-11-23T17:00:00.000Z');
    assert.equal(routineItems[1].planned_start, '2026-11-24T17:00:00.000Z');

    // Verificar hábito ubicado dentro de su ventana preferida matutina (07:30-08:30 local = 13:30Z-14:30Z) sin duplicarse como tarea
    const habitItems = plannedItems.filter(i => i.related_entity_type === 'habit' && i.related_entity_id === habit.id);
    assert.equal(habitItems.length, 2);
    assert.ok(habitItems[0].planned_start >= '2026-11-23T13:30:00.000Z' && habitItems[0].planned_end <= '2026-11-23T14:30:00.000Z');
    assert.equal(habitItems[1].planned_start, '2026-11-24T13:30:00.000Z');
    assert.equal(core.taskService.listTasks().some(t => t.title.includes(habit.name)), false, 'PLN-008: hábito nunca se convierte en tarea');

    // Verificar exclusión de proyecto PAUSED y retención por falta de recurso con conflictos trazables
    assert.ok(deferredItems.some(d => d.related_entity_id === taskPaused.id));
    assert.ok(deferredItems.some(d => d.related_entity_id === taskNeedsMaterial.id));
    const conflictTypes = new Set(proposal.conflicts.map(c => c.conflict_type));
    assert.ok(conflictTypes.has('PROJECT_PAUSED_OR_BLOCKED'));
    assert.ok(conflictTypes.has('INSUFFICIENT_RESOURCE'));
    assert.ok(conflictTypes.has('COMMITMENT_AT_RISK'));

    // 9. Aprobar propuesta -> crea versión v1 APPROVED (inmutable)
    const v1 = core.planningProposalService.acceptProposal(proposal.id, { authorizedBy: 'dante' });
    assert.equal(v1.version_number, 1);
    assert.equal(v1.approval_status, 'APPROVED');

    // Intentar mutar un ítem de la versión aprobada v1 debe fallar (INV-014)
    assert.throws(
      () => core.agendaService.rescheduleAgendaItem(v1.items[0].id, {
        planned_start: '2026-11-23T18:00:00.000Z',
        planned_end: '2026-11-23T18:30:00.000Z',
      }),
      err => err.code === 'CONFLICT'
    );

    // 10. Cambio de contexto: llega reposición de Filamento PETG -> replanificamos a v2 y verificamos version_diff
    core.inventoryService.adjustInventory({
      product_id: filament.id,
      delta: 5,
      cause: 'Recepción de lote PETG',
    });
    core.replenishmentService.calculateReplenishmentNeed(filament.id);

    const replanProposal = core.agendaService.replanAgenda(plan.id);
    assert.ok(replanProposal.explanation.replan_diff, 'La propuesta de replanificación incluye replan_diff explicable');
    assert.equal(replanProposal.explanation.replan_diff.newly_scheduled.length, 1);
    assert.equal(replanProposal.explanation.replan_diff.newly_scheduled[0].title, 'Imprimir carcasa de nodo local');

    const v2 = core.planningProposalService.acceptProposal(replanProposal.id, {
      authorizedBy: 'dante',
      change_summary: 'Incorporar impresión tras recibir PETG',
    });
    assert.equal(v2.version_number, 2);
    assert.equal(v2.approval_status, 'APPROVED');
    assert.equal(v2.version_diff.newly_scheduled.length, 1);

    const history = core.planningService.getPlanHistory(plan.id);
    assert.equal(history.length, 2);
    assert.equal(history.find(h => h.version_number === 1).approval_status, 'SUPERSEDED');

    // 11. Ejecución real del lunes 2026-11-23 y Cierre Diario en zona local
    const execA = core.executionService.startExecution({
      related_entity_type: 'task',
      related_entity_id: taskA.id,
      started_at: '2026-11-23T14:00:00.000Z',
    });
    const sessA = core.workSessionService.startSession({ execution_id: execA.id, started_at: '2026-11-23T14:00:00.000Z' });
    core.workSessionService.endSession(sessA.id, { ended_at: '2026-11-23T14:55:00.000Z' });
    core.executionService.completeExecution(execA.id);

    const rExec = core.routineService.startRoutineExecution(routine.id, { scheduled_date: '2026-11-23' });
    for (const st of rExec.step_executions) {
      core.routineService.updateRoutineStepExecution(rExec.id, st.id, { status: 'COMPLETED' });
    }
    core.routineService.completeRoutineExecution(rExec.id);

    // No registramos ocurrencia del hábito el 2026-11-23 -> debe permanecer UNKNOWN en el cierre diario (PLN-010)
    const review = core.dailyReviewService.generateDailyReview('2026-11-23');
    const compA = review.executed_summary.item_comparisons.find(c => c.entity_id === taskA.id);
    const compHabit = review.executed_summary.item_comparisons.find(c => c.entity_type === 'habit' && c.entity_id === habit.id);
    assert.equal(compA.evaluation, 'EXECUTED_AS_PLANNED');
    assert.equal(compHabit.actual_status, 'UNKNOWN');
    assert.ok(review.missing_results.some(m => m.entity_type === 'habit' && m.entity_id === habit.id && m.status === 'UNKNOWN'));

    const closed = core.dailyReviewService.closeDay('2026-11-23', { summary_text: 'Jornada productiva cerrada.' });
    assert.equal(closed.status, 'CLOSED');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('B05.2 (DP-03) — Análisis adaptativo sin duplicados y separación estricta CANDIDATE -> PROPOSED -> ACCEPTED -> APPLIED', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-24T18:00:00.000Z'),
  });

  try {
    // 1. Tarea con estimación de 30 min pero 2 ejecuciones reales de 75 y 85 min (promedio 80 min)
    const task = core.taskService.createTask({
      title: 'Compilar informe mensual',
      estimated_duration_minutes: 30,
    });
    for (const [start, end] of [
      ['2026-11-20T15:00:00.000Z', '2026-11-20T16:15:00.000Z'],
      ['2026-11-22T15:00:00.000Z', '2026-11-22T16:25:00.000Z'],
    ]) {
      const ex = core.executionService.startExecution({ related_entity_type: 'task', related_entity_id: task.id, started_at: start });
      const s = core.workSessionService.startSession({ execution_id: ex.id, started_at: start });
      core.workSessionService.endSession(s.id, { ended_at: end });
      core.executionService.completeExecution(ex.id);
    }

    // 2. Obstáculo recurrente y proyecto estancado
    core.observationService.createObservation({ related_entity_type: 'task', related_entity_id: task.id, content: 'Interrupción por ruido externo' });
    core.observationService.createObservation({ related_entity_type: 'task', related_entity_id: task.id, content: 'Interrupción por ruido externo' });

    const stalledProj = core.projectService.createProject({ name: 'Proyecto Detenido', status: 'ACTIVE' });
    core.taskService.createTask({ project_id: stalledProj.id, title: 'Tarea bloqueada', status: 'BLOCKED' });

    // 3. Ejecutar identifyPatterns dos veces seguidas -> deduplicación estricta (cero duplicados CANDIDATE)
    const firstPass = core.adaptiveAnalysisService.identifyPatterns();
    const secondPass = core.adaptiveAnalysisService.identifyPatterns();
    assert.equal(firstPass.length, secondPass.length);
    assert.equal(core.adaptiveAnalysisService.listObservations().length, firstPass.length);

    const obsTypes = new Set(firstPass.map(o => o.observation_type));
    assert.ok(obsTypes.has('DURATION_DEVIATION'));
    assert.ok(obsTypes.has('RECURRING_OBSTACLE'));
    assert.ok(obsTypes.has('STALLED_PROJECT'));

    // 4. Generar sugerencias dos veces -> deduplicación estricta
    const sugs1 = core.adaptiveAnalysisService.generateAdaptationSuggestions();
    const sugs2 = core.adaptiveAnalysisService.generateAdaptationSuggestions();
    assert.equal(sugs1.length, sugs2.length);

    const durSug = sugs1.find(s => s.suggestion_type === 'ADJUST_ESTIMATED_DURATION');
    assert.ok(durSug);
    assert.equal(durSug.status, 'PROPOSED');
    assert.equal(durSug.proposed_change.suggested_value, 80);

    // 5. Intentar applySuggestion antes de aceptar debe fallar (DP-03)
    assert.throws(
      () => core.adaptiveAnalysisService.applySuggestion(durSug.id, { authorizedBy: 'dante' }),
      err => err.code === 'CONFLICT'
    );

    // 6. Aceptar sugerencia: pasa a ACCEPTED, pero NO modifica todavía la tarea (DP-03)
    const acceptRes = core.adaptiveAnalysisService.respondToSuggestion(durSug.id, {
      decision: 'ACCEPT',
      authorizedBy: 'dante',
    });
    assert.equal(acceptRes.status, 'ACCEPTED');
    assert.equal(acceptRes.applied, false);
    assert.equal(core.taskService.getTask(task.id).estimated_duration_minutes, 30, 'Aceptar NO debe mutar automáticamente la tarea');

    // 7. Aplicar sugerencia con autorización explícita vía OperationDispatcher -> ejecuta cambio en TaskService y pasa a APPLIED
    const applyOp = core.executeOperation({
      operation_type: 'adaptation.applySuggestion',
      payload: { id: durSug.id },
      authorization: { approved: true, authorized_by: 'dante', scope: 'adaptation.applySuggestion' },
    });
    assert.equal(applyOp.success, true);
    assert.equal(applyOp.result.status, 'APPLIED');
    assert.equal(core.taskService.getTask(task.id).estimated_duration_minutes, 80, 'Ahora sí se aplicó la nueva estimación vía TaskService');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});
