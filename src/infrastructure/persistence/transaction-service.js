import { AsyncLocalStorage } from 'node:async_hooks';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

function isThenable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

export function createTransactionService(persistenceService) {
  let depth = 0;
  let asyncMutex = Promise.resolve();
  const asyncOwnerStore = new AsyncLocalStorage();

  return {
    isInTransaction() {
      return depth > 0;
    },

    getDepth() {
      return depth;
    },

    beginTransaction() {
      const db = persistenceService.getDatabase();
      if (depth === 0) {
        db.exec('BEGIN IMMEDIATE');
      } else {
        db.exec(`SAVEPOINT nl_sp_${depth}`);
      }
      depth += 1;
      return { depth };
    },

    commitTransaction() {
      const db = persistenceService.getDatabase();
      if (depth <= 0) {
        throw new NexusError(ERROR_CODES.OPERATION_FAILED, 'No existe una transacción activa para confirmar.');
      }
      depth -= 1;
      if (depth === 0) {
        db.exec('COMMIT');
      } else {
        db.exec(`RELEASE SAVEPOINT nl_sp_${depth}`);
      }
      return { depth };
    },

    rollbackTransaction() {
      const db = persistenceService.getDatabase();
      if (depth <= 0) return { depth: 0 };
      depth -= 1;
      if (depth === 0) {
        db.exec('ROLLBACK');
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT nl_sp_${depth}`);
        db.exec(`RELEASE SAVEPOINT nl_sp_${depth}`);
      }
      return { depth };
    },

    executeAtomicOperation(fn) {
      if (typeof fn !== 'function') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'executeAtomicOperation requiere una función callback.');
      }
      this.beginTransaction();
      try {
        const result = fn();
        if (isThenable(result)) {
          try { this.rollbackTransaction(); } catch { /* conservar error de contrato */ }
          throw new NexusError(
            ERROR_CODES.INTEGRITY_ERROR,
            'executeAtomicOperation no admite callbacks asíncronos ni promesas; utiliza executeAtomicOperationAsync.',
            { remediation: 'Sustituye executeAtomicOperation por executeAtomicOperationAsync para funciones async.' }
          );
        }
        this.commitTransaction();
        return result;
      } catch (err) {
        if (err?.message?.includes('executeAtomicOperation no admite callbacks asíncronos')) {
          throw err;
        }
        try { this.rollbackTransaction(); } catch { /* conservar error original */ }
        throw err;
      }
    },

    async executeAtomicOperationAsync(fn) {
      if (typeof fn !== 'function') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'executeAtomicOperationAsync requiere una función callback.');
      }

      const runBody = async () => {
        this.beginTransaction();
        try {
          const result = await fn();
          this.commitTransaction();
          return result;
        } catch (err) {
          try { this.rollbackTransaction(); } catch { /* conservar error original */ }
          throw err;
        }
      };

      // Si ya estamos dentro de una transacción asíncrona propietaria en este contexto, anidar con SAVEPOINT sin deadlock
      if (asyncOwnerStore.getStore() === true) {
        return runBody();
      }

      let release;
      const prev = asyncMutex;
      asyncMutex = new Promise(resolve => {
        release = resolve;
      });
      await prev;
      try {
        return await asyncOwnerStore.run(true, runBody);
      } finally {
        release();
      }
    },
  };
}
