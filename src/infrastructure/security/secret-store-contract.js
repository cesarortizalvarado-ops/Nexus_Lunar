import { ERROR_CODES, NexusError } from '../../core/errors.js';

/**
 * Contrato de SecretStore (NL-MASTER-05 §20, §53, §70; TD-07).
 *
 * ESTADO: PREPARADO PARA INTEGRACIÓN FUTURA.
 * En esta etapa NO se implementa almacenamiento real de credenciales ni gestión
 * avanzada de claves. Este módulo define exclusivamente el contrato, las
 * responsabilidades y las políticas de validación/protección que deberá cumplir
 * cualquier proveedor futuro de secretos.
 */
export const SECRET_STORE_STATUS = Object.freeze({
  state: 'PREPARED_FOR_FUTURE_INTEGRATION',
  implemented: false,
  storage_backend: null,
  policies: Object.freeze([
    'SEC-003: Ninguna credencial, clave o token se almacena en texto plano en código, configuración versionada, base de datos ordinaria, logs o conversaciones.',
    'Las claves y credenciales permanecen separadas de los datos operativos y excluidas de respaldos ordinarios.',
    'Las referencias en entidades (ej. AIProvider.configuration_reference) almacenan únicamente un identificador lógico de referencia, nunca el secreto.',
  ]),
});

const SECRET_REF_RE = /^secret:\/\/[a-z0-9._-]+\/[a-z0-9._-]+$/i;

export function isValidSecretReference(ref) {
  return typeof ref === 'string' && SECRET_REF_RE.test(ref);
}

export function createPreparedSecretStore() {
  function unavailable(operation) {
    throw new NexusError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      `SecretStore.${operation}() está preparado para integración futura; el almacenamiento real de credenciales no está habilitado en esta etapa.`,
      {
        entity: 'SecretStore',
        remediation: 'Incorpora un proveedor seguro de secretos (llavero local o gestor cifrado autorizado) en una fase futura.',
      }
    );
  }

  return {
    getStatus() {
      return { ...SECRET_STORE_STATUS };
    },

    validateReference(reference) {
      if (!isValidSecretReference(reference)) {
        throw new NexusError(
          ERROR_CODES.VALIDATION_ERROR,
          'Referencia de secreto inválida. Debe usar formato lógico secret://<espacio>/<clave>, nunca un secreto en texto plano.',
          { field: 'configuration_reference' }
        );
      }
      return true;
    },

    storeSecret() {
      return unavailable('storeSecret');
    },

    retrieveSecret() {
      return unavailable('retrieveSecret');
    },

    rotateSecret() {
      return unavailable('rotateSecret');
    },

    deleteSecret() {
      return unavailable('deleteSecret');
    },
  };
}
