import { ERROR_CODES, NexusError } from './errors.js';
import { validateConfig } from '../config.js';

export const SYSTEM_VERSION = '1.0.0-experimental';

export function createSystemService({ config, moduleRegistry, eventService, persistenceService = null, clock = null } = {}) {
  let currentConfig = { ...config };
  let initialized = false;
  let startedAt = null;
  let status = 'STOPPED';
  const shutdownHooks = [];
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    registerShutdownHook(fn) {
      if (typeof fn === 'function') shutdownHooks.push(fn);
    },

    initialize() {
      const errors = validateConfig(currentConfig);
      if (errors.length) {
        status = 'ERROR';
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Configuración del sistema inválida.', {
          details: errors,
          remediation: 'Corrige los parámetros de configuración antes de inicializar.',
        });
      }

      const criticalErrors = [];
      if (persistenceService) {
        try {
          persistenceService.initializeStorage();
        } catch (err) {
          status = 'RECOVERY_REQUIRED';
          criticalErrors.push(err.message);
          throw err;
        }
      }

      const degradedModules = [];
      if (moduleRegistry) {
        for (const mod of moduleRegistry.listModules()) {
          if (mod.status === 'DISABLED') continue;
          try {
            moduleRegistry.enableModule(mod.id);
          } catch (err) {
            const blockedByDisabledOrDegraded = mod.dependencies.some(depId => {
              const dep = moduleRegistry.listModules().find(m => m.id === depId);
              return dep && (dep.status === 'DISABLED' || dep.status === 'DEGRADED');
            });
            if (mod.optional || blockedByDisabledOrDegraded) {
              moduleRegistry.setModuleStatus(mod.id, 'DEGRADED', err.message);
              degradedModules.push({ id: mod.id, reason: err.message });
            } else {
              moduleRegistry.setModuleStatus(mod.id, 'ERROR', err.message);
              criticalErrors.push(`${mod.id}: ${err.message}`);
            }
          }
        }
      }

      if (criticalErrors.length > 0) {
        status = 'ERROR';
        throw new NexusError(ERROR_CODES.DEPENDENCY_ERROR, 'Fallo crítico al inicializar módulos obligatorios.', {
          details: criticalErrors,
        });
      }

      initialized = true;
      startedAt = nowIso();
      status = degradedModules.length > 0 ? 'DEGRADED' : 'AVAILABLE';

      eventService?.publishEvent({
        event_type: 'system.initialized',
        source: 'SystemService',
        payload: { version: SYSTEM_VERSION, status, degradedModules },
      });

      return this.getSystemStatus();
    },

    getSystemStatus() {
      return {
        application: 'Nexus Lunar',
        version: SYSTEM_VERSION,
        status,
        initialized,
        started_at: startedAt,
        local_only: true,
        ai_integrated: false,
        modules: moduleRegistry ? moduleRegistry.listModules() : [],
        storage: persistenceService ? persistenceService.getStorageStatus() : { status: 'NOT_CONFIGURED' },
      };
    },

    getConfiguration() {
      return {
        host: currentConfig.host,
        port: currentConfig.port,
        dataDir: currentConfig.dataDir,
        dbDir: currentConfig.dbDir,
        filesDir: currentConfig.filesDir,
        tempDir: currentConfig.tempDir,
        logsDir: currentConfig.logsDir,
        backupDir: currentConfig.backupDir,
        timezone: currentConfig.timezone,
        externalTransmissionAllowed: Boolean(currentConfig.externalTransmissionAllowed),
      };
    },

    updateConfiguration(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'La configuración debe ser un objeto.');
      }
      const next = { ...currentConfig, ...patch };
      const errors = validateConfig(next);
      if (errors.length) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Actualización de configuración rechazada.', {
          details: errors,
        });
      }
      currentConfig = next;
      eventService?.publishEvent({
        event_type: 'system.configuration_updated',
        source: 'SystemService',
        payload: { updated_keys: Object.keys(patch) },
      });
      return this.getConfiguration();
    },

    getVersion() {
      return {
        application: 'Nexus Lunar',
        version: SYSTEM_VERSION,
        schema_version: persistenceService ? persistenceService.getSchemaVersion() : null,
      };
    },

    shutdown() {
      for (const hook of shutdownHooks.reverse()) {
        try { hook(); } catch { /* continuar cierre ordenado */ }
      }
      if (persistenceService) {
        persistenceService.shutdownStorage();
      }
      initialized = false;
      status = 'STOPPED';
      return { status, stopped_at: nowIso() };
    },
  };
}
