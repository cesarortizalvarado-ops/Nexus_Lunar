import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import {
  validateMemoryInput,
  validateMemoryCorrection,
  validateMemoryRelation,
} from '../../domain/memory/memory-validators.js';

export function createMemoryService({ memoryRepository, sourceService, transactionService, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function resolveSourceId(input) {
    if (input.source_id) {
      sourceService.getSource(input.source_id);
      return input.source_id;
    }
    const created = sourceService.registerSource({
      source_type: input.source_type ?? 'USER',
      source_reference: input.source_reference ?? null,
      description: input.source_description ?? 'Registro directo de memoria',
    });
    return created.id;
  }

  return {
    createMemory(input) {
      validateMemoryInput(input, false);
      return transactionService.executeAtomicOperation(() => {
        const sourceId = resolveSourceId(input);
        const now = nowIso();
        const record = {
          id: randomUUID(),
          information_type: input.information_type,
          content: input.content.trim(),
          summary: (input.summary ?? '').trim(),
          confidence: input.confidence !== undefined && input.confidence !== null ? Number(input.confidence) : null,
          source_id: sourceId,
          valid_from: input.valid_from ?? null,
          valid_until: input.valid_until ?? null,
          recorded_at: now,
          updated_at: now,
          status: input.status ?? 'ACTIVE',
          sensitivity: input.sensitivity ?? 'PERSONAL',
          context: input.context ?? {},
          version: 1,
          archived_at: null,
        };
        memoryRepository.insertMemory(record);
        auditService?.recordChange({
          entity_type: 'memory_record',
          entity_id: record.id,
          operation_type: 'memory.create',
          new_state: { information_type: record.information_type, status: record.status, version: 1 },
          source_id: sourceId,
        });
        return record;
      });
    },

    getMemory(id) {
      const found = memoryRepository.findMemoryById(id);
      if (!found) throw new NexusError(ERROR_CODES.NOT_FOUND, `Registro de memoria no encontrado: ${id}`, { entity: 'MemoryRecord' });
      return {
        ...found,
        evidences: memoryRepository.listEvidencesForMemory(id),
        relations: memoryRepository.listRelations(id),
      };
    },

    searchMemory(filters = {}) {
      const safeLimit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
      return memoryRepository.searchMemory({ ...filters, limit: safeLimit });
    },

    updateMemory(id, patch, { reason = 'Actualización controlada', source_id = null, source_type = 'USER' } = {}) {
      const current = memoryRepository.findMemoryById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Registro de memoria no encontrado: ${id}`);
      validateMemoryInput(patch, true);

      // INV-004: Una inferencia no puede promocionarse silenciosamente a FACT sin corrección confirmada por usuario
      if (current.information_type === 'INFERENCE' && patch.information_type === 'FACT' && source_type !== 'USER') {
        throw new NexusError(
          ERROR_CODES.INTEGRITY_ERROR,
          'INV-004: Una inferencia no se convierte automáticamente en hecho confirmado sin confirmación explícita del usuario.'
        );
      }

      return transactionService.executeAtomicOperation(() => {
        const revSourceId = source_id ?? resolveSourceId({ source_type });
        const now = nowIso();
        const updated = {
          ...current,
          information_type: patch.information_type ?? current.information_type,
          content: patch.content !== undefined ? patch.content.trim() : current.content,
          summary: patch.summary !== undefined ? patch.summary.trim() : current.summary,
          confidence: patch.confidence !== undefined ? patch.confidence : current.confidence,
          valid_from: patch.valid_from !== undefined ? patch.valid_from : current.valid_from,
          valid_until: patch.valid_until !== undefined ? patch.valid_until : current.valid_until,
          status: patch.status ?? current.status,
          sensitivity: patch.sensitivity ?? current.sensitivity,
          context: patch.context !== undefined ? patch.context : current.context,
          version: current.version + 1,
          updated_at: now,
        };
        memoryRepository.updateMemory(updated);
        memoryRepository.insertRevision({
          id: randomUUID(),
          memory_record_id: id,
          previous_version: current.version,
          new_version: updated.version,
          previous_snapshot: current,
          new_snapshot: updated,
          change_type: 'UPDATE',
          reason,
          changed_at: now,
          source_id: revSourceId,
        });
        auditService?.recordChange({
          entity_type: 'memory_record',
          entity_id: id,
          operation_type: 'memory.update',
          previous_state: { version: current.version, status: current.status },
          new_state: { version: updated.version, status: updated.status },
          source_id: revSourceId,
          reason,
        });
        return updated;
      });
    },

    correctMemory(id, correction) {
      const current = memoryRepository.findMemoryById(id);
      if (!current) throw new NexusError(ERROR_CODES.NOT_FOUND, `Registro de memoria no encontrado: ${id}`);
      validateMemoryCorrection(correction);
      if (correction.new_content !== undefined) {
        validateMemoryInput({ content: correction.new_content, information_type: correction.information_type ?? current.information_type }, true);
      }

      return transactionService.executeAtomicOperation(() => {
        const revSourceId = resolveSourceId({
          source_id: correction.source_id,
          source_type: correction.source_type ?? 'CORRECTION',
          source_description: correction.reason,
        });
        const now = nowIso();
        const nextStatus =
          correction.change_type === 'RETIRED' ? 'RETIRED'
            : correction.change_type === 'ARCHIVED' ? 'ARCHIVED'
              : (correction.status ?? current.status);

        const updated = {
          ...current,
          information_type: correction.information_type ?? current.information_type,
          content: correction.new_content !== undefined ? correction.new_content.trim() : current.content,
          summary: correction.summary !== undefined ? correction.summary.trim() : current.summary,
          valid_until: correction.change_type === 'OUTDATED' ? (correction.valid_until ?? now) : (correction.valid_until ?? current.valid_until),
          status: nextStatus,
          version: current.version + 1,
          updated_at: now,
          archived_at: nextStatus === 'ARCHIVED' ? now : current.archived_at,
        };
        memoryRepository.updateMemory(updated);
        memoryRepository.insertRevision({
          id: randomUUID(),
          memory_record_id: id,
          previous_version: current.version,
          new_version: updated.version,
          previous_snapshot: current,
          new_snapshot: updated,
          change_type: correction.change_type,
          reason: correction.reason.trim(),
          changed_at: now,
          source_id: revSourceId,
        });
        auditService?.recordChange({
          entity_type: 'memory_record',
          entity_id: id,
          operation_type: `memory.correct.${correction.change_type}`,
          previous_state: { version: current.version, status: current.status },
          new_state: { version: updated.version, status: updated.status },
          source_id: revSourceId,
          reason: correction.reason.trim(),
        });
        return updated;
      });
    },

    relateMemory(input) {
      validateMemoryRelation(input);
      this.getMemory(input.origin_record_id);
      this.getMemory(input.target_record_id);
      const rel = {
        id: randomUUID(),
        origin_record_id: input.origin_record_id,
        target_record_id: input.target_record_id,
        relation_type: input.relation_type,
        created_at: nowIso(),
        source_id: input.source_id ?? null,
      };
      return memoryRepository.insertRelation(rel);
    },

    retireMemory(id, { reason = 'Retirado de uso activo', source_id = null } = {}) {
      return this.correctMemory(id, { change_type: 'RETIRED', reason, source_id, source_type: 'USER' });
    },

    archiveMemory(id, { reason = 'Archivado por usuario', source_id = null } = {}) {
      return this.correctMemory(id, { change_type: 'ARCHIVED', reason, source_id, source_type: 'USER' });
    },

    getMemoryHistory(id) {
      this.getMemory(id);
      return memoryRepository.listRevisions(id);
    },
  };
}
