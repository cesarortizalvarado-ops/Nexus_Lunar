import { ERROR_CODES, NexusError } from './errors.js';
import { MODULE_STATUSES } from '../domain/shared/enums.js';
import { wouldCreateCycle } from '../domain/shared/domain-relation.js';

export function createModuleRegistryService({ repository = null, eventService = null, clock = null } = {}) {
  const modules = new Map();
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function allEdges() {
    const edges = [];
    for (const mod of modules.values()) {
      for (const dep of mod.dependencies) {
        edges.push([mod.id, dep]);
      }
    }
    return edges;
  }

  function persist(mod) {
    if (repository) repository.saveModule(mod);
  }

  return {
    registerModule({ id, name, description = '', version = '1.0.0', dependencies = [], capabilities = [], configuration = {}, optional = false, status = 'PREPARING' }) {
      if (!id || typeof id !== 'string') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'id de módulo es obligatorio.', { field: 'id' });
      }
      if (!name || typeof name !== 'string') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name de módulo es obligatorio.', { field: 'name' });
      }
      if (!MODULE_STATUSES.includes(status)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado de módulo inválido: ${status}`, { field: 'status' });
      }
      const deps = [...new Set(dependencies)];
      const edges = allEdges().filter(([from]) => from !== id);
      for (const dep of deps) {
        if (wouldCreateCycle(edges, id, dep)) {
          throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `Dependencia circular detectada entre ${id} y ${dep}.`, {
            entity: 'Module',
            remediation: 'Elimina el ciclo de dependencias entre módulos.',
          });
        }
        edges.push([id, dep]);
      }

      const now = nowIso();
      const existing = modules.get(id) ?? repository?.findModuleById?.(id) ?? null;
      const effectiveStatus = existing?.status === 'DISABLED' ? 'DISABLED' : status;
      const record = {
        id,
        name,
        description,
        version,
        status: effectiveStatus,
        dependencies: deps,
        capabilities: [...capabilities],
        configuration: { ...(existing?.configuration ?? {}), ...configuration },
        optional: Boolean(optional),
        registered_at: existing?.registered_at ?? now,
        activated_at: effectiveStatus === 'AVAILABLE' ? now : (existing?.activated_at ?? null),
      };
      modules.set(id, record);
      persist(record);
      eventService?.publishEvent({
        event_type: 'module.registered',
        source: 'ModuleRegistryService',
        payload: { module_id: id, version, status },
      });
      return { ...record };
    },

    getModule(id) {
      const mod = modules.get(id);
      if (!mod) throw new NexusError(ERROR_CODES.NOT_FOUND, `Módulo no encontrado: ${id}`, { entity: 'Module' });
      return { ...mod };
    },

    listModules({ status = null } = {}) {
      const list = [...modules.values()];
      return (status ? list.filter(m => m.status === status) : list).map(m => ({ ...m }));
    },

    enableModule(id) {
      const mod = modules.get(id);
      if (!mod) throw new NexusError(ERROR_CODES.NOT_FOUND, `Módulo no encontrado: ${id}`, { entity: 'Module' });
      for (const depId of mod.dependencies) {
        const dep = modules.get(depId);
        if (!dep || dep.status !== 'AVAILABLE') {
          throw new NexusError(
            ERROR_CODES.DEPENDENCY_ERROR,
            `No se puede habilitar ${id}: falta dependencia obligatoria disponible (${depId}).`,
            { entity: 'Module', remediation: `Habilita primero el módulo ${depId}.` }
          );
        }
      }
      mod.status = 'AVAILABLE';
      mod.activated_at = nowIso();
      persist(mod);
      eventService?.publishEvent({
        event_type: 'module.enabled',
        source: 'ModuleRegistryService',
        payload: { module_id: id },
      });
      // Recuperar dependientes DEGRADED cuyas dependencias ya estén todas AVAILABLE
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const candidate of modules.values()) {
          if (candidate.status === 'DEGRADED' && candidate.dependencies.every(d => modules.get(d)?.status === 'AVAILABLE')) {
            candidate.status = 'AVAILABLE';
            candidate.activated_at = nowIso();
            persist(candidate);
            progressed = true;
          }
        }
      }
      return { ...mod };
    },

    disableModule(id) {
      const mod = modules.get(id);
      if (!mod) throw new NexusError(ERROR_CODES.NOT_FOUND, `Módulo no encontrado: ${id}`, { entity: 'Module' });
      // INV-013: deshabilitar nunca elimina datos
      mod.status = 'DISABLED';
      persist(mod);
      eventService?.publishEvent({
        event_type: 'module.disabled',
        source: 'ModuleRegistryService',
        payload: { module_id: id, data_preserved: true },
      });
      return { ...mod, data_preserved: true };
    },

    setModuleStatus(id, status, reason = null) {
      const mod = modules.get(id);
      if (!mod) throw new NexusError(ERROR_CODES.NOT_FOUND, `Módulo no encontrado: ${id}`, { entity: 'Module' });
      if (!MODULE_STATUSES.includes(status)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Estado inválido: ${status}`);
      }
      mod.status = status;
      persist(mod);
      eventService?.publishEvent({
        event_type: 'module.status_changed',
        source: 'ModuleRegistryService',
        payload: { module_id: id, status, reason },
      });
      return { ...mod };
    },

    getModuleDependencies(id) {
      const mod = this.getModule(id);
      return mod.dependencies.map(depId => {
        const dep = modules.get(depId);
        return { id: depId, registered: Boolean(dep), status: dep?.status ?? 'MISSING' };
      });
    },

    getModuleStatus(id) {
      const mod = this.getModule(id);
      return { id: mod.id, status: mod.status, version: mod.version, activated_at: mod.activated_at };
    },
  };
}
