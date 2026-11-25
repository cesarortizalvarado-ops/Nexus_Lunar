import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { PROJECT_TRANSITIONS, assertTransition, validateProjectInput } from '../../domain/personal/personal-validators.js';

export function createProjectService({ personalRepository, taskService = null, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createProject(input) {
      validateProjectInput(input, false);
      const now = nowIso();
      const project = {
        id: randomUUID(),
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        purpose: (input.purpose ?? '').trim(),
        priority_id: input.priority_id ?? 'prio_medium',
        status: input.status ?? 'PLANNING',
        start_date: input.start_date ?? null,
        target_date: input.target_date ?? null,
        completed_at: null,
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      personalRepository.insertProject(project);
      auditService?.recordChange({ entity_type: 'project', entity_id: project.id, operation_type: 'project.create', new_state: project });
      return project;
    },

    getProject(id) {
      const p = personalRepository.findProjectById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Proyecto no encontrado: ${id}`, { entity: 'Project' });
      return {
        ...p,
        goals: personalRepository.listGoalsForProject(id),
        tasks: personalRepository.listTasks({ project_id: id }),
        progress: this.getProjectProgress(id),
      };
    },

    listProjects(filters = {}) {
      return personalRepository.listProjects(filters);
    },

    updateProject(id, patch) {
      const current = personalRepository.findProjectById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Proyecto no encontrado: ${id}`, { entity: 'Project' });
      validateProjectInput(patch, true);
      if (patch.status !== undefined) assertTransition(PROJECT_TRANSITIONS, current.status, patch.status, 'Project');
      const now = nowIso();
      const nextStatus = patch.status ?? current.status;
      const updated = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        description: patch.description !== undefined ? patch.description.trim() : current.description,
        purpose: patch.purpose !== undefined ? patch.purpose.trim() : current.purpose,
        priority_id: patch.priority_id !== undefined ? patch.priority_id : current.priority_id,
        status: nextStatus,
        start_date: patch.start_date !== undefined ? patch.start_date : current.start_date,
        target_date: patch.target_date !== undefined ? patch.target_date : current.target_date,
        completed_at: nextStatus === 'COMPLETED' ? (current.completed_at ?? now) : current.completed_at,
        updated_at: now,
        archived_at: nextStatus === 'ARCHIVED' ? (current.archived_at ?? now) : current.archived_at,
      };
      personalRepository.updateProject(updated);
      auditService?.recordChange({ entity_type: 'project', entity_id: id, operation_type: 'project.update', previous_state: current, new_state: updated });
      return updated;
    },

    changeProjectStatus(id, status) {
      return this.updateProject(id, { status });
    },

    relateGoal(projectId, goalId) {
      if (!personalRepository.findProjectById(projectId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Proyecto no encontrado: ${projectId}`);
      if (!personalRepository.findGoalById(goalId)) throw new NexusError(ERROR_CODES.NOT_FOUND, `Objetivo no encontrado: ${goalId}`);
      personalRepository.linkGoalProject(goalId, projectId, nowIso());
      return { project_id: projectId, goal_id: goalId, linked: true };
    },

    relateTask(projectId, taskId) {
      const project = personalRepository.findProjectById(projectId);
      if (!project) throw new NexusError(ERROR_CODES.NOT_FOUND, `Proyecto no encontrado: ${projectId}`);
      if (project.status === 'ARCHIVED') {
        throw new NexusError(ERROR_CODES.CONFLICT, 'No se pueden asociar tareas a un proyecto archivado.');
      }
      if (taskService) {
        taskService.updateTask(taskId, { project_id: projectId });
      } else {
        const task = personalRepository.findTaskById(taskId);
        if (!task) throw new NexusError(ERROR_CODES.NOT_FOUND, `Tarea no encontrada: ${taskId}`);
        personalRepository.updateTask({ ...task, project_id: projectId, updated_at: nowIso() });
      }
      return { project_id: projectId, task_id: taskId, linked: true };
    },

    getProjectProgress(id) {
      const p = personalRepository.findProjectById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Proyecto no encontrado: ${id}`);
      const tasks = personalRepository.listTasks({ project_id: id }).filter(t => t.status !== 'CANCELLED' && t.status !== 'ARCHIVED');
      const total = tasks.length;
      const completed = tasks.filter(t => t.status === 'COMPLETED').length;
      const blocked = tasks.filter(t => t.status === 'BLOCKED').length;
      return {
        project_id: id,
        project_status: p.status,
        total_active_tasks: total,
        completed_tasks: completed,
        blocked_tasks: blocked,
        task_completion_ratio: total > 0 ? Number((completed / total).toFixed(4)) : null,
        note: 'El porcentaje de tareas completadas no equivale automáticamente a la consecución del objetivo estratégico (INV-007).',
      };
    },

    archiveProject(id) {
      return this.changeProjectStatus(id, 'ARCHIVED');
    },
  };
}
