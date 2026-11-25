import { SENSITIVITY_LEVELS, PERMISSION_ACTIONS } from '../../domain/shared/enums.js';
import { ERROR_CODES, NexusError } from '../../core/errors.js';
import { sanitizePayload } from '../../core/event-service.js';

const SENSITIVE_ACTIONS = new Set(['DELETE', 'RESTORE', 'SHARE_EXTERNALLY']);

export function createSecurityPolicyService({ config, auditService = null } = {}) {
  const policy = {
    local_only_default: true,
    loopback_only: !config?.allowPublicBind,
    external_transmission_allowed: Boolean(config?.externalTransmissionAllowed ?? false),
    ai_direct_persistence_forbidden: true,
    secret_store_mode: 'PREPARED_FOR_FUTURE_INTEGRATION',
    sensitivity_levels: [...SENSITIVITY_LEVELS],
    permission_actions: [...PERMISSION_ACTIONS],
  };

  return {
    getSecurityPolicy() {
      return { ...policy };
    },

    classifyInformation({ entityType, defaultLevel = 'PERSONAL', explicitLevel = null } = {}) {
      if (explicitLevel) {
        if (!SENSITIVITY_LEVELS.includes(explicitLevel)) {
          throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Nivel de sensibilidad inválido: ${explicitLevel}`);
        }
        return explicitLevel;
      }
      if (['financial_account', 'financial_transaction', 'payment', 'ai_authorization'].includes(entityType)) {
        return 'SENSITIVE';
      }
      if (['knowledge_library', 'knowledge_document'].includes(entityType)) {
        return 'INTERNAL';
      }
      return SENSITIVITY_LEVELS.includes(defaultLevel) ? defaultLevel : 'PERSONAL';
    },

    validateAuthorization({ authorization, expectedOperation = null } = {}) {
      if (!authorization || typeof authorization !== 'object') {
        return { valid: false, reason: 'Autorización explícita ausente.' };
      }
      if (authorization.approved !== true) {
        return { valid: false, reason: 'La autorización no fue aprobada explícitamente.' };
      }
      if (!authorization.authorized_by) {
        return { valid: false, reason: 'Falta identificar quién autorizó la operación.' };
      }
      if (authorization.expires_at && authorization.expires_at < new Date().toISOString()) {
        return { valid: false, reason: 'La autorización ha expirado.' };
      }
      if (expectedOperation && authorization.scope && authorization.scope !== expectedOperation) {
        return { valid: false, reason: `El alcance de la autorización (${authorization.scope}) no coincide con ${expectedOperation}.` };
      }
      return { valid: true };
    },

    evaluateAccess({
      actor = { actor_type: 'USER', actor_id: 'local-user' },
      action = 'READ',
      domain = 'system',
      sensitivity = 'PERSONAL',
      sensitiveOperation = false,
      authorization = null,
      operationType = null,
    } = {}) {
      if (!PERMISSION_ACTIONS.includes(action)) {
        return { allowed: false, reason: `Acción de permiso desconocida: ${action}` };
      }

      // INV-011: La IA nunca ejecuta mutaciones ni accede a persistencia sin propuesta + autorización explícita
      if (actor?.actor_type === 'AI_ASSISTANT' && action !== 'READ') {
        const check = this.validateAuthorization({ authorization, expectedOperation: operationType });
        if (!check.valid) {
          auditService?.recordOperation({
            operation_type: operationType ?? `security.deny.${action}`,
            entity_type: domain,
            entity_id: actor?.actor_id ?? 'ai',
            source_id: actor?.actor_id ?? 'AI_ASSISTANT',
            outcome: 'DENIED',
            reason: check.reason,
            is_security_event: true,
          });
          return {
            allowed: false,
            reason: `SEC-006 / INV-011: Una operación de IA requiere autorización explícita (${check.reason})`,
          };
        }
      }

      if (action === 'SHARE_EXTERNALLY') {
        return this.evaluateExternalTransmission({
          destination: authorization?.destination ?? 'unknown',
          sensitivity,
          authorization,
          operationType,
        });
      }

      if (sensitiveOperation || SENSITIVE_ACTIONS.has(action)) {
        const check = this.validateAuthorization({ authorization, expectedOperation: operationType });
        if (!check.valid) {
          return {
            allowed: false,
            reason: `SEC-006: Operación sensible (${action}) requiere autorización explícita (${check.reason})`,
            remediation: 'Proporciona un objeto authorization aprobado con authorized_by y alcance explícito.',
          };
        }
      }

      return { allowed: true, sensitivity };
    },

    evaluateExternalTransmission({ destination = null, sensitivity = 'PERSONAL', authorization = null, operationType = 'external.transmit' } = {}) {
      // SEC-001 y SEC-002: No transmisión externa por defecto
      if (!policy.external_transmission_allowed) {
        auditService?.recordOperation({
          operation_type: operationType,
          entity_type: 'ExternalTransmission',
          entity_id: destination ?? 'unknown',
          source_id: authorization?.authorized_by ?? 'SYSTEM',
          outcome: 'BLOCKED',
          reason: 'SEC-001/SEC-002: Política local bloquea transmisiones externas por defecto.',
          is_security_event: true,
        });
        return {
          allowed: false,
          reason: 'SEC-001 / SEC-002: Transmisión externa bloqueada por política local.',
          remediation: 'Los datos personales permanecen en el entorno local salvo habilitación y autorización explícita.',
        };
      }
      if (sensitivity === 'RESTRICTED') {
        return {
          allowed: false,
          reason: 'Información clasificada como RESTRICTED no puede salir del entorno local.',
        };
      }
      const check = this.validateAuthorization({ authorization, expectedOperation: operationType });
      if (!check.valid) {
        return { allowed: false, reason: `SEC-002: ${check.reason}` };
      }
      return { allowed: true, destination, sensitivity };
    },

    sanitizeForLog(value) {
      return sanitizePayload(value);
    },
  };
}
