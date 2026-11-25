import path from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function createConfig(overrides = {}) {
  const baseDataDir = path.resolve(overrides.dataDir ?? process.env.NEXUS_LUNAR_DATA_DIR ?? './data');
  const storageRoot = path.resolve(overrides.storageRoot ?? process.env.NEXUS_LUNAR_STORAGE_DIR ?? baseDataDir);
  return {
    host: overrides.host ?? process.env.NEXUS_LUNAR_HOST ?? '127.0.0.1',
    port: Number(overrides.port ?? process.env.NEXUS_LUNAR_PORT ?? 4318),
    dataDir: baseDataDir,
    dbDir: path.resolve(overrides.dbDir ?? process.env.NEXUS_LUNAR_DB_DIR ?? path.join(storageRoot, 'db')),
    filesDir: path.resolve(overrides.filesDir ?? process.env.NEXUS_LUNAR_FILES_DIR ?? path.join(storageRoot, 'files')),
    tempDir: path.resolve(overrides.tempDir ?? process.env.NEXUS_LUNAR_TEMP_DIR ?? path.join(storageRoot, 'temp')),
    logsDir: path.resolve(overrides.logsDir ?? process.env.NEXUS_LUNAR_LOGS_DIR ?? path.join(storageRoot, 'logs')),
    backupDir: path.resolve(overrides.backupDir ?? process.env.NEXUS_LUNAR_BACKUP_DIR ?? path.join(baseDataDir, '..', 'backups')),
    timezone: overrides.timezone ?? process.env.NEXUS_LUNAR_TIMEZONE ?? 'UTC',
    allowPublicBind: Boolean(overrides.allowPublicBind ?? false),
    externalTransmissionAllowed: Boolean(overrides.externalTransmissionAllowed ?? false),
    ollamaEndpoint: overrides.ollamaEndpoint ?? process.env.NEXUS_LUNAR_OLLAMA_ENDPOINT ?? process.env.OLLAMA_ENDPOINT ?? null,
    ollamaModel: overrides.ollamaModel ?? process.env.NEXUS_LUNAR_OLLAMA_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
  };
}

export function validateConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['Configuración ausente.'];
  if (!cfg.allowPublicBind && !LOOPBACK_HOSTS.has(cfg.host)) {
    errors.push(`SEC-004: host '${cfg.host}' no es loopback. Usa 127.0.0.1, localhost o ::1.`);
  }
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    errors.push('port debe ser un entero entre 1 y 65535.');
  }
  if (!cfg.dbDir || typeof cfg.dbDir !== 'string') errors.push('dbDir es obligatorio.');
  if (!cfg.backupDir || typeof cfg.backupDir !== 'string') errors.push('backupDir es obligatorio.');
  return errors;
}

export const config = createConfig();
