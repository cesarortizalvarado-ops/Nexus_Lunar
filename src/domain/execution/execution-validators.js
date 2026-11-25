import { EXECUTION_STATUSES, OUTCOME_TYPES } from '../shared/enums.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

export function validateExecutionInput(input) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Ejecución inválida.');
  if (!input.related_entity_type || !input.related_entity_id) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'related_entity_type y related_entity_id son obligatorios.');
  }
  if (input.execution_status !== undefined && !EXECUTION_STATUSES.includes(input.execution_status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `execution_status inválido: ${input.execution_status}`);
  }
}

export function validateOutcomeInput(input, partial = false) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Resultado inválido.');
  if (!partial && !input.execution_id) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'execution_id es obligatorio en Outcome.', { field: 'execution_id' });
  }
  if (!partial || input.outcome_type !== undefined) {
    if (!OUTCOME_TYPES.includes(input.outcome_type)) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `outcome_type inválido: ${input.outcome_type}`, { field: 'outcome_type' });
    }
  }
}

export function validateObservationInput(input) {
  if (!input || typeof input !== 'object') throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Observación inválida.');
  if (!input.related_entity_type || !input.related_entity_id) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'related_entity_type y related_entity_id son obligatorios.');
  }
  if (typeof input.content !== 'string' || !input.content.trim()) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'content es obligatorio en Observation.', { field: 'content' });
  }
}
