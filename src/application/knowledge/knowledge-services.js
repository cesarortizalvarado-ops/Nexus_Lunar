import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB

function buildAdapterMap(adaptersInput = []) {
  const map = new Map();
  if (adaptersInput instanceof Map) {
    for (const [k, v] of adaptersInput.entries()) {
      map.set(String(k).toUpperCase(), v);
    }
  } else if (Array.isArray(adaptersInput)) {
    for (const a of adaptersInput) {
      if (a?.format) map.set(String(a.format).toUpperCase(), a);
    }
  } else if (adaptersInput && typeof adaptersInput === 'object') {
    for (const [k, v] of Object.entries(adaptersInput)) {
      map.set(String(k).toUpperCase(), v);
    }
  }
  return map;
}

export function createLibraryService({ knowledgeRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createLibrary(input) {
      if (!input?.name || !input.name.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en KnowledgeLibrary.');
      const now = nowIso();
      return knowledgeRepository.insertLibrary({
        id: randomUUID(),
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        category: (input.category ?? 'general').trim(),
        version: 1,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      });
    },
    getLibrary(id) {
      const lib = knowledgeRepository.findLibraryById(id);
      if (!lib) throw new NexusError(ERROR_CODES.NOT_FOUND, `Biblioteca no encontrada: ${id}`, { entity: 'KnowledgeLibrary' });
      return lib;
    },
    listLibraries(filters = {}) { return knowledgeRepository.listLibraries(filters); },
    updateLibrary(id, patch) {
      const lib = this.getLibrary(id);
      return knowledgeRepository.updateLibrary({
        ...lib,
        name: patch.name !== undefined ? patch.name.trim() : lib.name,
        description: patch.description !== undefined ? patch.description.trim() : lib.description,
        category: patch.category !== undefined ? patch.category.trim() : lib.category,
        version: lib.version + 1,
        status: patch.status ?? lib.status,
        updated_at: nowIso(),
      });
    },
    disableLibrary(id) { return this.updateLibrary(id, { status: 'DISABLED' }); },
    enableLibrary(id) { return this.updateLibrary(id, { status: 'ACTIVE' }); },
    createCategory({ library_id = null, name, description = '', parent_id = null }) {
      if (!name || !name.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en KnowledgeCategory.');
      return knowledgeRepository.insertCategory({
        id: randomUUID(),
        library_id,
        name: name.trim(),
        description: description.trim(),
        parent_id,
        created_at: nowIso(),
      });
    },
    listCategories(libraryId = null) { return knowledgeRepository.listCategories(libraryId); },
  };
}

export function createKnowledgeDocumentService({ knowledgeRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createDocument(input) {
      if (!input?.library_id || !knowledgeRepository.findLibraryById(input.library_id)) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, 'La biblioteca indicada no existe.', { field: 'library_id' });
      }
      if (!input.title || !input.title.trim()) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'title es obligatorio en KnowledgeDocument.', { field: 'title' });
      }
      const now = nowIso();
      return knowledgeRepository.insertDocument({
        id: randomUUID(),
        library_id: input.library_id,
        category_id: input.category_id ?? null,
        title: input.title.trim(),
        description: (input.description ?? '').trim(),
        document_type: input.document_type ?? 'MARKDOWN',
        content: input.content ?? null,
        content_reference: input.content_reference ?? null,
        source_id: input.source_id ?? null,
        metadata: input.metadata ?? {},
        version: 1,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      });
    },
    getDocument(id) {
      const doc = knowledgeRepository.findDocumentById(id);
      if (!doc) throw new NexusError(ERROR_CODES.NOT_FOUND, `Documento no encontrado: ${id}`, { entity: 'KnowledgeDocument' });
      return doc;
    },
    searchDocuments(filters = {}) { return knowledgeRepository.searchDocuments(filters); },
    updateDocument(id, patch) {
      const doc = this.getDocument(id);
      return knowledgeRepository.updateDocument({
        ...doc,
        category_id: patch.category_id !== undefined ? patch.category_id : doc.category_id,
        title: patch.title !== undefined ? patch.title.trim() : doc.title,
        description: patch.description !== undefined ? patch.description.trim() : doc.description,
        document_type: patch.document_type ?? doc.document_type,
        content: patch.content !== undefined ? patch.content : doc.content,
        content_reference: patch.content_reference !== undefined ? patch.content_reference : doc.content_reference,
        metadata: patch.metadata !== undefined ? patch.metadata : doc.metadata,
        version: doc.version + 1,
        status: patch.status ?? doc.status,
        updated_at: nowIso(),
      });
    },
    relateDocument(originId, targetId, relationType = 'RELATED_TO') {
      this.getDocument(originId);
      this.getDocument(targetId);
      if (originId === targetId) throw new NexusError(ERROR_CODES.INTEGRITY_ERROR, 'Un documento no puede relacionarse consigo mismo.');
      return knowledgeRepository.insertDocumentRelation({
        id: randomUUID(),
        origin_document_id: originId,
        target_document_id: targetId,
        relation_type: relationType,
        created_at: nowIso(),
      });
    },
    archiveDocument(id) { return this.updateDocument(id, { status: 'ARCHIVED' }); },
  };
}

