import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError, normalizeError } from '../shared/errors.js';

export function createOperationRequest({
  operation_id = randomUUID(),
  operation_type,
  target = null,
  payload = {},
  source = { actor_type: 'USER', actor_id: 'local-user' },
  context = {},
  authorization = null,
  requested_at = null,
  correlation_id = randomUUID(),
  idempotency_key = null,
} = {}, clock = null) {
  return {
    operation_id,
    operation_type,
    target,
    payload: payload ?? {},
    source: source ?? { actor_type: 'USER', actor_id: 'local-user' },
    context: context ?? {},
    authorization,
    requested_at: requested_at ?? (clock ? clock.nowIso() : new Date().toISOString()),
    correlation_id,
    idempotency_key: idempotency_key ?? null,
  };
}

export function okResponse(operationId, result, { warnings = [], metadata = {} } = {}) {
  return {
    success: true,
    operation_id: operationId,
    result,
    errors: [],
    warnings,
    metadata,
  };
}

export function errorResponse(operationId, err, { warnings = [], metadata = {} } = {}) {
  const normalized = normalizeError(err);
  return {
    success: false,
    operation_id: operationId,
    result: null,
    errors: [normalized.toJSON()],
    warnings,
    metadata: {
      ...metadata,
      status_code: normalized.statusCode,
    },
  };
}

