export function createAIRepository(persistenceService) {
  return {
    insertProvider(p) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO ai_providers (id, name, provider_type, connection_mode, configuration_reference, status, capabilities_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, p.name, p.provider_type, p.connection_mode, p.configuration_reference, p.status, JSON.stringify(p.capabilities ?? []), p.created_at, p.updated_at);
      return p;
    },
    findProviderById(id) {
      const r = persistenceService.getReadDatabase().prepare('SELECT * FROM ai_providers WHERE id = ?').get(id);
      return r ? { ...r, capabilities: JSON.parse(r.capabilities_json) } : null;
    },
    listProviders() {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM ai_providers ORDER BY created_at DESC').all()
        .map(r => ({ ...r, capabilities: JSON.parse(r.capabilities_json) }));
    },
    updateProviderStatus(id, status, updatedAt) {
      persistenceService.getDatabase().prepare('UPDATE ai_providers SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id);
    },

    insertConversation(c) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO ai_conversations (id, conversation_type, status, context_reference, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(c.id, c.conversation_type, c.status, c.context_reference, c.created_at, c.updated_at);
      return c;
    },
    findConversationById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id) ?? null;
    },
    listConversations({ status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM ai_conversations WHERE (? IS NULL OR status = ?) ORDER BY updated_at DESC
      `).all(status, status);
    },
    updateConversation(c) {
      persistenceService.getDatabase().prepare('UPDATE ai_conversations SET status=?, context_reference=?, updated_at=? WHERE id=?').run(
        c.status, c.context_reference, c.updated_at, c.id
      );
      return c;
    },

    insertMessage(m) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO ai_messages (id, conversation_id, role, content, provider_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(m.id, m.conversation_id, m.role, m.content, m.provider_id, JSON.stringify(m.metadata ?? {}), m.created_at);
      return m;
    },
    listMessages(conversationId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId)
        .map(r => ({ ...r, metadata: JSON.parse(r.metadata_json) }));
    },

    insertContext(ctx) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO ai_contexts (id, conversation_id, context_type, included_references_json, privacy_policy_json, creation_time, expiration)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(ctx.id, ctx.conversation_id, ctx.context_type, JSON.stringify(ctx.included_references), JSON.stringify(ctx.privacy_policy), ctx.creation_time, ctx.expiration);
      return ctx;
    },
    findContextById(id) {
      const r = persistenceService.getReadDatabase().prepare('SELECT * FROM ai_contexts WHERE id = ?').get(id);
      return r ? { ...r, included_references: JSON.parse(r.included_references_json), privacy_policy: JSON.parse(r.privacy_policy_json) } : null;
    },

    insertToolRequest(tr) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO ai_tool_requests (id, conversation_id, tool_name, input_json, requested_at, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(tr.id, tr.conversation_id, tr.tool_name, JSON.stringify(tr.input), tr.requested_at, tr.status);
      return tr;
    },

    insertProposal(p) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO ai_operation_proposals (id, request_id, operation_type, target_entity, proposed_changes_json, explanation, authorization_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, p.request_id, p.operation_type, p.target_entity, JSON.stringify(p.proposed_changes), p.explanation, p.authorization_status, p.created_at, p.updated_at);
      return p;
    },
    findProposalById(id) {
      const r = persistenceService.getReadDatabase().prepare('SELECT * FROM ai_operation_proposals WHERE id = ?').get(id);
      return r ? { ...r, proposed_changes: JSON.parse(r.proposed_changes_json) } : null;
    },
    updateProposalStatus(id, status, updatedAt) {
      persistenceService.getDatabase().prepare('UPDATE ai_operation_proposals SET authorization_status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id);
    },

    insertAuthorization(a) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO ai_authorizations (id, proposal_id, authorization_type, authorized_at, authorized_by, expiration, scope)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(a.id, a.proposal_id, a.authorization_type, a.authorized_at, a.authorized_by, a.expiration, a.scope);
      return a;
    },
    findAuthorizationByProposal(proposalId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM ai_authorizations WHERE proposal_id = ? ORDER BY authorized_at DESC LIMIT 1').get(proposalId) ?? null;
    },
  };
}
