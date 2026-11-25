import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { validateSourceInput, validateEvidenceInput } from '../../domain/memory/memory-validators.js';

export function createSourceService({ memoryRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    registerSource(input) {
      validateSourceInput(input);
      const source = {
        id: input.id ?? randomUUID(),
        source_type: input.source_type,
        source_reference: input.source_reference ?? null,
        description: (input.description ?? '').trim(),
        recorded_at: nowIso(),
        reliability: input.reliability !== undefined && input.reliability !== null ? Number(input.reliability) : null,
        metadata: input.metadata ?? {},
      };
      return memoryRepository.insertSource(source);
    },

    getSource(id) {
      const found = memoryRepository.findSourceById(id);
      if (!found) throw new NexusError(ERROR_CODES.NOT_FOUND, `Fuente no encontrada: ${id}`, { entity: 'InformationSource' });
      return found;
    },

    attachEvidence(input) {
      validateEvidenceInput(input);
      this.getSource(input.source_id);
      const evidence = {
        id: randomUUID(),
        source_id: input.source_id,
        evidence_type: input.evidence_type.trim(),
        reference: input.reference ?? null,
        description: input.description.trim(),
        captured_at: nowIso(),
      };
      memoryRepository.insertEvidence(evidence);
      if (input.memory_record_id) {
        memoryRepository.attachEvidenceToMemory(input.memory_record_id, evidence.id, evidence.captured_at);
      }
      return evidence;
    },

    getEvidence(id) {
      const ev = memoryRepository.findEvidenceById(id);
      if (!ev) throw new NexusError(ERROR_CODES.NOT_FOUND, `Evidencia no encontrada: ${id}`, { entity: 'Evidence' });
      return ev;
    },

    listSources(filters = {}) {
      return memoryRepository.listSources(filters);
    },
  };
}