export function createOperationDispatcher({
  securityPolicyService = null,
  idempotencyStore = null,
  auditService = null,
  eventService = null,
  moduleRegistry = null,
  transactionService = null,
  clock = null,
} = {}) {
  const memoryIdempotency = new Map();
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function getCachedIdempotencyRecord(key) {
    if (!key) return null;
    if (idempotencyStore?.getRecord) {
      return idempotencyStore.getRecord(key);
    }
    if (idempotencyStore?.get) {
      const response = idempotencyStore.get(key);
      return response ? { key, operation_type: response?.metadata?.operation_type ?? null, response } : null;
    }
    return memoryIdempotency.get(key) ?? null;
  }

  function saveIdempotency(key, operationType, response) {
    if (!key) return;
    if (idempotencyStore) {
      idempotencyStore.save(key, operationType, response);
    } else {
      memoryIdempotency.set(key, { key, operation_type: operationType, response });
    }
  }

  function assertModuleAvailable(moduleId, bypassModuleCheck) {
    if (bypassModuleCheck || !moduleRegistry || !moduleId || moduleId === 'system') return;
    const mod = moduleRegistry.getModule(moduleId);
    if (mod.status !== 'AVAILABLE') {
      throw new NexusError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        `INV-013: El módulo '${moduleId}' no está disponible actualmente (estado: ${mod.status}). Sus datos permanecen intactos.`,
        {
          entity: 'Module',
          remediation: `Habilita nuevamente el módulo '${moduleId}' mediante modules.enable antes de operar sobre él.`,
        }
      );
    }
  }

  function assertRequestAndAccess(req, { kind, action, domain, module_id, sensitivity, sensitiveOperation, bypassModuleCheck }) {
    if (!req.operation_type || typeof req.operation_type !== 'string') {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'operation_type es obligatorio.', { field: 'operation_type' });
    }

    assertModuleAvailable(module_id, bypassModuleCheck);

    if (kind === 'MUTATION' && req.idempotency_key) {
      const existing = getCachedIdempotencyRecord(req.idempotency_key);
      if (existing) {
        if (existing.operation_type && existing.operation_type !== req.operation_type) {
          throw new NexusError(
            ERROR_CODES.CONFLICT,
            `idempotency_key '${req.idempotency_key}' ya fue utilizada para otra operación (${existing.operation_type}).`,
            { field: 'idempotency_key' }
          );
        }
        return {
          replayed: true,
          response: {
            ...existing.response,
            metadata: { ...(existing.response.metadata ?? {}), idempotent_replay: true },
          },
        };
      }
    }

    if (securityPolicyService) {
      const decision = securityPolicyService.evaluateAccess({
        actor: req.source,
        action,
        domain: domain ?? module_id ?? 'system',
        sensitivity,
        sensitiveOperation,
        authorization: req.authorization,
        operationType: req.operation_type,
      });
      if (!decision.allowed) {
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, decision.reason ?? 'Operación no autorizada.', {
          remediation: decision.remediation ?? 'Proporciona una autorización explícita válida.',
        });
      }
    }

    return { replayed: false, response: null };
  }

  function finalizeMutationSuccess(req, result, auditSeqBefore, { domain, module_id, auditMode, event_type }) {
    const response = okResponse(req.operation_id, result, {
      metadata: {
        operation_type: req.operation_type,
        kind: 'MUTATION',
        module_id: module_id ?? domain ?? 'system',
        correlation_id: req.correlation_id,
        completed_at: nowIso(),
      },
    });

    const entityId = req.target?.entity_id ?? result?.id ?? result?.backup_id ?? result?.proposal_id ?? 'batch';
    const entityType = req.target?.entity_type ?? domain ?? module_id ?? 'System';
    const auditSeqAfter = auditService?.getWriteSequence ? auditService.getWriteSequence() : 0;

    // Evitar registros duplicados cuando el servicio propietario ya registró el cambio detallado en audit_records
    if (auditService && auditMode !== 'NONE' && (auditMode === 'ALWAYS' || auditSeqAfter === auditSeqBefore)) {
      auditService.recordOperation({
        operation_type: req.operation_type,
        entity_type: entityType,
        entity_id: entityId,
        source_id: req.source?.actor_id ?? req.source?.actor_type ?? 'USER',
        outcome: 'SUCCESS',
        correlation_id: req.correlation_id,
      });
    }

    saveIdempotency(req.idempotency_key, req.operation_type, response);

    if (eventService && event_type) {
      eventService.publishEvent({
        event_type,
        source: req.operation_type,
        entity_type: entityType,
        entity_id: String(entityId),
        correlation_id: req.correlation_id,
        payload: {
          operation_id: req.operation_id,
          operation_type: req.operation_type,
          actor: req.source?.actor_id ?? req.source?.actor_type ?? 'USER',
        },
      });
    }

    return response;
  }

  function finalizeError(req, err, { kind, domain, module_id }) {
    const resp = errorResponse(req.operation_id, err, {
      metadata: {
        operation_type: req.operation_type ?? 'UNKNOWN',
        kind,
        module_id: module_id ?? domain ?? 'system',
        correlation_id: req.correlation_id,
        failed_at: nowIso(),
      },
    });
    if (auditService && (kind === 'MUTATION' || resp.errors[0]?.code === ERROR_CODES.PERMISSION_DENIED)) {
      try {
        auditService.recordOperation({
          operation_type: req.operation_type ?? 'UNKNOWN',
          entity_type: req.target?.entity_type ?? domain ?? module_id ?? 'System',
          entity_id: req.target?.entity_id ?? 'none',
          source_id: req.source?.actor_id ?? req.source?.actor_type ?? 'SYSTEM',
          outcome: resp.errors[0]?.code === ERROR_CODES.PERMISSION_DENIED ? 'DENIED' : 'FAILED',
          reason: `${resp.errors[0]?.code}: ${resp.errors[0]?.description}`,
          correlation_id: req.correlation_id,
          is_security_event: resp.errors[0]?.code === ERROR_CODES.PERMISSION_DENIED,
        });
      } catch {
        // Nunca ocultar el error original si falla el registro posterior al rollback
      }
    }
    return resp;
  }

  function normalizeOptions(opts = {}) {
    const action = opts.action ?? (opts.kind === 'QUERY' ? 'READ' : 'EXECUTE');
    const kind = opts.kind ?? (action === 'READ' ? 'QUERY' : 'MUTATION');
    return {
      kind,
      action,
      domain: opts.domain ?? opts.module_id ?? 'system',
      module_id: opts.module_id ?? opts.domain ?? 'system',
      sensitivity: opts.sensitivity ?? 'PERSONAL',
      sensitiveOperation: Boolean(opts.sensitiveOperation ?? false),
      atomic: opts.atomic !== undefined ? Boolean(opts.atomic) : kind === 'MUTATION',
      auditMode: opts.auditMode ?? 'AUTO',
      event_type: opts.event_type ?? null,
      bypassModuleCheck: Boolean(opts.bypassModuleCheck ?? false),
    };
  }

  return {
    execute(rawRequest, handler, rawOptions = {}) {
      const req = createOperationRequest(rawRequest, clock);
      const opts = normalizeOptions(rawOptions);
      try {
        const pre = assertRequestAndAccess(req, opts);
        if (pre.replayed) return pre.response;

        if (opts.kind === 'QUERY') {
          const result = handler(req);
          if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof result.then === 'function') {
            throw new NexusError(
              ERROR_CODES.INTEGRITY_ERROR,
              `La operación '${req.operation_type}' devolvió una promesa en execute(); usa executeAsync().`
            );
          }
          return okResponse(req.operation_id, result, {
            metadata: {
              operation_type: req.operation_type,
              kind: 'QUERY',
              module_id: opts.module_id,
              correlation_id: req.correlation_id,
              completed_at: nowIso(),
            },
          });
        }

        const runMutation = () => {
          const seqBefore = auditService?.getWriteSequence ? auditService.getWriteSequence() : 0;
          const result = handler(req);
          if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof result.then === 'function') {
            throw new NexusError(
              ERROR_CODES.INTEGRITY_ERROR,
              `La operación '${req.operation_type}' devolvió una promesa en execute(); usa executeAsync().`
            );
          }
          return finalizeMutationSuccess(req, result, seqBefore, opts);
        };

        if (opts.atomic && transactionService) {
          return transactionService.executeAtomicOperation(runMutation);
        }
        return runMutation();
      } catch (err) {
        return finalizeError(req, err, opts);
      }
    },

    async executeAsync(rawRequest, handler, rawOptions = {}) {
      const req = createOperationRequest(rawRequest, clock);
      const opts = normalizeOptions(rawOptions);
      try {
        const pre = assertRequestAndAccess(req, opts);
        if (pre.replayed) return pre.response;

        if (opts.kind === 'QUERY') {
          const result = await handler(req);
          return okResponse(req.operation_id, result, {
            metadata: {
              operation_type: req.operation_type,
              kind: 'QUERY',
              module_id: opts.module_id,
              correlation_id: req.correlation_id,
              completed_at: nowIso(),
            },
          });
        }

        const runMutationAsync = async () => {
          const seqBefore = auditService?.getWriteSequence ? auditService.getWriteSequence() : 0;
          const result = await handler(req);
          return finalizeMutationSuccess(req, result, seqBefore, opts);
        };

        if (opts.atomic && transactionService?.executeAtomicOperationAsync) {
          return await transactionService.executeAtomicOperationAsync(runMutationAsync);
        }
        return await runMutationAsync();
      } catch (err) {
        return finalizeError(req, err, opts);
      }
    },
  };
}
