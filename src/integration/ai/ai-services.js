import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../core/errors.js';
import { AI_PROVIDER_TYPES, AI_MESSAGE_ROLES } from '../../domain/shared/enums.js';

export function createAIProviderRegistry({ aiRepository, secretStore = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    registerProvider(input) {
      if (!input?.name || !input.name.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en AIProvider.');
      if (!AI_PROVIDER_TYPES.includes(input.provider_type)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `provider_type inválido: ${input.provider_type}`);
      }
      if (input.configuration_reference && secretStore) {
        secretStore.validateReference(input.configuration_reference);
      }
      const now = nowIso();
      return aiRepository.insertProvider({
        id: randomUUID(),
        name: input.name.trim(),
        provider_type: input.provider_type,
        connection_mode: input.connection_mode ?? 'CONTRACT_ONLY',
        configuration_reference: input.configuration_reference ?? null,
        status: 'INACTIVE',
        capabilities: input.capabilities ?? [],
        created_at: now,
        updated_at: now,
      });
    },

    getProvider(id) {
      const p = aiRepository.findProviderById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Proveedor de IA no encontrado: ${id}`, { entity: 'AIProvider' });
      return p;
    },

    listProviders() { return aiRepository.listProviders(); },

    activateProvider(id) {
      this.getProvider(id);
      aiRepository.updateProviderStatus(id, 'ACTIVE', nowIso());
      return this.getProvider(id);
    },

    deactivateProvider(id) {
      this.getProvider(id);
      aiRepository.updateProviderStatus(id, 'INACTIVE', nowIso());
      return this.getProvider(id);
    },

    getProviderCapabilities(id) {
      const p = this.getProvider(id);
      return { provider_id: p.id, status: p.status, capabilities: p.capabilities, real_model_connected: false };
    },
  };
}

export function createAIConversationService({ aiRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createConversation({ conversation_type = 'GENERAL', context_reference = null } = {}) {
      const now = nowIso();
      return aiRepository.insertConversation({
        id: randomUUID(),
        conversation_type,
        status: 'ACTIVE',
        context_reference,
        created_at: now,
        updated_at: now,
      });
    },

    getConversation(id) {
      const c = aiRepository.findConversationById(id);
      if (!c) throw new NexusError(ERROR_CODES.NOT_FOUND, `Conversación no encontrada: ${id}`);
      return c;
    },

    listConversations(filters = {}) { return aiRepository.listConversations(filters); },

    appendMessage(conversationId, { role, content, provider_id = null, metadata = {} }) {
      const conv = this.getConversation(conversationId);
      if (!AI_MESSAGE_ROLES.includes(role)) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `role inválido: ${role}`);
      if (typeof content !== 'string' || !content.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'content es obligatorio.');
      const now = nowIso();
      const msg = aiRepository.insertMessage({
        id: randomUUID(),
        conversation_id: conv.id,
        role,
        content: content.trim(),
        provider_id,
        metadata,
        created_at: now,
      });
      aiRepository.updateConversation({ ...conv, updated_at: now });
      return msg;
    },

    getConversationMessages(conversationId) {
      this.getConversation(conversationId);
      return aiRepository.listMessages(conversationId);
    },

    archiveConversation(conversationId) {
      const conv = this.getConversation(conversationId);
      return aiRepository.updateConversation({ ...conv, status: 'ARCHIVED', updated_at: nowIso() });
    },
  };
}

export function createAIContextService({ aiRepository, memoryContextService = null, documentService = null, securityPolicyService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    filterSensitiveInformation(items) {
      return items.filter(it => !['RESTRICTED', 'SENSITIVE'].includes(it.sensitivity));
    },

    retrieveRelevantMemory({ query = null, limit = 10 } = {}) {
      if (!memoryContextService) return [];
      const built = memoryContextService.buildContext({ query, limit, forAI: true });
      return this.filterSensitiveInformation(built.items);
    },

    retrieveRelevantDocuments({ query = null, limit = 5 } = {}) {
      if (!documentService) return [];
      return documentService.searchDocuments({ q: query, status: 'ACTIVE', limit });
    },

    prepareContext({ conversation_id = null, query = null, expiration = null } = {}) {
      const memories = this.retrieveRelevantMemory({ query, limit: 10 });
      const docs = this.retrieveRelevantDocuments({ query, limit: 5 });
      const refs = [
        ...memories.map(m => ({ type: 'memory_record', id: m.id, information_type: m.information_type, source_id: m.source_id })),
        ...docs.map(d => ({ type: 'knowledge_document', id: d.id, library_id: d.library_id })),
      ];
      const policy = securityPolicyService ? securityPolicyService.getSecurityPolicy() : { local_only_default: true };
      const ctx = aiRepository.insertContext({
        id: randomUUID(),
        conversation_id,
        context_type: 'CONTROLLED_SNAPSHOT',
        included_references: refs,
        privacy_policy: { local_only: policy.local_only_default, excluded_levels: ['SENSITIVE', 'RESTRICTED'] },
        creation_time: nowIso(),
        expiration,
      });
      return { ...ctx, memory_items: memories, document_items: docs };
    },

    getContextSources(contextId) {
      const ctx = aiRepository.findContextById(contextId);
      if (!ctx) throw new NexusError(ERROR_CODES.NOT_FOUND, `Contexto no encontrado: ${contextId}`);
      return ctx.included_references;
    },
  };
}

export function createAIToolService({ aiRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const tools = new Map();

  return {
    registerTool({ name, description, mode = 'READ_ONLY', inputSchema = {}, handler }) {
      if (!name || typeof handler !== 'function') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Herramienta IA requiere name y handler.');
      }
      tools.set(name, { name, description, mode, inputSchema, handler });
    },

    listAvailableTools() {
      return [...tools.values()].map(({ name, description, mode, inputSchema }) => ({ name, description, mode, inputSchema }));
    },

    getToolDefinition(name) {
      const t = tools.get(name);
      if (!t) throw new NexusError(ERROR_CODES.NOT_FOUND, `Herramienta no registrada: ${name}`);
      return { name: t.name, description: t.description, mode: t.mode, inputSchema: t.inputSchema };
    },

    validateToolRequest({ tool_name, input = {} }) {
      const t = tools.get(tool_name);
      if (!t) return { valid: false, reason: `Herramienta no autorizada o inexistente: ${tool_name}` };
      if (t.mode !== 'READ_ONLY') {
        return { valid: true, requires_proposal_and_authorization: true };
      }
      return { valid: true, requires_proposal_and_authorization: false };
    },

    executeAuthorizedTool({ conversation_id = null, tool_name, input = {}, authorized = false }) {
      const val = this.validateToolRequest({ tool_name, input });
      if (!val.valid) {
        aiRepository.insertToolRequest({ id: randomUUID(), conversation_id, tool_name, input, requested_at: nowIso(), status: 'REJECTED' });
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, val.reason);
      }
      if (val.requires_proposal_and_authorization && !authorized) {
        aiRepository.insertToolRequest({ id: randomUUID(), conversation_id, tool_name, input, requested_at: nowIso(), status: 'REJECTED' });
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'INV-011: Herramienta de modificación requiere propuesta validada y autorización explícita.');
      }
      const reqRecord = aiRepository.insertToolRequest({ id: randomUUID(), conversation_id, tool_name, input, requested_at: nowIso(), status: 'EXECUTED' });
      const result = tools.get(tool_name).handler(input);
      return { request_id: reqRecord.id, tool_name, result };
    },
  };
}

export function createAIOperationService({ aiRepository, transactionService = null, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const executors = new Map();

  return {
    registerOperationExecutor(operationType, fn) {
      executors.set(operationType, fn);
    },

    createOperationProposal({ request_id = null, operation_type, target_entity, proposed_changes = {}, explanation = '' }) {
      if (!operation_type || !target_entity) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'operation_type y target_entity son obligatorios.');
      }
      const now = nowIso();
      return aiRepository.insertProposal({
        id: randomUUID(),
        request_id,
        operation_type,
        target_entity,
        proposed_changes,
        explanation,
        authorization_status: 'PROPOSED',
        created_at: now,
        updated_at: now,
      });
    },

    validateOperation(proposalId) {
      const p = aiRepository.findProposalById(proposalId);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta IA no encontrada: ${proposalId}`);
      if (!executors.has(p.operation_type)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Operación no soportada por servicios del núcleo: ${p.operation_type}`);
      }
      aiRepository.updateProposalStatus(proposalId, 'VALIDATED', nowIso());
      return { proposal_id: proposalId, status: 'VALIDATED' };
    },

    requestAuthorization(proposalId, { authorized_by, expiration = null, authorization_type = 'EXPLICIT_USER', scope = null }) {
      const p = aiRepository.findProposalById(proposalId);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta IA no encontrada: ${proposalId}`);
      if (!authorized_by) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'authorized_by es obligatorio.');
      const run = () => {
        const now = nowIso();
        const auth = aiRepository.insertAuthorization({
          id: randomUUID(),
          proposal_id: proposalId,
          authorization_type,
          authorized_at: now,
          authorized_by,
          expiration,
          scope: scope ?? p.operation_type,
        });
        aiRepository.updateProposalStatus(proposalId, 'AUTHORIZED', now);
        return auth;
      };
      return transactionService ? transactionService.executeAtomicOperation(run) : run();
    },

    rejectOperation(proposalId) {
      const p = aiRepository.findProposalById(proposalId);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta IA no encontrada: ${proposalId}`);
      aiRepository.updateProposalStatus(proposalId, 'REJECTED', nowIso());
      return { proposal_id: proposalId, status: 'REJECTED' };
    },

    executeOperation(proposalId) {
      const p = aiRepository.findProposalById(proposalId);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta IA no encontrada: ${proposalId}`);
      if (p.authorization_status !== 'AUTHORIZED') {
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'INV-011 / INV-012: Una propuesta de IA no puede ejecutarse sin autorización explícita previa.');
      }
      const auth = aiRepository.findAuthorizationByProposal(proposalId);
      if (!auth || (auth.expiration && auth.expiration < nowIso())) {
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'Autorización inexistente o expirada.');
      }
      const executor = executors.get(p.operation_type);
      if (!executor) throw new NexusError(ERROR_CODES.OPERATION_FAILED, `Sin ejecutor registrado para ${p.operation_type}.`);
      try {
        const result = executor(p.proposed_changes, { authorization: auth, proposal: p });
        aiRepository.updateProposalStatus(proposalId, 'EXECUTED', nowIso());
        auditService?.recordOperation({
          operation_type: `ai.execute.${p.operation_type}`,
          entity_type: p.target_entity,
          entity_id: proposalId,
          source_id: `AI_AUTHORIZED_BY:${auth.authorized_by}`,
          outcome: 'SUCCESS',
          is_security_event: true,
        });
        return { proposal_id: proposalId, status: 'EXECUTED', result };
      } catch (err) {
        aiRepository.updateProposalStatus(proposalId, 'FAILED', nowIso());
        throw err;
      }
    },

    getOperationStatus(proposalId) {
      const p = aiRepository.findProposalById(proposalId);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Propuesta IA no encontrada: ${proposalId}`);
      return { proposal_id: p.id, status: p.authorization_status, updated_at: p.updated_at };
    },
  };
}

export function createAIInteractionService({ providerRegistry, conversationService, contextService }) {
  return {
    getAvailabilityStatus() {
      const active = providerRegistry.listProviders().filter(p => p.status === 'ACTIVE');
      return {
        status: 'PREPARED_FOR_FUTURE_INTEGRATION',
        real_model_integrated: false,
        active_providers: active.length,
        core_affected: false, // INV-018
      };
    },

    interact({ conversation_id = null, user_message }) {
      const conv = conversation_id
        ? conversationService.getConversation(conversation_id)
        : conversationService.createConversation();
      conversationService.appendMessage(conv.id, { role: 'USER', content: user_message });
      const ctx = contextService.prepareContext({ conversation_id: conv.id, query: user_message });

      // En esta etapa no existe proveedor real de LLM conectado (NL-MASTER-01 §13.4, NL-MASTER-06 §9.5)
      throw new NexusError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        'AIInteractionService está preparado contractualmente, pero no hay ningún proveedor/modelo de IA conectado en esta construcción local.',
        {
          entity: 'AIInteractionService',
          details: { conversation_id: conv.id, context_id: ctx.id, real_model_integrated: false },
          remediation: 'Opera directamente mediante los servicios del núcleo o conecta un proveedor local autorizado en una fase futura.',
        }
      );
    },
  };
}
