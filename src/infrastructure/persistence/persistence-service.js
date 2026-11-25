import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ERROR_CODES, NexusError } from '../../core/errors.js';

export const DB_FILENAME = 'nexus-lunar.sqlite';

export function createPersistenceService(config) {
  let db = null;
  let recoveryMode = false;
  let lastError = null;
  const dbPath = path.join(config.dbDir, DB_FILENAME);

  function ensureDirectories() {
    for (const dir of [config.dbDir, config.filesDir, config.tempDir, config.logsDir, config.backupDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  return {
    getDbPath() {
      return dbPath;
    },

    isRecoveryMode() {
      return recoveryMode;
    },

    enterRecoveryMode(reason) {
      recoveryMode = true;
      lastError = reason;
    },

    exitRecoveryMode() {
      recoveryMode = false;
      lastError = null;
    },

    initializeStorage() {
      if (db) return this.getStorageStatus();
      ensureDirectories();
      try {
        db = new DatabaseSync(dbPath);
        db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
        const check = db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check);
        if (check.length !== 1 || check[0] !== 'ok') {
          recoveryMode = true;
          lastError = `Integrity check fallido: ${JSON.stringify(check)}`;
          throw new NexusError(ERROR_CODES.PERSISTENCE_ERROR, lastError, {
            remediation: 'Usa RestoreService para recuperar un respaldo verificado.',
          });
        }
        db.exec(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS schema_versions (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL,
            migration_id TEXT NOT NULL,
            description TEXT NOT NULL,
            execution_status TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS migration_records (
            id TEXT PRIMARY KEY,
            source_version INTEGER NOT NULL,
            target_version INTEGER NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','COMPLETED','FAILED','ROLLED_BACK','REQUIRES_INTERVENTION')),
            description TEXT NOT NULL,
            error_reference TEXT
          );
        `);
        recoveryMode = false;
        lastError = null;
        return this.getStorageStatus();
      } catch (err) {
        if (err instanceof NexusError) throw err;
        recoveryMode = true;
        lastError = err.message;
        throw new NexusError(ERROR_CODES.PERSISTENCE_ERROR, `No se pudo inicializar el almacenamiento: ${err.message}`);
      }
    },

    getDatabase() {
      if (!db) {
        throw new NexusError(ERROR_CODES.SERVICE_UNAVAILABLE, 'El almacenamiento no está inicializado.', {
          remediation: 'Ejecuta PersistenceService.initializeStorage().',
        });
      }
      if (recoveryMode) {
        throw new NexusError(ERROR_CODES.PERSISTENCE_ERROR, 'Almacenamiento en modo de recuperación: escrituras bloqueadas.', {
          remediation: 'Inspecciona el diagnóstico y restaura un respaldo válido.',
        });
      }
      return db;
    },

    getReadDatabase() {
      if (!db) {
        throw new NexusError(ERROR_CODES.SERVICE_UNAVAILABLE, 'El almacenamiento no está inicializado.');
      }
      return db;
    },

    getSchemaVersion() {
      if (!db) return 0;
      const v1 = db.prepare('SELECT MAX(version) AS v FROM schema_versions').get()?.v ?? 0;
      const v2 = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v ?? 0;
      return Math.max(Number(v1) || 0, Number(v2) || 0);
    },

    getStorageStatus() {
      const exists = fs.existsSync(dbPath);
      const sizeBytes = exists ? fs.statSync(dbPath).size : 0;
      return {
        status: !db ? 'CLOSED' : (recoveryMode ? 'RECOVERY_MODE' : 'READY'),
        engine: 'sqlite (node:sqlite DatabaseSync)',
        db_path: dbPath,
        db_exists: exists,
        size_bytes: sizeBytes,
        schema_version: db ? this.getSchemaVersion() : 0,
        recovery_mode: recoveryMode,
        last_error: lastError,
      };
    },

    getStorageMetadata() {
      return {
        db_dir: config.dbDir,
        files_dir: config.filesDir,
        temp_dir: config.tempDir,
        logs_dir: config.logsDir,
        backup_dir: config.backupDir,
        db_path: dbPath,
        schema_version: this.getSchemaVersion(),
      };
    },

    shutdownStorage() {
      if (db) {
        try { db.close(); } finally { db = null; }
      }
      return { status: 'CLOSED' };
    },
  };
}
