import { DOMAIN_RELATION_TYPES } from './enums.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

export const ACYCLIC_RELATION_TYPES = Object.freeze(new Set([
  'DEPENDS_ON',
  'BLOCKS',
  'SUPERSEDES',
  'DERIVED_FROM',
  'BELONGS_TO',
]));

export const VALID_ENTITY_TYPES = Object.freeze(new Set([
  'memory_record',
  'goal',
  'project',
  'task',
  'activity',
  'habit',
  'routine',
  'routine_execution',
  'calendar_event',
  'commitment',
  'time_block',
  'execution',
  'outcome',
  'observation',
  'financial_account',
  'financial_transaction',
  'financial_commitment',
  'budget',
  'reserve',
  'product',
  'purchase',
  'payment',
  'inventory',
  'consumption',
  'knowledge_library',
  'knowledge_document',
  'plan',
  'plan_version',
  'planning_proposal',
  'ai_conversation',
]));

export function validateDomainRelationInput(input) {
  if (!input || typeof input !== 'object') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'La relación debe ser un objeto válido.');
  }
  const { source_entity_type, source_entity_id, target_entity_type, target_entity_id, relation_type } = input;
  if (!VALID_ENTITY_TYPES.has(source_entity_type)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `source_entity_type inválido: ${source_entity_type}`, { field: 'source_entity_type' });
  }
  if (!VALID_ENTITY_TYPES.has(target_entity_type)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `target_entity_type inválido: ${target_entity_type}`, { field: 'target_entity_type' });
  }
  if (!source_entity_id || typeof source_entity_id !== 'string') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'source_entity_id es obligatorio.', { field: 'source_entity_id' });
  }
  if (!target_entity_id || typeof target_entity_id !== 'string') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'target_entity_id es obligatorio.', { field: 'target_entity_id' });
  }
  if (!DOMAIN_RELATION_TYPES.includes(relation_type)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `relation_type inválido: ${relation_type}`, { field: 'relation_type' });
  }
  if (source_entity_type === target_entity_type && source_entity_id === target_entity_id) {
    throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'Una entidad no puede relacionarse consigo misma.');
  }
}

export function wouldCreateCycle(existingEdges, newOriginKey, newTargetKey) {
  if (newOriginKey === newTargetKey) return true;
  const adjacency = new Map();
  for (const [from, to] of existingEdges) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }
  const visited = new Set();
  const stack = [newTargetKey];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === newOriginKey) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const next = adjacency.get(current) ?? [];
    for (const node of next) stack.push(node);
  }
  return false;
}
