import { VALID_ENTITY_TYPES } from '../../domain/shared/domain-relation.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

export function createEntityReferenceResolver({
  memoryRepository,
  personalRepository,
  timeRepository,
  executionRepository,
  financeRepository,
  inventoryRepository,
  knowledgeRepository,
  habitRoutineRepository,
  planningRepository,
  aiRepository,
} = {}) {
  const lookups = {
    memory_record: id => memoryRepository?.findMemoryById(id) ?? null,
    goal: id => personalRepository?.findGoalById(id) ?? null,
    project: id => personalRepository?.findProjectById(id) ?? null,
    task: id => personalRepository?.findTaskById(id) ?? null,
    activity: id => personalRepository?.findActivityById(id) ?? null,
    habit: id => habitRoutineRepository?.findHabitById(id) ?? null,
    routine: id => habitRoutineRepository?.findRoutineById(id) ?? null,
    routine_execution: id => habitRoutineRepository?.findRoutineExecutionById(id) ?? null,
    calendar_event: id => timeRepository?.findEventById(id) ?? null,
    commitment: id => timeRepository?.findCommitmentById(id) ?? null,
    time_block: id => timeRepository?.findTimeBlockById(id) ?? null,
    execution: id => executionRepository?.findExecutionById(id) ?? null,
    outcome: id => executionRepository?.findOutcomeById(id) ?? null,
    observation: id => executionRepository?.findObservationById(id) ?? null,
    financial_account: id => financeRepository?.findAccountById(id) ?? null,
    financial_transaction: id => financeRepository?.findTransactionById(id) ?? null,
    financial_commitment: id => financeRepository?.findCommitmentById(id) ?? null,
    budget: id => financeRepository?.findBudgetById(id) ?? null,
    reserve: id => financeRepository?.findReserveById(id) ?? null,
    product: id => inventoryRepository?.findProductById(id) ?? null,
    purchase: id => inventoryRepository?.findPurchaseById(id) ?? null,
    payment: id => inventoryRepository?.findPaymentById(id) ?? null,
    inventory: id => inventoryRepository?.findInventoryById(id) ?? null,
    consumption: id => inventoryRepository?.findConsumptionById(id) ?? null,
    knowledge_library: id => knowledgeRepository?.findLibraryById(id) ?? null,
    knowledge_document: id => knowledgeRepository?.findDocumentById(id) ?? null,
    plan: id => planningRepository?.findPlanById(id) ?? null,
    plan_version: id => planningRepository?.findPlanVersionById(id) ?? null,
    planning_proposal: id => planningRepository?.findProposalById(id) ?? null,
    ai_conversation: id => aiRepository?.findConversationById(id) ?? null,
  };

  return {
    resolve(entityType, entityId) {
      if (!entityType || !entityId) return null;
      if (!VALID_ENTITY_TYPES.has(entityType)) {
        throw new NexusError(
          ERROR_CODES.VALIDATION_ERROR,
          `Tipo de entidad referenciada no reconocido: ${entityType}`,
          { field: 'related_entity_type' }
        );
      }
      const fn = lookups[entityType];
      return fn ? fn(String(entityId)) : null;
    },

    exists(entityType, entityId) {
      return Boolean(this.resolve(entityType, entityId));
    },

    assertExists(entityType, entityId, { typeField = 'related_entity_type', idField = 'related_entity_id' } = {}) {
      if ((entityType && !entityId) || (!entityType && entityId)) {
        throw new NexusError(
          ERROR_CODES.VALIDATION_ERROR,
          `Ambos campos (${typeField} y ${idField}) deben proporcionarse juntos.`,
          { field: !entityType ? typeField : idField }
        );
      }
      if (!entityType && !entityId) return null;
      if (!VALID_ENTITY_TYPES.has(entityType)) {
        throw new NexusError(
          ERROR_CODES.VALIDATION_ERROR,
          `Tipo de entidad inválido: ${entityType}`,
          { field: typeField }
        );
      }
      const found = this.resolve(entityType, entityId);
      if (!found) {
        throw new NexusError(
          ERROR_CODES.NOT_FOUND,
          `DB-002: La entidad referenciada (${entityType}:${entityId}) no existe.`,
          { entity: entityType, field: idField }
        );
      }
      return found;
    },
  };
}
