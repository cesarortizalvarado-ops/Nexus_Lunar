import { ERROR_CODES, NexusError } from '../../shared/errors.js';

/**
 * Frontera contractual con CIO (NL-MASTER-01 §13.6, NL-MASTER-02 §18.8, NL-MASTER-06 §9.4).
 * CIO es un sistema independiente. Los insumos recibidos conservan procedencia
 * EXTERNAL_INTEGRATION y nunca se convierten automáticamente en hechos confirmados.
 */
export function createCIOContractBridge({ memoryService, sourceService, transactionService = null }) {
  return {
    getContractInfo() {
      return {
        name: 'CIOContractBridge',
        status: 'PREPARED_FOR_FUTURE_INTEGRATION',
        independent_from_cio: true,
        auto_promote_to_fact: false,
      };
    },

    receiveExternalSignal({ external_reference, summary, content, metadata = {} }) {
      if (!content || typeof content !== 'string' || !content.trim()) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'content es obligatorio en señal externa CIO.');
      }
      const run = () => {
        const source = sourceService.registerSource({
          source_type: 'EXTERNAL_INTEGRATION',
          source_reference: external_reference ?? 'cio://unspecified',
          description: 'Señal informativa recibida desde CIO externo',
          metadata,
        });
        // NL-MASTER-02 §18.8: se registra como HYPOTHESIS (nunca FACT confirmado automáticamente)
        return memoryService.createMemory({
          information_type: 'HYPOTHESIS',
          summary: summary ?? 'Información externa CIO',
          content,
          source_id: source.id,
          sensitivity: 'INTERNAL',
          context: { origin: 'CIO', requires_user_confirmation: true },
        });
      };
      return transactionService ? transactionService.executeAtomicOperation(run) : run();
    },
  };
}
