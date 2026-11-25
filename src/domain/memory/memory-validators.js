import {
  MEMORY_INFORMATION_TYPES,
  MEMORY_STATUSES,
  MEMORY_CHANGE_TYPES,
  SOURCE_TYPES,
  SENSITIVITY_LEVELS,
} from '../shared/enums.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

export const MEMORY_RELATION_TYPES = Object.freeze([
  'CONFIRMS',
  'CONTRADICTS',
  'UPDATES',
  'COMPLEMENTS',
  'DERIVED_FROM',
  'RELATED_TO',
]);

export function validateSourceInput(input) {
  if (!input || typeof input !== 'object') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'La fuente debe ser un objeto.');
  }
  if (!SOURCE_TYPES.includes(input.source_type)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `source_type inválido: ${input.source_type}`, { field: 'source_type' });
  }
  if (input.reliability !== undefined && input.reliability !== null) {
    const r = Number(input.reliability);
    if (Number.isNaN(r) || r < 0 || r > 1) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'reliability debe estar entre 0 y 1.', { field: 'reliability' });
    }
  }
}

export function validateEvidenceInput(input) {
  if (!input || typeof input !== 'object') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'La evidencia debe ser un objeto.');
  }
  if (!input.source_id || typeof input.source_id !== 'string') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'source_id es obligatorio en Evidence.', { field: 'source_id' });
  }
  if (!input.evidence_type || typeof input.evidence_type !== 'string') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'evidence_type es obligatorio.', { field: 'evidence_type' });
  }
  if (!input.description || typeof input.description !== 'string' || !input.description.trim()) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'description es obligatorio en Evidence.', { field: 'description' });
  }
}

export function validateMemoryInput(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'El registro de memoria debe ser un objeto.');
  }
  if (!partial || input.information_type !== undefined) {
    if (!MEMORY_INFORMATION_TYPES.includes(input.information_type)) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `information_type inválido: ${input.information_type}`, { field: 'information_type' });
    }
  }
  if (!partial || input.content !== undefined) {
    if (typeof input.content !== 'string' || !input.content.trim()) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'content es obligatorio.', { field: 'content' });
    }
  }
  if (input.status !== undefined && !MEMORY_STATUSES.includes(input.status)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `status inválido: ${input.status}`, { field: 'status' });
  }
  if (input.confidence !== undefined && input.confidence !== null) {
    const c = Number(input.confidence);
    if (Number.isNaN(c) || c < 0 || c > 1) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'confidence debe estar entre 0 y 1.', { field: 'confidence' });
    }
  }
  if (input.sensitivity !== undefined && !SENSITIVITY_LEVELS.includes(input.sensitivity)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `sensitivity inválido: ${input.sensitivity}`, { field: 'sensitivity' });
  }
  if (input.valid_from && input.valid_until && input.valid_until < input.valid_from) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'valid_until no puede ser anterior a valid_from.', { field: 'valid_until' });
  }
}

export function validateMemoryCorrection(input) {
  if (!input || typeof input !== 'object') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'La corrección debe ser un objeto.');
  }
  if (!MEMORY_CHANGE_TYPES.includes(input.change_type)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `change_type inválido: ${input.change_type}`, { field: 'change_type' });
  }
  if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'reason es obligatorio para conservar trazabilidad de la corrección.', { field: 'reason' });
  }
}

export function validateMemoryRelation(input) {
  if (!input || typeof input !== 'object') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'La relación de memoria debe ser un objeto.');
  }
  if (!input.origin_record_id || !input.target_record_id) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'origin_record_id y target_record_id son obligatorios.');
  }
  if (input.origin_record_id === input.target_record_id) {
    throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'Un registro de memoria no puede relacionarse consigo mismo.');
  }
  if (!MEMORY_RELATION_TYPES.includes(input.relation_type)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `relation_type inválido: ${input.relation_type}`, { field: 'relation_type' });
  }
}