export function createImportService({
  knowledgeRepository,
  documentService,
  sourceService = null,
  transactionService,
  adapters = [],
  clock = null,
}) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const adapterMap = buildAdapterMap(adapters);

  return {
    registerAdapter(format, adapter) {
      adapterMap.set(String(format).toUpperCase(), adapter);
    },

    listSupportedFormats() {
      return [...adapterMap.keys()];
    },

    createImportJob({ library_id, source_format, source_reference }) {
      if (!knowledgeRepository.findLibraryById(library_id)) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, `Biblioteca no encontrada: ${library_id}`);
      }
      const fmt = String(source_format ?? '').toUpperCase();
      if (!adapterMap.has(fmt)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Formato de importación no soportado: ${source_format}`);
      }
      const job = {
        id: randomUUID(),
        library_id,
        source_format: fmt,
        source_reference,
        started_at: nowIso(),
        completed_at: null,
        status: 'PENDING',
        result_summary: {},
        errors: [],
      };
      return knowledgeRepository.insertImportJob(job);
    },

    async executeImport(jobId) {
      const job = knowledgeRepository.findImportJobById(jobId);
      if (!job) throw new NexusError(ERROR_CODES.NOT_FOUND, `ImportJob no encontrado: ${jobId}`);
      if (job.status === 'CANCELLED') throw new NexusError(ERROR_CODES.CONFLICT, 'El trabajo de importación fue cancelado.');

      const adapter = adapterMap.get(job.source_format);
      if (!fs.existsSync(job.source_reference)) {
        return knowledgeRepository.updateImportJob({
          ...job,
          completed_at: nowIso(),
          status: 'FAILED',
          result_summary: { imported_count: 0 },
          errors: [`Archivo origen no encontrado: ${job.source_reference}`],
        });
      }

      const stat = fs.statSync(job.source_reference);
      if (stat.size > MAX_IMPORT_BYTES) {
        return knowledgeRepository.updateImportJob({
          ...job,
          completed_at: nowIso(),
          status: 'FAILED',
          result_summary: { imported_count: 0 },
          errors: [`El archivo excede el tamaño máximo permitido (${MAX_IMPORT_BYTES} bytes).`],
        });
      }

      knowledgeRepository.updateImportJob({ ...job, status: 'PROCESSING' });

      try {
        const parsed = await adapter.importFile(job.source_reference);
        const importedIds = [];
        const errors = [...(parsed.errors ?? [])];

        transactionService.executeAtomicOperation(() => {
          const sourceId = sourceService && (parsed.documents ?? []).length > 0
            ? sourceService.registerSource({
              source_type: 'IMPORT',
              source_reference: job.source_reference,
              description: `Importación ${job.source_format} en biblioteca ${job.library_id}`,
            }).id
            : null;

          for (const doc of parsed.documents ?? []) {
            const created = documentService.createDocument({
              library_id: job.library_id,
              title: doc.title,
              description: doc.description,
              document_type: doc.document_type,
              content: doc.content,
              content_reference: job.source_reference,
              source_id: sourceId,
              metadata: doc.metadata,
            });
            importedIds.push(created.id);
          }
        });

        // Una importación parcial nunca se declara COMPLETED (NL-MASTER-02 §11.4)
        const status = importedIds.length === 0 && errors.length > 0
          ? 'FAILED'
          : (errors.length > 0 ? 'PARTIAL' : 'COMPLETED');

        return knowledgeRepository.updateImportJob({
          ...job,
          completed_at: nowIso(),
          status,
          result_summary: { imported_count: importedIds.length, document_ids: importedIds },
          errors,
        });
      } catch (err) {
        return knowledgeRepository.updateImportJob({
          ...job,
          completed_at: nowIso(),
          status: 'FAILED',
          result_summary: { imported_count: 0 },
          errors: [err.message],
        });
      }
    },

    getImportStatus(jobId) {
      const job = knowledgeRepository.findImportJobById(jobId);
      if (!job) throw new NexusError(ERROR_CODES.NOT_FOUND, `ImportJob no encontrado: ${jobId}`);
      return { id: job.id, status: job.status, started_at: job.started_at, completed_at: job.completed_at };
    },

    getImportResult(jobId) {
      const job = knowledgeRepository.findImportJobById(jobId);
      if (!job) throw new NexusError(ERROR_CODES.NOT_FOUND, `ImportJob no encontrado: ${jobId}`);
      return job;
    },

    cancelImport(jobId) {
      const job = knowledgeRepository.findImportJobById(jobId);
      if (!job) throw new NexusError(ERROR_CODES.NOT_FOUND, `ImportJob no encontrado: ${jobId}`);
      if (job.status === 'COMPLETED') throw new NexusError(ERROR_CODES.CONFLICT, 'No se puede cancelar una importación ya completada.');
      return knowledgeRepository.updateImportJob({ ...job, status: 'CANCELLED', completed_at: nowIso() });
    },
  };
}

export function createExportService({ knowledgeRepository, adapters = [], clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const adapterMap = buildAdapterMap(adapters);

  return {
    registerAdapter(format, adapter) {
      adapterMap.set(String(format).toUpperCase(), adapter);
    },

    listSupportedFormats() {
      return [...adapterMap.keys()];
    },

    createExportJob({ library_id, target_format, destination }) {
      if (!knowledgeRepository.findLibraryById(library_id)) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, `Biblioteca no encontrada: ${library_id}`);
      }
      const fmt = String(target_format ?? '').toUpperCase();
      if (!adapterMap.has(fmt)) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Formato de exportación no soportado: ${target_format}`);
      }
      return knowledgeRepository.insertExportJob({
        id: randomUUID(),
        library_id,
        target_format: fmt,
        destination,
        started_at: nowIso(),
        completed_at: null,
        status: 'PENDING',
        result_reference: null,
        warnings: [],
      });
    },

    async executeExport(jobId) {
      const job = knowledgeRepository.findExportJobById(jobId);
      if (!job) throw new NexusError(ERROR_CODES.NOT_FOUND, `ExportJob no encontrado: ${jobId}`);
      const adapter = adapterMap.get(job.target_format);
      knowledgeRepository.updateExportJob({ ...job, status: 'PROCESSING' });
      try {
        const docs = knowledgeRepository.searchDocuments({ library_id: job.library_id, status: 'ACTIVE', limit: 1000 });
        const out = await adapter.exportDocuments(docs, job.destination);
        return knowledgeRepository.updateExportJob({
          ...job,
          completed_at: nowIso(),
          status: 'COMPLETED',
          result_reference: out.result_reference,
          warnings: out.warnings ?? [],
        });
      } catch (err) {
        return knowledgeRepository.updateExportJob({
          ...job,
          completed_at: nowIso(),
          status: 'FAILED',
          result_reference: null,
          warnings: [err.message],
        });
      }
    },

    getExportStatus(jobId) {
      const job = knowledgeRepository.findExportJobById(jobId);
      if (!job) throw new NexusError(ERROR_CODES.NOT_FOUND, `ExportJob no encontrado: ${jobId}`);
      return { id: job.id, status: job.status, started_at: job.started_at, completed_at: job.completed_at };
    },

    getExportResult(jobId) {
      const job = knowledgeRepository.findExportJobById(jobId);
      if (!job) throw new NexusError(ERROR_CODES.NOT_FOUND, `ExportJob no encontrado: ${jobId}`);
      return job;
    },
  };
}
