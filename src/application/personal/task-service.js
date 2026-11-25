import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { TASK_TRANSITIONS, assertTransition, validateTaskInput } from '../../domain/personal/personal-validators.js';
import { wouldCreateCycle } from '../../domain/shared/domain-relation.js';

export function createTaskService({ personalRepository, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function ensureProjectValid(projectId) {
    if (projectId == null) return;
    const p = personalRepository.findProjectById(projectId);
    if (!p || p.status === 'ARCHIVED') {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'El proyecto indicado no existe o está archivado.', { field: 'project_id' });
    }
  }

  return {
    createTask(input) {
      validateTaskInput(input, false);
      ensureProjectValid(input.project_id ?? null);
      const now = nowIso();
      const task = {
        id: randomUUID(),
        project_id: input.project_id ?? null,
        title: input.title.trim(),
        description: (input.description ?? '').trim(),
        priority_id: input.priority_id ?? 'prio_medium',
        urgency: input.urgency !== undefined ? Number(input.urgency) : 2,
        status: input.status ?? 'PENDING',
        estimated_duration_minutes: input.estimated_duration_minutes ?? null,
        actual_duration_minutes: null,
        due_date: input.due_date ?? null,
        planned_start: input.planned_start ?? null,
        planned_end: input.planned_end ?? null,
        completed_at: null,
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      personalRepository.insertTask(task);
      auditService?.recordChange({ entity_type: 'task', entity_id: task.id, operation_type: 'task.create', new_state: task });
      return task;
    },

    getTask(id) {
      const t = personalRepository.findTaskById(id);
      if (!t) throw new NexusError(ERROR_CODES.NOT_FOUND, `Tarea no encontrada: ${id}`, { entity: 'Task' });
      return {
        ...t,
        dependencies: personalRepository.listDependenciesOf('task', id),
      };
    },

    listTasks(filters = {}) {
      return personalRepository.listTasks(filters);
    },

    updateTask(id, patch) {
      const current = personalRepository.findTaskById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Tarea no encontrada: ${id}`, { entity: 'Task' });
      validateTaskInput(patch, true);
      if (patch.project_id !== undefined) ensureProjectValid(patch.project_id);
      if (patch.status !== undefined) assertTransition(TASK_TRANSITIONS, current.status, patch.status, 'Task');

      const now = nowIso();
      const nextStatus = patch.status ?? current.status;
      const updated = {
        ...current,
        project_id: patch.project_id !== undefined ? patch.project_id : current.project_id,
        title: patch.title !== undefined ? patch.title.trim() : current.title,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        priority_id: patch.priority_id !== undefined ? patch.priority_id : current.priority_id,
        urgency: patch.urgency !== undefined ? Number(patch.urgency) : current.urgency,
        status: nextStatus,
        estimated_duration_minutes: patch.estimated_duration_minutes !== undefined ? patch.estimated_duration_minutes : current.estimated_duration_minutes,
        actual_duration_minutes: patch.actual_duration_minutes !== undefined ? patch.actual_duration_minutes : current.actual_duration_minutes,
        due_date: patch.due_date !== undefined ? patch.due_date : current.due_date,
        planned_start: patch.planned_start !== undefined ? patch.planned_start : current.planned_start,
        planned_end: patch.planned_end !== undefined ? patch.planned_end : current.planned_end,
        completed_at: nextStatus === 'COMPLETED' ? (current.completed_at ?? now) : current.completed_at,
        updated_at: now,
        archived_at: nextStatus === 'ARCHIVED' ? (current.archived_at ?? now) : current.archived_at,
      };
      personalRepository.updateTask(updated);
      auditService?.recordChange({ entity_type: 'task', entity_id: id, operation_type: 'task.update', previous_state: current, new_state: updated });
      return updated;
    },

    changeTaskStatus(id, status) {
      return this.updateTask(id, { status });
    },

    addDependency(taskId, targetTaskId, { dependency_type = 'REQUIRES', condition = null } = {}) {
      if (!personalRepository.findTaskById(taskId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Tarea origen no encontrada: ${taskId}`);
      if (!personalRepository.findTaskById(targetTaskId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Tarea destino no encontrada: ${targetTaskId}`);
      if (taskId === targetTaskId) {
        throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'Una tarea no puede depender de sí misma.');
      }

      const existing = personalRepository.listAllDependencies('task');
      const edges = existing.map(d => [d.origin_entity_id, d.target_entity_id]);
      if (wouldCreateCycle(edges, taskId, targetTaskId)) {
        throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `Dependencia circular detectada entre tareas ${taskId} y ${targetTaskId}.`, {
          entity: 'Dependency',
          remediation: 'Revisa el orden de dependencias para mantener un grafo acíclico.',
        });
      }

      const dep = {
        id: randomUUID(),
        origin_entity_type: 'task',
        origin_entity_id: taskId,
        target_entity_type: 'task',
        target_entity_id: targetTaskId,
        dependency_type,
        condition,
        created_at: nowIso(),
      };
      return personalRepository.insertDependency(dep);
    },

    removeDependency(taskId, targetTaskId) {
      const removed = personalRepository.deleteDependency('task', taskId, 'task', targetTaskId);
      if (removed === 0) throw new NexusError(ERROR_CODES.NOT_FOUND, 'Dependencia no encontrada.');
      return { task_id: taskId, target_task_id: targetTaskId, removed: true };
    },

    getTaskDependencies(taskId) {
      if (!personalRepository.findTaskById(taskId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Tarea no encontrada: ${taskId}`);
      return personalRepository.listDependenciesOf('task', taskId);
    },

    getTaskHistory(taskId) {
      if (!personalRepository.findTaskById(taskId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Tarea no encontrada: ${taskId}`);
      return auditService ? auditService.getEntityHistory('task', taskId) : [];
    },

    archiveTask(id) {
      return this.changeTaskStatus(id, 'ARCHIVED');
    },
  };
}
