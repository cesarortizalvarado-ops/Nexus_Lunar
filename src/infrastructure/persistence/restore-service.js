import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { checkSqliteFileIntegrity, sha256File } from './backup-service.js';
import { resolveInsideRoot } from './file-storage-service.js';

export function createRestoreService({ config, persistenceService, backupService, migrationService = null, auditService = null }) {
  const pendingAuthorizations = new Map();

  function maxSupportedSchema() {
    if (migrationService?.getMaxSupportedVersion) {
      return migrationService.getMaxSupportedVersion();
    }
    return persistenceService.getSchemaVersion();
  }

  return {
    inspectBackup(backupId) {
      const meta = backupService.getBackup(backupId);
      const verification = backupService.verifyBackup(backupId);
      return {
        backup: meta,
        verification,
        target_db_path: persistenceService.getDbPath(),
        current_schema_version: persistenceService.getSchemaVersion(),
        max_supported_schema_version: maxSupportedSchema(),
      };
    },

    validateRestore(backupId) {
      const inspection = this.inspectBackup(backupId);
      const errors = [...inspection.verification.errors];
      if (!inspection.verification.ok) {
        errors.push('El respaldo no superó la verificación de integridad.');
      }
      const maxSchema = inspection.max_supported_schema_version;
      if (Number(inspection.backup.schema_version) > maxSchema) {
        errors.push(
          `Esquema del respaldo (v${inspection.backup.schema_version}) es posterior al máximo soportado por esta aplicación (v${maxSchema}).`
        );
      }
      return {
        valid: errors.length === 0,
        backup_id: backupId,
        backup_schema_version: inspection.backup.schema_version,
        current_schema_version: inspection.current_schema_version,
        max_supported_schema_version: maxSchema,
        requires_post_restore_migration: Number(inspection.backup.schema_version) < maxSchema,
        files_count: (inspection.backup.files ?? []).length,
        errors,
      };
    },

    requestRestoreAuthorization(backupId, { requestedBy = 'USER' } = {}) {
      const validation = this.validateRestore(backupId);
      if (!validation.valid) {
        throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'No se puede autorizar la restauración de un respaldo inválido o incompatible.', {
          details: validation.errors,
        });
      }
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const auth = { token, backup_id: backupId, requested_by: requestedBy, expires_at: expiresAt };
      pendingAuthorizations.set(token, auth);
      return auth;
    },

    restoreBackup(backupId, { authorizationToken = null, confirmed = false, authorizedBy = null, authorization = null } = {}) {
      // DB-007: La restauración siempre requiere autorización explícita
      let authValid = false;
      let resolvedAuthorizer = authorizedBy || 'USER';

      if (authorizationToken && pendingAuthorizations.has(authorizationToken)) {
        const entry = pendingAuthorizations.get(authorizationToken);
        if (entry.backup_id === backupId && entry.expires_at >= new Date().toISOString()) {
          authValid = true;
          resolvedAuthorizer = entry.requested_by || resolvedAuthorizer;
          pendingAuthorizations.delete(authorizationToken);
        }
      } else if (confirmed === true && authorizedBy) {
        authValid = true;
        resolvedAuthorizer = authorizedBy;
      } else if (authorization && authorization.approved === true && authorization.authorized_by) {
        authValid = true;
        resolvedAuthorizer = authorization.authorized_by;
      }

      if (!authValid) {
        throw new NexusError(
          ERROR_CODES.PERMISSION_DENIED,
          'DB-007: Restauración rechazada: se requiere autorización explícita verificable.',
          { remediation: 'Solicita autorización con requestRestoreAuthorization() o confirma explícitamente con authorizedBy.' }
        );
      }

      const validation = this.validateRestore(backupId);
      if (!validation.valid) {
        throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'Restauración cancelada: el respaldo es inválido o incompatible.', {
          details: validation.errors,
        });
      }

      const backup = backupService.getBackup(backupId);
      const sourceDbPath = path.join(backup.location, backup.database.file);
      const targetDbPath = persistenceService.getDbPath();
      const tempDbPath = `${targetDbPath}.restore-tmp`;
      const prevDbPath = `${targetDbPath}.prev-tmp`;
      const stagingFilesDir = `${config.filesDir}.restore-tmp`;
      const prevFilesDir = `${config.filesDir}.prev-tmp`;

      // 1. Generar respaldo automático pre-restore ANTES de tocar archivos o DB (resguarda cualquier archivo posterior al backup)
      let preRestoreBackup = null;
      if (fs.existsSync(targetDbPath)) {
        preRestoreBackup = backupService.createBackup({ reason: 'pre-restore' });
      }

      // 2. Preparar staging completo de archivos asociados verificando SHA-256 antes de cerrar o reemplazar
      fs.rmSync(stagingFilesDir, { recursive: true, force: true });
      fs.mkdirSync(stagingFilesDir, { recursive: true });
      const backupFilesRoot = path.join(backup.location, 'files');
      for (const f of backup.files ?? []) {
        const srcFile = resolveInsideRoot(backupFilesRoot, f.name);
        const dstFile = resolveInsideRoot(stagingFilesDir, f.name);
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
        if (sha256File(dstFile) !== f.sha256) {
          fs.rmSync(stagingFilesDir, { recursive: true, force: true });
          throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `Fallo verificando archivo en staging de restauración: ${f.name}`);
        }
      }

      // 3. Preparar staging de SQLite y verificar integridad antes de sustituir
      fs.copyFileSync(sourceDbPath, tempDbPath);
      const tempCheck = checkSqliteFileIntegrity(tempDbPath);
      if (!tempCheck.ok) {
        fs.rmSync(tempDbPath, { force: true });
        fs.rmSync(stagingFilesDir, { recursive: true, force: true });
        throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'La copia temporal no superó verificación; la base actual no fue sustituida.');
      }

      // 4. Cerrar conexión activa e intercambiar atómicamente DB y filesDir (eliminando huérfanos posteriores al backup)
      persistenceService.shutdownStorage();
      let dbSwapped = false;
      let filesSwapped = false;

      try {
        fs.rmSync(prevDbPath, { force: true });
        if (fs.existsSync(targetDbPath)) {
          fs.renameSync(targetDbPath, prevDbPath);
        }
        for (const suffix of ['-wal', '-shm']) {
          fs.rmSync(`${targetDbPath}${suffix}`, { force: true });
        }
        fs.renameSync(tempDbPath, targetDbPath);
        dbSwapped = true;

        fs.rmSync(prevFilesDir, { recursive: true, force: true });
        if (fs.existsSync(config.filesDir)) {
          fs.renameSync(config.filesDir, prevFilesDir);
        }
        fs.renameSync(stagingFilesDir, config.filesDir);
        filesSwapped = true;

        persistenceService.initializeStorage();

        // Realinear rutas físicas de stored_files con config.filesDir actual
        try {
          const db = persistenceService.getDatabase();
          const hasStoredFiles = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stored_files'").get();
          if (hasStoredFiles) {
            const rows = db.prepare('SELECT id, internal_name, is_temporary FROM stored_files').all();
            const upd = db.prepare('UPDATE stored_files SET location = ? WHERE id = ?');
            for (const row of rows) {
              const root = row.is_temporary ? config.tempDir : config.filesDir;
              upd.run(resolveInsideRoot(root, row.internal_name), row.id);
            }
          }
        } catch {
          // Tablas previas a v7 no tienen stored_files
        }

        // Si el respaldo proviene de una versión de esquema anterior, aplicar migraciones pendientes de forma controlada
        let postRestoreMigrations = null;
        if (migrationService && persistenceService.getSchemaVersion() < maxSupportedSchema()) {
          postRestoreMigrations = migrationService.executeMigration({ skipPreBackup: true });
        }

        const verifiedState = this.verifyRestoredState();
        if (!verifiedState.ok) {
          throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'El estado restaurado no superó la verificación posterior.');
        }

        // Confirmado con éxito: limpiar copias temporales de intercambio
        fs.rmSync(prevDbPath, { force: true });
        fs.rmSync(prevFilesDir, { recursive: true, force: true });

        const restoreId = randomUUID();
        const executedAt = new Date().toISOString();
        try {
          const db = persistenceService.getDatabase();
          db.prepare(`
            INSERT INTO restore_history (id, backup_id, backup_file, pre_restore_backup_id, authorized_by, status, executed_at)
            VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?)
          `).run(restoreId, backupId, backup.database.file, preRestoreBackup?.id ?? null, resolvedAuthorizer, executedAt);
        } catch {
          // Respaldo sin tabla restore_history cuando no hay migrationService
        }

        auditService?.recordOperation({
          operation_type: 'restore.backup',
          entity_type: 'Database',
          entity_id: backupId,
          source_id: resolvedAuthorizer,
          outcome: 'SUCCESS',
          reason: `Restauración desde ${backupId} (pre-restore: ${preRestoreBackup?.id ?? 'none'})`,
          is_security_event: true,
        });

        return {
          restore_id: restoreId,
          restored_backup_id: backupId,
          pre_restore_backup_id: preRestoreBackup?.id ?? null,
          post_restore_migrations: postRestoreMigrations?.executed ?? [],
          verified: verifiedState,
          executed_at: executedAt,
        };
      } catch (err) {
        // Rollback físico de archivos y base de datos si falló tras iniciar el intercambio
        try { persistenceService.shutdownStorage(); } catch { /* ignore */ }
        if (dbSwapped && fs.existsSync(prevDbPath)) {
          fs.rmSync(targetDbPath, { force: true });
          fs.renameSync(prevDbPath, targetDbPath);
        }
        if (filesSwapped && fs.existsSync(prevFilesDir)) {
          fs.rmSync(config.filesDir, { recursive: true, force: true });
          fs.renameSync(prevFilesDir, config.filesDir);
        }
        fs.rmSync(tempDbPath, { force: true });
        fs.rmSync(stagingFilesDir, { recursive: true, force: true });
        try { persistenceService.initializeStorage(); } catch { /* permanece en modo recuperación */ }
        if (err instanceof NexusError) throw err;
        throw new NexusError(ERROR_CODES.OPERATION_FAILED, `Fallo en restauración: ${err.message}`);
      }
    },

    verifyRestoredState() {
      const check = checkSqliteFileIntegrity(persistenceService.getDbPath());
      const missingFiles = [];
      try {
        const db = persistenceService.getReadDatabase();
        const hasStoredFiles = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stored_files'").get();
        if (hasStoredFiles) {
          const rows = db.prepare("SELECT id, internal_name, sha256 FROM stored_files WHERE status = 'ACTIVE' AND is_temporary = 0").all();
          for (const r of rows) {
            const fullPath = resolveInsideRoot(config.filesDir, r.internal_name);
            if (!fs.existsSync(fullPath) || sha256File(fullPath) !== r.sha256) {
              missingFiles.push(r.internal_name);
            }
          }
        }
      } catch {
        // ignore pre-v7
      }
      return {
        ...check,
        ok: check.ok && missingFiles.length === 0,
        missing_or_corrupted_files: missingFiles,
        schema_version: persistenceService.getSchemaVersion(),
      };
    },

    getRestoreHistory() {
      const db = persistenceService.getReadDatabase();
      return db.prepare('SELECT * FROM restore_history ORDER BY executed_at DESC').all();
    },
  };
}
