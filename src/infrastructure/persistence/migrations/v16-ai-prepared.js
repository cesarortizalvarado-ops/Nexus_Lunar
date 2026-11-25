export const migrationV16AIPrepared = {
  version: 16,
  name: 'ai_prepared_infrastructure',
  description: 'Infraestructura contractual de IA preparada (sin modelos reales): providers, conversations, messages, contexts, tool_requests, operation_proposals, authorizations',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      provider_type TEXT NOT NULL CHECK(provider_type IN ('LOCAL','REMOTE','CUSTOM')),
      connection_mode TEXT NOT NULL DEFAULT 'DISABLED',
      configuration_reference TEXT,
      status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','UNAVAILABLE')),
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      conversation_type TEXT NOT NULL DEFAULT 'GENERAL',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      context_reference TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK(role IN ('USER','ASSISTANT','SYSTEM','TOOL')),
      content TEXT NOT NULL,
      provider_id TEXT REFERENCES ai_providers(id) ON DELETE RESTRICT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);

    CREATE TABLE IF NOT EXISTS ai_contexts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE RESTRICT,
      context_type TEXT NOT NULL DEFAULT 'CONTROLLED_SNAPSHOT',
      included_references_json TEXT NOT NULL DEFAULT '[]',
      privacy_policy_json TEXT NOT NULL DEFAULT '{}',
      creation_time TEXT NOT NULL,
      expiration TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_tool_requests (
      id TEXT PRIMARY KEY,
      conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE RESTRICT,
      tool_name TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      requested_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('VALIDATED','REJECTED','EXECUTED','FAILED'))
    );

    CREATE TABLE IF NOT EXISTS ai_operation_proposals (
      id TEXT PRIMARY KEY,
      request_id TEXT REFERENCES ai_tool_requests(id) ON DELETE RESTRICT,
      operation_type TEXT NOT NULL,
      target_entity TEXT NOT NULL,
      proposed_changes_json TEXT NOT NULL DEFAULT '{}',
      explanation TEXT NOT NULL DEFAULT '',
      authorization_status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(authorization_status IN ('PROPOSED','VALIDATED','AUTHORIZED','REJECTED','EXECUTED','FAILED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_authorizations (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES ai_operation_proposals(id) ON DELETE RESTRICT,
      authorization_type TEXT NOT NULL DEFAULT 'EXPLICIT_USER',
      authorized_at TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      expiration TEXT,
      scope TEXT NOT NULL
    );
  `,
};
