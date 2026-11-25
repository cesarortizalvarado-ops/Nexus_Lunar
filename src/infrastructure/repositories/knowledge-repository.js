export function createKnowledgeRepository(persistenceService) {
  const hydrateDoc = r => (r ? { ...r, metadata: JSON.parse(r.metadata_json) } : null);
  const hydrateImport = r => (r ? { ...r, result_summary: JSON.parse(r.result_summary_json), errors: JSON.parse(r.errors_json) } : null);
  const hydrateExport = r => (r ? { ...r, warnings: JSON.parse(r.warnings_json) } : null);

  return {
    insertLibrary(lib) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO knowledge_libraries (id, name, description, category, version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lib.id, lib.name, lib.description, lib.category, lib.version, lib.status, lib.created_at, lib.updated_at);
      return lib;
    },
    findLibraryById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM knowledge_libraries WHERE id = ?').get(id) ?? null;
    },
    listLibraries({ status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM knowledge_libraries WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC
      `).all(status, status);
    },
    updateLibrary(lib) {
      persistenceService.getDatabase().prepare(`
        UPDATE knowledge_libraries SET name=?, description=?, category=?, version=?, status=?, updated_at=? WHERE id=?
      `).run(lib.name, lib.description, lib.category, lib.version, lib.status, lib.updated_at, lib.id);
      return lib;
    },

    insertCategory(cat) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO knowledge_categories (id, library_id, name, description, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
      `).run(cat.id, cat.library_id, cat.name, cat.description, cat.parent_id, cat.created_at);
      return cat;
    },
    listCategories(libraryId = null) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM knowledge_categories WHERE (? IS NULL OR library_id = ?) ORDER BY name ASC
      `).all(libraryId, libraryId);
    },

    insertDocument(doc) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO knowledge_documents (
          id, library_id, category_id, title, description, document_type, content, content_reference,
          source_id, metadata_json, version, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        doc.id, doc.library_id, doc.category_id, doc.title, doc.description, doc.document_type,
        doc.content, doc.content_reference, doc.source_id, JSON.stringify(doc.metadata ?? {}),
        doc.version, doc.status, doc.created_at, doc.updated_at
      );
      return doc;
    },
    findDocumentById(id) {
      return hydrateDoc(persistenceService.getReadDatabase().prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(id));
    },
    searchDocuments({ library_id = null, status = 'ACTIVE', document_type = null, q = null, limit = 100 } = {}) {
      const s = q?.trim() ? `%${q.trim()}%` : null;
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM knowledge_documents
        WHERE (? IS NULL OR library_id = ?)
          AND (? IS NULL OR status = ?)
          AND (? IS NULL OR document_type = ?)
          AND (? IS NULL OR title LIKE ? OR description LIKE ? OR content LIKE ?)
        ORDER BY updated_at DESC LIMIT ?
      `).all(library_id, library_id, status, status, document_type, document_type, s, s, s, s, limit).map(hydrateDoc);
    },
    updateDocument(doc) {
      persistenceService.getDatabase().prepare(`
        UPDATE knowledge_documents SET
          category_id=?, title=?, description=?, document_type=?, content=?, content_reference=?,
          metadata_json=?, version=?, status=?, updated_at=?
        WHERE id=?
      `).run(
        doc.category_id, doc.title, doc.description, doc.document_type, doc.content, doc.content_reference,
        JSON.stringify(doc.metadata ?? {}), doc.version, doc.status, doc.updated_at, doc.id
      );
      return doc;
    },
    insertDocumentRelation(rel) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO knowledge_document_relations (id, origin_document_id, target_document_id, relation_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(rel.id, rel.origin_document_id, rel.target_document_id, rel.relation_type, rel.created_at);
      return rel;
    },

    insertImportJob(job) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO import_jobs (id, library_id, source_format, source_reference, started_at, completed_at, status, result_summary_json, errors_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(job.id, job.library_id, job.source_format, job.source_reference, job.started_at, job.completed_at, job.status, JSON.stringify(job.result_summary), JSON.stringify(job.errors));
      return job;
    },
    findImportJobById(id) {
      return hydrateImport(persistenceService.getReadDatabase().prepare('SELECT * FROM import_jobs WHERE id = ?').get(id));
    },
    updateImportJob(job) {
      persistenceService.getDatabase().prepare(`
        UPDATE import_jobs SET completed_at=?, status=?, result_summary_json=?, errors_json=? WHERE id=?
      `).run(job.completed_at, job.status, JSON.stringify(job.result_summary), JSON.stringify(job.errors), job.id);
      return job;
    },

    insertExportJob(job) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO export_jobs (id, library_id, target_format, destination, started_at, completed_at, status, result_reference, warnings_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(job.id, job.library_id, job.target_format, job.destination, job.started_at, job.completed_at, job.status, job.result_reference, JSON.stringify(job.warnings));
      return job;
    },
    findExportJobById(id) {
      return hydrateExport(persistenceService.getReadDatabase().prepare('SELECT * FROM export_jobs WHERE id = ?').get(id));
    },
    updateExportJob(job) {
      persistenceService.getDatabase().prepare(`
        UPDATE export_jobs SET completed_at=?, status=?, result_reference=?, warnings_json=? WHERE id=?
      `).run(job.completed_at, job.status, job.result_reference, JSON.stringify(job.warnings), job.id);
      return job;
    },
  };
}
