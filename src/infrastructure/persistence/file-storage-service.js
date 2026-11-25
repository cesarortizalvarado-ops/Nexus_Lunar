import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function normalizeSafeSubPath(subPath = '') {
  if (!subPath) return '';
  if (typeof subPath !== 'string') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'subDir inválido.', { field: 'subDir' });
  }
  const normalized = subPath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.includes('\0')) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Ruta relativa insegura rechazada: ${subPath}`, { field: 'subDir' });
    }
  }
  return segments.join('/');
}

export function resolveInsideRoot(rootDir, relativePosixPath) {
  const safeRel = normalizeSafeSubPath(relativePosixPath);
  const resolvedRoot = path.resolve(rootDir);
  const full = safeRel ? path.resolve(resolvedRoot, ...safeRel.split('/')) : resolvedRoot;
  const relCheck = path.relative(resolvedRoot, full);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new NexusError(ERROR_CODES.PERMISSION_DENIED, `Intento de escape de directorio detectado: ${relativePosixPath}`);
  }
  return full;
}

export function createFileStorageService({ config, persistenceService }) {
  return {
    storeFile({ originalName, subDir = '', content, mimeType = 'application/octet-stream', sourceId = null, temporary = false }) {
      if (!originalName || typeof originalName !== 'string') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'originalName es obligatorio.', { field: 'originalName' });
      }
      const safeSubDir = normalizeSafeSubPath(subDir);
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
      const id = randomUUID();
      const ext = path.extname(path.basename(originalName)).slice(0, 16);
      const leafName = `${id}${ext}`;
      const internalName = safeSubDir ? `${safeSubDir}/${leafName}` : leafName;
      const rootDir = temporary ? config.tempDir : config.filesDir;
      const location = resolveInsideRoot(rootDir, internalName);
      fs.mkdirSync(path.dirname(location), { recursive: true });
      fs.writeFileSync(location, buffer);

      const record = {
        id,
        original_name: path.basename(originalName),
        internal_name: internalName,
        mime_type: mimeType,
        size_bytes: buffer.length,
        sha256: sha256Buffer(buffer),
        source_id: sourceId,
        location,
        is_temporary: temporary ? 1 : 0,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
      };

      const db = persistenceService.getDatabase();
      db.prepare(`
        INSERT INTO stored_files (id, original_name, internal_name, mime_type, size_bytes, sha256, source_id, location, is_temporary, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.original_name, record.internal_name, record.mime_type,
        record.size_bytes, record.sha256, record.source_id, record.location,
        record.is_temporary, record.status, record.created_at
      );

      return record;
    },

    getFileMetadata(id) {
      const db = persistenceService.getReadDatabase();
      const row = db.prepare('SELECT * FROM stored_files WHERE id = ?').get(id);
      if (!row) throw new NexusError(ERROR_CODES.NOT_FOUND, `Archivo no encontrado: ${id}`, { entity: 'StoredFile' });
      return row;
    },

    readFileContent(id) {
      const meta = this.getFileMetadata(id);
      const rootDir = meta.is_temporary ? config.tempDir : config.filesDir;
      const resolvedPath = fs.existsSync(meta.location)
        ? meta.location
        : resolveInsideRoot(rootDir, meta.internal_name);
      if (!fs.existsSync(resolvedPath)) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, `Contenido físico ausente para archivo ${id}.`);
      }
      const buffer = fs.readFileSync(resolvedPath);
      const currentHash = sha256Buffer(buffer);
      if (currentHash !== meta.sha256) {
        throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, `Integridad comprometida en archivo ${id}: huella SHA-256 no coincide.`);
      }
      return { metadata: meta, content: buffer };
    },

    listFiles({ includeTemporary = false } = {}) {
      const db = persistenceService.getReadDatabase();
      return db.prepare(`
        SELECT * FROM stored_files
        WHERE status != 'DELETED' AND (? = 1 OR is_temporary = 0)
        ORDER BY created_at DESC
      `).all(includeTemporary ? 1 : 0);
    },
  };
}
