export const migrationV12Knowledge = {
  version: 12,
  name: 'knowledge_libraries_domain',
  description: 'Dominio de bibliotecas de conocimiento: libraries, categories, documents, document_relations, import_jobs, export_jobs',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS knowledge_libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED','ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_categories (
      id TEXT PRIMARY KEY,
      library_id TEXT REFERENCES knowledge_libraries(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      parent_id TEXT REFERENCES knowledge_categories(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES knowledge_libraries(id) ON DELETE RESTRICT,
      category_id TEXT REFERENCES knowledge_categories(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      document_type TEXT NOT NULL DEFAULT 'MARKDOWN',
      content TEXT,
      content_reference TEXT,
      source_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kdocs_library ON knowledge_documents(library_id);
    CREATE INDEX IF NOT EXISTS idx_kdocs_status ON knowledge_documents(status);

    CREATE TABLE IF NOT EXISTS knowledge_document_relations (
      id TEXT PRIMARY KEY,
      origin_document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
      target_document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE RESTRICT,
      relation_type TEXT NOT NULL DEFAULT 'RELATED_TO',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES knowledge_libraries(id) ON DELETE RESTRICT,
      source_format TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('PENDING','PROCESSING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
      result_summary_json TEXT NOT NULL DEFAULT '{}',
      errors_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS export_jobs (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES knowledge_libraries(id) ON DELETE RESTRICT,
      target_format TEXT NOT NULL,
      destination TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
      result_reference TEXT,
      warnings_json TEXT NOT NULL DEFAULT '[]'
    );
  `,
};
