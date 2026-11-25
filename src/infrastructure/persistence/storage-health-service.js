import fs from 'node:fs';
import path from 'node:path';
import { checkSqliteFileIntegrity, listFilesRecursiveRelative, sha256File } from './backup-service.js';
import { resolveInsideRoot } from './file-storage-service.js';

export function createStorageHealthService({ config, persistenceService, migrationService = null, backupService = null }) {
  return {
    getAvailableSpace() {
      try {
        const stat = fs.statfsSync(config.dbDir);
        const freeBytes = Number(stat.bavail) * Number(stat.bsize);
        const totalBytes = Number(stat.blocks) * Number(stat.bsize);
        return {
          available_bytes: freeBytes,
          total_bytes: totalBytes,
          low_space: freeBytes < 100 * 1024 * 1024,
        };
      } catch (err) {
        return { available_bytes: null, total_bytes: null, low_space: false, error: err.message };
      }
    },

    getIntegrityStatus() {
      const dbPath = persistenceService.getDbPath();
      if (!fs.existsSync(dbPath)) {
        return { ok: false, reason: 'DB_NOT_CREATED' };
      }
      return checkSqliteFileIntegrity(dbPath);
    },

    inspectStoredFilesIntegrity() {
      const missing = [];
      const hashMismatches = [];
      const trackedSet = new Set();
      try {
        const db = persistenceService.getReadDatabase();
        const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stored_files'").get();
        if (hasTable) {
          const rows = db.prepare("SELECT id, internal_name, sha256 FROM stored_files WHERE status = 'ACTIVE' AND is_temporary = 0").all();
          for (const r of rows) {
            trackedSet.add(r.internal_name);
            const fullPath = resolveInsideRoot(config.filesDir, r.internal_name);
            if (!fs.existsSync(fullPath)) {
              missing.push(r.internal_name);
            } else if (sha256File(fullPath) !== r.sha256) {
              hashMismatches.push(r.internal_name);
            }
          }
        }
      } catch (err) {
        return { ok: false, error: err.message, missing: [], hash_mismatches: [], orphan_files: [] };
      }

      const diskFiles = listFilesRecursiveRelative(config.filesDir);
      const orphanFiles = diskFiles
        .map(f => f.relativePath)
        .filter(rel => !trackedSet.has(rel));

      return {
        ok: missing.length === 0 && hashMismatches.length === 0 && orphanFiles.length === 0,
        tracked_active_count: trackedSet.size,
        disk_files_count: diskFiles.length,
        missing,
        hash_mismatches: hashMismatches,
        orphan_files: orphanFiles,
      };
    },

    inspectTemporaryFiles() {
      if (!fs.existsSync(config.tempDir)) {
        return { count: 0, total_bytes: 0, files: [] };
      }
      const files = listFilesRecursiveRelative(config.tempDir).map(entry => {
        const st = fs.statSync(entry.fullPath);
        return { name: entry.relativePath, size_bytes: st.size, modified_at: st.mtime.toISOString() };
      });
      return {
        count: files.length,
        total_bytes: files.reduce((acc, f) => acc + f.size_bytes, 0),
        files,
      };
    },

    cleanTemporaryFiles({ olderThanMs = 0 } = {}) {
      if (!fs.existsSync(config.tempDir)) return { removed: 0 };
      const now = Date.now();
      let removed = 0;
      for (const entry of listFilesRecursiveRelative(config.tempDir)) {
        if (entry.relativePath.endsWith('.active')) continue; // No eliminar temporales de operaciones activas
        const st = fs.statSync(entry.fullPath);
        if (now - st.mtimeMs >= olderThanMs) {
          fs.rmSync(entry.fullPath, { force: true });
          removed += 1;
        }
      }
      return { removed };
    },

    getRecoveryStatus() {
      const storage = persistenceService.getStorageStatus();
      return {
        recovery_mode: storage.recovery_mode,
        last_error: storage.last_error,
        backups_available: backupService ? backupService.listBackups().length : 0,
      };
    },

    inspectStorage() {
      const storage = persistenceService.getStorageStatus();
      const backups = backupService ? backupService.listBackups() : [];
      return {
        storage,
        metadata: persistenceService.getStorageMetadata(),
        integrity: this.getIntegrityStatus(),
        files_integrity: this.inspectStoredFilesIntegrity(),
        space: this.getAvailableSpace(),
        migrations: migrationService ? migrationService.getMigrationStatus() : null,
        last_backup: backups[0] ?? null,
        temporary_files: this.inspectTemporaryFiles(),
        recovery: this.getRecoveryStatus(),
      };
    },
  };
}
