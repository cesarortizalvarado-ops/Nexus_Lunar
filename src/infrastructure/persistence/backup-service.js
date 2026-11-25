import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { SYSTEM_VERSION } from '../../core/system-service.js';
import { resolveInsideRoot } from './file-storage-service.js';

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function listFilesRecursiveRelative(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const results = [];
  function walk(currentDir, prefix) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        results.push({ relativePath: rel, fullPath: full });
      }
    }
  }
  walk(rootDir, '');
  return results;
}

export function checkSqliteFileIntegrity(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new NexusError(ERROR_CODES.NOT_FOUND, `No existe el archivo de base de datos: ${filePath}`);
  }
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check);
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    return {
      ok: integrity.length === 1 && integrity[0] === 'ok' && fk.length === 0,
      integrity,
      foreignKeyViolations: fk.length,
    };
  } finally {
    db.close();
  }
}

export function createBackupService({ config, persistenceService }) {
  const backupDir = config.backupDir;

  function ensureSafeName(name) {
    if (!name || typeof name !== 'string' || path.basename(name) !== name) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Identificador o nombre de respaldo inválido.', {
        field: 'backup',
        remediation: 'Indica el ID del respaldo (por ejemplo: bkp_...). Consulta los disponibles con backup list.',
      });
    }
  }

  function resolveManifestPath(backupIdOrDir) {
    ensureSafeName(backupIdOrDir);
    const dirPath = path.join(backupDir, backupIdOrDir);
    const manifestPath = path.join(dirPath, 'manifest.json');
    if (fs.existsSync(manifestPath)) return { dirPath, manifestPath };
    throw new NexusError(ERROR_CODES.NOT_FOUND, `Respaldo no encontrado: ${backupIdOrDir}`, {
      entity: 'Backup',
      remediation: 'Ejecuta backup list para consultar los identificadores de respaldo existentes.',
    });
  }

  function pruneBackups(retention) {
    const keep = Math.max(1, Number.isInteger(retention) ? retention : 10);
    const list = fs.readdirSync(backupDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(backupDir, d.name, 'manifest.json')))
      .map(d => d.name)
      .sort()
      .reverse();
    for (const old of list.slice(keep)) {
      fs.rmSync(path.join(backupDir, old), { recursive: true, force: true });
    }
  }

  return {
    createBackup({ reason = 'manual', retention = 10, includeFiles = true } = {}) {
      fs.mkdirSync(backupDir, { recursive: true });
      const db = persistenceService.getReadDatabase();
      const id = `bkp_${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}_${randomUUID().slice(0, 8)}`;
      const packageDir = path.join(backupDir, id);
      fs.mkdirSync(packageDir, { recursive: true });
      const dbDest = path.join(packageDir, 'nexus-lunar.sqlite');

      try {
        // DB-005 / NL-MASTER-05 §42: VACUUM INTO garantiza copia consistente incluso en modo WAL
        db.exec(`VACUUM INTO ${quoteSql(dbDest)}`);
        const check = checkSqliteFileIntegrity(dbDest);
        if (!check.ok) {
          throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'El respaldo generado no superó la verificación de integridad.', {
            details: check,
          });
        }

        const dbSha256 = sha256File(dbDest);
        const dbSize = fs.statSync(dbDest).size;
        const backedFiles = [];

        if (includeFiles && fs.existsSync(config.filesDir)) {
          const filesDestRoot = path.join(packageDir, 'files');
          const entries = listFilesRecursiveRelative(config.filesDir);
          if (entries.length > 0) {
            for (const entry of entries) {
              const dst = resolveInsideRoot(filesDestRoot, entry.relativePath);
              fs.mkdirSync(path.dirname(dst), { recursive: true });
              fs.copyFileSync(entry.fullPath, dst);
              backedFiles.push({
                name: entry.relativePath,
                size_bytes: fs.statSync(dst).size,
                sha256: sha256File(dst),
              });
            }
          }
        }

        const manifest = {
          id,
          created_at: new Date().toISOString(),
          reason,
          app_version: SYSTEM_VERSION,
          schema_version: persistenceService.getSchemaVersion(),
          database: {
            file: 'nexus-lunar.sqlite',
            size_bytes: dbSize,
            sha256: dbSha256,
            integrity: 'ok',
          },
          files: backedFiles,
          excludes_secrets: true,
        };

        fs.writeFileSync(path.join(packageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });

        try {
          db.prepare(`
            INSERT INTO backup_history (id, file_name, location, reason, app_version, schema_version, size_bytes, sha256, verified, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          `).run(id, 'nexus-lunar.sqlite', packageDir, reason, manifest.app_version, manifest.schema_version, dbSize, dbSha256, manifest.created_at);
        } catch {
          // Antes de v7 la tabla backup_history puede no existir aún
        }

        pruneBackups(retention);
        return manifest;
      } catch (err) {
        fs.rmSync(packageDir, { recursive: true, force: true });
        if (err instanceof NexusError) throw err;
        throw new NexusError(ERROR_CODES.PERSISTENCE_ERROR, `Error creando respaldo: ${err.message}`);
      }
    },

    listBackups() {
      if (!fs.existsSync(backupDir)) return [];
      return fs.readdirSync(backupDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && fs.existsSync(path.join(backupDir, d.name, 'manifest.json')))
        .map(d => {
          const manifestPath = path.join(backupDir, d.name, 'manifest.json');
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          return { ...manifest, location: path.join(backupDir, d.name) };
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    getBackup(id) {
      const { dirPath, manifestPath } = resolveManifestPath(id);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return { ...manifest, location: dirPath };
    },

    getBackupMetadata(id) {
      return this.getBackup(id);
    },

    verifyBackup(id) {
      const { dirPath, manifestPath } = resolveManifestPath(id);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const dbPath = path.join(dirPath, manifest.database?.file ?? 'nexus-lunar.sqlite');
      const errors = [];

      if (!fs.existsSync(dbPath)) {
        errors.push('Archivo de base de datos ausente en el paquete.');
      } else {
        const actualHash = sha256File(dbPath);
        if (actualHash !== manifest.database?.sha256) {
          errors.push('Hash SHA-256 de la base de datos no coincide con el manifiesto.');
        }
        const integrity = checkSqliteFileIntegrity(dbPath);
        if (!integrity.ok) {
          errors.push(`PRAGMA integrity_check/foreign_key_check fallido: ${JSON.stringify(integrity)}`);
        }
      }

      const filesRoot = path.join(dirPath, 'files');
      const manifestNames = new Set();
      for (const fileInfo of manifest.files ?? []) {
        try {
          const fPath = resolveInsideRoot(filesRoot, fileInfo.name);
          manifestNames.add(fileInfo.name);
          if (!fs.existsSync(fPath)) {
            errors.push(`Archivo asociado faltante: ${fileInfo.name}`);
          } else {
            const actualSize = fs.statSync(fPath).size;
            if (fileInfo.size_bytes !== undefined && actualSize !== fileInfo.size_bytes) {
              errors.push(`Tamaño alterado en archivo asociado: ${fileInfo.name}`);
            }
            if (sha256File(fPath) !== fileInfo.sha256) {
              errors.push(`Hash SHA-256 alterado en archivo asociado: ${fileInfo.name}`);
            }
          }
        } catch (err) {
          errors.push(`Ruta inválida en manifiesto (${fileInfo.name}): ${err.message}`);
        }
      }

      if (fs.existsSync(filesRoot)) {
        const diskFiles = listFilesRecursiveRelative(filesRoot);
        for (const df of diskFiles) {
          if (!manifestNames.has(df.relativePath)) {
            errors.push(`Archivo no declarado en manifiesto dentro del respaldo: ${df.relativePath}`);
          }
        }
      }

      return {
        id: manifest.id,
        ok: errors.length === 0,
        schema_version: manifest.schema_version,
        app_version: manifest.app_version,
        files_verified: (manifest.files ?? []).length,
        errors,
      };
    },

    deleteBackup(id, { allowDeleteLast = false } = {}) {
      const { dirPath } = resolveManifestPath(id);
      const all = this.listBackups();
      if (all.length <= 1 && !allowDeleteLast) {
        throw new NexusError(
          ERROR_CODES.CONFLICT,
          'No se puede eliminar la última copia de respaldo recuperable sin decisión explícita.',
          { remediation: 'Crea un respaldo nuevo o confirma allowDeleteLast: true.' }
        );
      }
      fs.rmSync(dirPath, { recursive: true, force: true });
      return { id, deleted: true };
    },
  };
}
