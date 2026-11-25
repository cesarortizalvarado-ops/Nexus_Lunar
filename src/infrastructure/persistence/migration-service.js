import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { getAllMigrations } from './migrations/index.js';

export function createMigrationService({ persistenceService, backupService = null, migrations = getAllMigrations() } = {}) {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const maxSupportedVersion = ordered.length ? ordered[ordered.length - 1].version : 0;

  function getAppliedSet() {
    const db = persistenceService.getReadDatabase();
    const s1 = db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version);
    const s2 = db.prepare('SELECT version FROM schema_versions WHERE execution_status = ?').all('COMPLETED').map(r => r.version);
    return new Set([...s1, ...s2]);
  }

  return {
    getMaxSupportedVersion() {
      return maxSupportedVersion;
    },

    identifyIncompatibleVersion({ allowRetryIntervention = false } = {}) {
      const current = persistenceService.getSchemaVersion();
      if (current > maxSupportedVersion) {
        return {
          compatible: false,
          reason: 'APP_OLDER_THAN_DATABASE',
          current_version: current,
          supported_version: maxSupportedVersion,
        };
      }
      const db = persistenceService.getReadDatabase();
      const disallowedStatuses = allowRetryIntervention
        ? ['FAILED', 'RUNNING']
        : ['FAILED', 'REQUIRES_INTERVENTION', 'RUNNING'];
      const placeholders = disallowedStatuses.map(() => '?').join(',');
      const broken = db.prepare(`SELECT * FROM migration_records WHERE status IN (${placeholders}) ORDER BY started_at DESC LIMIT 1`).get(...disallowedStatuses);
      if (broken) {
        return {
          compatible: false,
          reason: 'INCOMPLETE_OR_FAILED_MIGRATION',
          current_version: current,
          supported_version: maxSupportedVersion,
          failed_record: broken,
        };
      }
      return {
        compatible: true,
        current_version: current,
        supported_version: maxSupportedVersion,
      };
    },

    listPendingMigrations() {
      const applied = getAppliedSet();
      return ordered.filter(m => !applied.has(m.version)).map(m => ({
        version: m.version,
        name: m.name,
        description: m.description ?? m.name,
        reversible: Boolean(m.reversible),
      }));
    },

    getMigrationStatus() {
      const compat = this.identifyIncompatibleVersion();
      const pending = this.listPendingMigrations();
      return {
        current_version: persistenceService.getSchemaVersion(),
        target_version: maxSupportedVersion,
        compatible: compat.compatible,
        compatibility_detail: compat,
        pending_count: pending.length,
        pending,
      };
    },

    createMigrationPlan() {
      const compat = this.identifyIncompatibleVersion();
      if (!compat.compatible) {
        throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `Esquema incompatible: ${compat.reason}`, {
          details: compat,
          remediation: 'Actualiza la aplicación o recupera un respaldo compatible antes de migrar.',
        });
      }
      const pending = this.listPendingMigrations();
      return {
        source_version: persistenceService.getSchemaVersion(),
        target_version: maxSupportedVersion,
        requires_backup: persistenceService.getSchemaVersion() > 0 && pending.length > 0,
        steps: pending,
      };
    },

    executeMigration({ skipPreBackup = false, retryResolvedConflict = false } = {}) {
      const compat = this.identifyIncompatibleVersion({ allowRetryIntervention: retryResolvedConflict });
      if (!compat.compatible) {
        persistenceService.enterRecoveryMode(`Esquema incompatible: ${compat.reason}`);
        throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `Migración bloqueada por incompatibilidad: ${compat.reason}`, {
          details: compat,
        });
      }

      const applied = getAppliedSet();
      const pending = ordered.filter(m => !applied.has(m.version));
      if (pending.length === 0) {
        return { executed: [], current_version: persistenceService.getSchemaVersion(), backup: null };
      }

      let preBackup = null;
      if (!skipPreBackup && applied.size > 0 && backupService) {
        preBackup = backupService.createBackup({ reason: 'pre-migration' });
      }

      const db = persistenceService.getDatabase();
      if (retryResolvedConflict) {
        db.prepare("UPDATE migration_records SET status = 'ROLLED_BACK' WHERE status = 'REQUIRES_INTERVENTION'").run();
      }
      const executed = [];

      for (const m of pending) {
        const sourceVersion = persistenceService.getSchemaVersion();
        const recordId = randomUUID();
        const startedAt = new Date().toISOString();
        db.prepare(`
          INSERT INTO migration_records (id, source_version, target_version, started_at, status, description)
          VALUES (?, ?, ?, ?, 'RUNNING', ?)
        `).run(recordId, sourceVersion, m.version, startedAt, m.description ?? m.name);

        db.exec('BEGIN IMMEDIATE');
        try {
          const runResult = typeof m.run === 'function'
            ? m.run(db, { migrationId: recordId })
            : db.exec(m.sql);
          const completedAt = new Date().toISOString();
          db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, completedAt);
          db.prepare('INSERT OR REPLACE INTO schema_versions (version, applied_at, migration_id, description, execution_status) VALUES (?, ?, ?, ?, ?)').run(
            m.version,
            completedAt,
            recordId,
            m.description ?? m.name,
            'COMPLETED'
          );
          db.prepare("UPDATE migration_records SET completed_at = ?, status = 'COMPLETED' WHERE id = ?").run(completedAt, recordId);
          db.exec('COMMIT');
          executed.push({ version: m.version, name: m.name, migration_id: recordId, result: runResult ?? null });
        } catch (err) {
          const failedAt = new Date().toISOString();
          if (err?.preserveEvidence) {
            // El savepoint de datos ya fue revertido dentro de la migración; confirmamos únicamente la evidencia auditable del conflicto
            try {
              db.prepare("UPDATE migration_records SET completed_at = ?, status = 'REQUIRES_INTERVENTION', error_reference = ? WHERE id = ?").run(
                failedAt,
                err.message,
                recordId
              );
              db.exec('COMMIT');
            } catch {
              try { db.exec('ROLLBACK'); } catch { /* ignore */ }
            }
            // DP-02 Salvaguarda 7: detener únicamente la operación afectada sin destruir información ni bloquear las lecturas/tablas existentes
            throw err;
          }

          try { db.exec('ROLLBACK'); } catch { /* ignore */ }
          try {
            db.prepare("UPDATE migration_records SET completed_at = ?, status = 'FAILED', error_reference = ? WHERE id = ?").run(
              failedAt,
              err.message,
              recordId
            );
          } catch { /* ignore */ }
          persistenceService.enterRecoveryMode(`Migración v${m.version} (${m.name}) fallida: ${err.message}`);
          throw new NexusError(ERROR_CODES.PERSISTENCE_ERROR, `Fallo en migración v${m.version} (${m.name}): ${err.message}`, {
            remediation: 'No reintentes ciegamente; inspecciona migration_records o restaura el respaldo pre-migration.',
          });
        }
      }

      return {
        executed,
        current_version: persistenceService.getSchemaVersion(),
        backup: preBackup,
      };
    },

    getMigrationHistory() {
      const db = persistenceService.getReadDatabase();
      return db.prepare('SELECT * FROM migration_records ORDER BY started_at DESC').all();
    },

    getLegacyMigrationReports() {
      const db = persistenceService.getReadDatabase();
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_migration_runs'").get();
      if (!exists) return [];
      const runs = db.prepare('SELECT * FROM legacy_migration_runs ORDER BY started_at DESC').all();
      return runs.map(r => {
        const items = db.prepare('SELECT * FROM legacy_migration_items WHERE run_id = ? ORDER BY recorded_at ASC').all(r.id)
          .map(it => ({ ...it, details: JSON.parse(it.details_json) }));
        return {
          ...r,
          summary: JSON.parse(r.summary_json),
          items,
        };
      });
    },
  };
}
