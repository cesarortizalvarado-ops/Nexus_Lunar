export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
  INTEGRITY_ERROR: 'INTEGRITY_ERROR',
  PERSISTENCE_ERROR: 'PERSISTENCE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  OPERATION_FAILED: 'OPERATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

const HTTP_STATUS_MAP = Object.freeze({
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PERMISSION_DENIED: 403,
  DEPENDENCY_ERROR: 424,
  INTEGRITY_ERROR: 422,
  PERSISTENCE_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  OPERATION_FAILED: 500,
  UNKNOWN_ERROR: 500,
});

export class NexusError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'NexusError';
    this.code = ERROR_CODES[code] ?? ERROR_CODES.UNKNOWN_ERROR;
    this.field = options.field ?? null;
    this.entity = options.entity ?? null;
    this.modified = Boolean(options.modified ?? false);
    this.retryable = Boolean(options.retryable ?? false);
    this.remediation = options.remediation ?? null;
    this.details = options.details ?? null;
    this.statusCode = options.statusCode ?? HTTP_STATUS_MAP[this.code] ?? 500;
  }

  toJSON() {
    return {
      code: this.code,
      description: this.message,
      field: this.field,
      entity: this.entity,
      modified: this.modified,
      retryable: this.retryable,
      remediation: this.remediation,
      details: this.details,
    };
  }
}

export function normalizeError(err) {
  if (err instanceof NexusError) return err;
  if (err?.name === 'ValidationError') {
    return new NexusError(ERROR_CODES.VALIDATION_ERROR, err.message, {
      details: err.errors ?? null,
      remediation: 'Corrige los campos inválidos y vuelve a intentarlo.',
    });
  }
  if (err?.name === 'NotFoundError') {
    return new NexusError(ERROR_CODES.NOT_FOUND, err.message, {
      remediation: 'Verifica que la entidad exista.',
    });
  }
  if (err?.code === 'SQLITE_CONSTRAINT' || String(err?.message ?? '').includes('constraint')) {
    return new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'Violación de restricción de integridad en persistencia.', {
      remediation: 'Verifica referencias, unicidad y valores permitidos.',
    });
  }
  if (err?.code && String(err.code).startsWith('ERR_SQLITE')) {
    return new NexusError(ERROR_CODES.PERSISTENCE_ERROR, err.message || 'Error de persistencia SQLite.', {
      remediation: 'Inspecciona el estado de salud del almacenamiento (storageHealthService.inspectHealth).',
    });
  }
  return new NexusError(
    ERROR_CODES.UNKNOWN_ERROR,
    err?.statusCode ? err.message : (err?.message || 'Error interno no clasificado.'),
    { statusCode: err?.statusCode ?? 500 }
  );
}
