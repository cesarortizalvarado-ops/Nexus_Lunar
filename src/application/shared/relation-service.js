import { validateDomainRelationInput } from '../../domain/shared/domain-relation.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

export function createRelationService({
  systemRepository,
  referenceResolver,
  transactionService,
  auditService,
}) {
  return {
    createRelation(input = {}) {
      validateDomainRelationInput(input);
      if (referenceResolver) {
        referenceResolver.assertExists(input.source_entity_type, input.source_entity_id, {
          typeField: 'source_entity_type',
          idField: 'source_entity_id',
        });
        referenceResolver.assertExists(input.target_entity_type, input.target_entity_id, {
          typeField: 'target_entity_type',
          idField: 'target_entity_id',
        });
      }
      return transactionService.executeAtomicOperation(() => {
        const created = systemRepository.createRelation(input);
        auditService?.recordChange({
          entity_type: 'domain_relation',
          entity_id: created.id,
          operation_type: 'relations.create',
          new_state: created,
          source_id: input.source_id ?? 'USER',
        });
        return created;
      });
    },

    retireRelation(id, { reason = null, source_id = 'USER' } = {}) {
      if (!id || typeof id !== 'string') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'id de relación es obligatorio.', { field: 'id' });
      }
      return transactionService.executeAtomicOperation(() => {
        const retired = systemRepository.retireRelation(id);
        auditService?.recordChange({
          entity_type: 'domain_relation',
          entity_id: id,
          operation_type: 'relations.retire',
          new_state: retired,
          reason,
          source_id,
        });
        return retired;
      });
    },

    listRelations(filters = {}) {
      return systemRepository.listRelations(filters);
    },
  };
}
