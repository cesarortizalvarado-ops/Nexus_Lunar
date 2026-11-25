import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { normalizeCurrency, toMinorUnits, fromMinorUnits, assertSameCurrency } from '../../domain/finance/money.js';

export function createFinancialAccountService({ financeRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function calculateAccountBalanceMinor(accountId) {
    const txs = financeRepository.listTransactions({ account_id: accountId });
    let total = 0;
    for (const tx of txs) {
      if (tx.status === 'VOIDED' || tx.status === 'CORRECTED') continue;
      if (tx.transaction_type === 'INCOME' || tx.transaction_type === 'REFUND') {
        if (tx.account_id === accountId) total += tx.amount_minor;
      } else if (tx.transaction_type === 'EXPENSE') {
        if (tx.account_id === accountId) total -= tx.amount_minor;
      } else if (tx.transaction_type === 'ADJUSTMENT') {
        if (tx.account_id === accountId) total += tx.amount_minor;
      } else if (tx.transaction_type === 'TRANSFER') {
        if (tx.account_id === accountId) total -= tx.amount_minor;
        if (tx.counterparty_account_id === accountId) total += tx.amount_minor;
      }
    }
    return total;
  }

  return {
    createAccount(input) {
      if (!input?.name || !input.name.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio.', { field: 'name' });
      const currency = normalizeCurrency(input.currency);
      const scale = Number.isInteger(input.scale) ? input.scale : 2;
      const now = nowIso();
      const account = {
        id: randomUUID(),
        name: input.name.trim(),
        account_type: input.account_type ?? 'CHECKING',
        currency,
        scale,
        confirmed_balance_minor: input.confirmed_balance !== undefined && input.confirmed_balance !== null ? toMinorUnits(input.confirmed_balance, scale) : null,
        confirmed_balance_at: input.confirmed_balance !== undefined && input.confirmed_balance !== null ? now : null,
        spendable: input.spendable !== undefined ? Boolean(input.spendable) : true,
        status: input.status ?? 'ACTIVE',
        created_at: now,
        updated_at: now,
      };
      return financeRepository.insertAccount(account);
    },

    getAccount(id) {
      const a = financeRepository.findAccountById(id);
      if (!a) throw new NexusError(ERROR_CODES.NOT_FOUND, `Cuenta no encontrada: ${id}`, { entity: 'FinancialAccount' });
      return a;
    },

    listAccounts(filters = {}) {
      return financeRepository.listAccounts(filters);
    },

    updateAccount(id, patch) {
      const current = this.getAccount(id);
      const now = nowIso();
      const updated = {
        ...current,
        name: patch.name !== undefined ? patch.name.trim() : current.name,
        account_type: patch.account_type ?? current.account_type,
        confirmed_balance_minor: patch.confirmed_balance !== undefined
          ? (patch.confirmed_balance === null ? null : toMinorUnits(patch.confirmed_balance, current.scale))
          : current.confirmed_balance_minor,
        confirmed_balance_at: patch.confirmed_balance !== undefined ? now : current.confirmed_balance_at,
        spendable: patch.spendable !== undefined ? Boolean(patch.spendable) : current.spendable,
        status: patch.status ?? current.status,
        updated_at: now,
      };
      return financeRepository.updateAccount(updated);
    },

    getAccountBalance(id) {
      const a = this.getAccount(id);
      const calculatedMinor = calculateAccountBalanceMinor(id);
      return {
        account_id: id,
        currency: a.currency,
        spendable: a.spendable,
        calculated_balance: fromMinorUnits(calculatedMinor, a.scale),
        calculated_balance_minor: calculatedMinor,
        confirmed_balance: a.confirmed_balance_minor !== null ? fromMinorUnits(a.confirmed_balance_minor, a.scale) : null,
        confirmed_balance_at: a.confirmed_balance_at,
      };
    },
  };
}

export function createFinancialTransactionService({ financeRepository, referenceResolver = null, transactionService, auditService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  function record(type, input) {
    if (input.related_entity_type || input.related_entity_id) {
      referenceResolver?.assertExists(input.related_entity_type, input.related_entity_id);
    }
    const account = financeRepository.findAccountById(input.account_id);
    if (!account) throw new NexusError(ERROR_CODES.NOT_FOUND, `Cuenta no encontrada: ${input.account_id}`);
    const currency = input.currency ? normalizeCurrency(input.currency) : account.currency;
    assertSameCurrency(account.currency, currency);
    const amountMinor = toMinorUnits(input.amount, account.scale);
    if (type !== 'ADJUSTMENT' && amountMinor <= 0) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'amount debe ser mayor que cero.', { field: 'amount' });
    }
    if (type === 'ADJUSTMENT' && (!input.reason || !input.reason.trim())) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Los ajustes económicos requieren justificación (reason).', { field: 'reason' });
    }
    let counterparty = null;
    if (type === 'TRANSFER') {
      counterparty = financeRepository.findAccountById(input.counterparty_account_id);
      if (!counterparty) throw new NexusError(ERROR_CODES.NOT_FOUND, 'Cuenta destino de transferencia no encontrada.');
      assertSameCurrency(account.currency, counterparty.currency);
    }
    const now = nowIso();
    const tx = {
      id: randomUUID(),
      transaction_type: type,
      amount_minor: amountMinor,
      currency,
      scale: account.scale,
      occurred_at: input.occurred_at ?? now,
      account_id: account.id,
      counterparty_account_id: counterparty?.id ?? null,
      category: (input.category ?? 'general').trim(),
      description: (input.description ?? '').trim(),
      related_entity_type: input.related_entity_type ?? null,
      related_entity_id: input.related_entity_id ?? null,
      corrected_transaction_id: input.corrected_transaction_id ?? null,
      reason: input.reason?.trim() ?? null,
      status: 'POSTED',
      created_at: now,
    };
    financeRepository.insertTransaction(tx);
    auditService?.recordChange({ entity_type: 'financial_transaction', entity_id: tx.id, operation_type: `finance.${type.toLowerCase()}`, new_state: tx });
    return { ...tx, amount: fromMinorUnits(tx.amount_minor, tx.scale) };
  }

  return {
    recordIncome(input) { return record('INCOME', input); },
    recordExpense(input) { return record('EXPENSE', input); },
    recordTransfer(input) { return record('TRANSFER', input); },
    recordRefund(input) { return record('REFUND', input); },
    recordAdjustment(input) { return record('ADJUSTMENT', input); },

    getTransaction(id) {
      const tx = financeRepository.findTransactionById(id);
      if (!tx) throw new NexusError(ERROR_CODES.NOT_FOUND, `Transacción no encontrada: ${id}`);
      return { ...tx, amount: fromMinorUnits(tx.amount_minor, tx.scale) };
    },

    listTransactions(filters = {}) {
      return financeRepository.listTransactions(filters).map(tx => ({ ...tx, amount: fromMinorUnits(tx.amount_minor, tx.scale) }));
    },

    correctTransaction(id, { amount, description, category, reason }) {
      if (!reason || !reason.trim()) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'reason es obligatorio para corregir una transacción.', { field: 'reason' });
      }
      const original = financeRepository.findTransactionById(id);
      if (!original) throw new NexusError(ERROR_CODES.NOT_FOUND, `Transacción no encontrada: ${id}`);
      return transactionService.executeAtomicOperation(() => {
        // Conserva movimiento original marcado como CORRECTED y crea nuevo movimiento enlazado
        financeRepository.updateTransactionStatus(id, 'CORRECTED');
        return record(original.transaction_type, {
          account_id: original.account_id,
          counterparty_account_id: original.counterparty_account_id,
          amount: amount !== undefined ? amount : fromMinorUnits(original.amount_minor, original.scale),
          currency: original.currency,
          occurred_at: original.occurred_at,
          category: category ?? original.category,
          description: description ?? original.description,
          related_entity_type: original.related_entity_type,
          related_entity_id: original.related_entity_id,
          corrected_transaction_id: id,
          reason,
        });
      });
    },

    getFinancialSummary({ currency = null } = {}) {
      const accounts = financeRepository.listAccounts({ status: 'ACTIVE' })
        .filter(a => !currency || a.currency === currency.toUpperCase());
      const currencies = [...new Set(accounts.map(a => a.currency))];
      const byCurrency = {};

      for (const cur of currencies) {
        const curAccounts = accounts.filter(a => a.currency === cur);
        const txs = financeRepository.listTransactions({}).filter(t => t.currency === cur && t.status === 'POSTED');
        let totalIncomeMinor = 0;
        let totalExpenseMinor = 0;
        let calculatedBalanceMinor = 0;
        let spendableBalanceMinor = 0;

        const spendableIds = new Set(curAccounts.filter(a => a.spendable).map(a => a.id));
        for (const tx of txs) {
          if (tx.transaction_type === 'INCOME' || tx.transaction_type === 'REFUND') {
            totalIncomeMinor += tx.amount_minor;
            calculatedBalanceMinor += tx.amount_minor;
            if (spendableIds.has(tx.account_id)) spendableBalanceMinor += tx.amount_minor;
          } else if (tx.transaction_type === 'EXPENSE') {
            totalExpenseMinor += tx.amount_minor;
            calculatedBalanceMinor -= tx.amount_minor;
            if (spendableIds.has(tx.account_id)) spendableBalanceMinor -= tx.amount_minor;
          } else if (tx.transaction_type === 'ADJUSTMENT') {
            calculatedBalanceMinor += tx.amount_minor;
            if (spendableIds.has(tx.account_id)) spendableBalanceMinor += tx.amount_minor;
          } else if (tx.transaction_type === 'TRANSFER') {
            // Transferencias no alteran ingreso/gasto neto
            if (spendableIds.has(tx.account_id)) spendableBalanceMinor -= tx.amount_minor;
            if (spendableIds.has(tx.counterparty_account_id)) spendableBalanceMinor += tx.amount_minor;
          }
        }

        const reserves = financeRepository.listReserves({ status: 'ACTIVE', currency: cur });
        const reservedMinor = reserves.reduce((acc, r) => acc + r.amount_minor, 0);
        const commitments = financeRepository.listCommitments({ status: 'PENDING', currency: cur });
        const committedMinor = commitments.reduce((acc, c) => acc + c.amount_minor, 0);
        const availableMinor = spendableBalanceMinor - reservedMinor - committedMinor;

        byCurrency[cur] = {
          currency: cur,
          calculated_balance: fromMinorUnits(calculatedBalanceMinor, 2),
          spendable_balance: fromMinorUnits(spendableBalanceMinor, 2),
          reserved_amount: fromMinorUnits(reservedMinor, 2),
          committed_amount: fromMinorUnits(committedMinor, 2),
          available_money: fromMinorUnits(availableMinor, 2),
          total_income: fromMinorUnits(totalIncomeMinor, 2),
          total_expense: fromMinorUnits(totalExpenseMinor, 2),
        };
      }

      return { currencies: byCurrency };
    },
  };
}

export function createBudgetService({ financeRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createBudget(input) {
      if (!input?.name || !input?.category || !input?.period_start || !input?.period_end) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name, category, period_start y period_end son obligatorios.');
      }
      const currency = normalizeCurrency(input.currency);
      const now = nowIso();
      const b = {
        id: randomUUID(),
        name: input.name.trim(),
        period_start: input.period_start,
        period_end: input.period_end,
        amount_minor: toMinorUnits(input.amount, 2),
        currency,
        scale: 2,
        category: input.category.trim(),
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      };
      return financeRepository.insertBudget(b);
    },
    getBudget(id) {
      const b = financeRepository.findBudgetById(id);
      if (!b) throw new NexusError(ERROR_CODES.NOT_FOUND, `Presupuesto no encontrado: ${id}`);
      return { ...b, amount: fromMinorUnits(b.amount_minor, b.scale) };
    },
    updateBudget(id, patch) {
      const b = financeRepository.findBudgetById(id);
      if (!b) throw new NexusError(ERROR_CODES.NOT_FOUND, `Presupuesto no encontrado: ${id}`);
      return financeRepository.updateBudget({
        ...b,
        name: patch.name !== undefined ? patch.name.trim() : b.name,
        period_start: patch.period_start ?? b.period_start,
        period_end: patch.period_end ?? b.period_end,
        amount_minor: patch.amount !== undefined ? toMinorUnits(patch.amount, b.scale) : b.amount_minor,
        category: patch.category !== undefined ? patch.category.trim() : b.category,
        status: patch.status ?? b.status,
        updated_at: nowIso(),
      });
    },
    getBudgetExecution(id) {
      const b = this.getBudget(id);
      const txs = financeRepository.listTransactions({
        transaction_type: 'EXPENSE',
        category: b.category,
        from: b.period_start,
        to: b.period_end,
      }).filter(t => t.currency === b.currency && t.status === 'POSTED');
      const spentMinor = txs.reduce((acc, t) => acc + t.amount_minor, 0);
      return {
        budget_id: b.id,
        currency: b.currency,
        budgeted: fromMinorUnits(b.amount_minor, b.scale),
        spent: fromMinorUnits(spentMinor, b.scale),
        remaining: fromMinorUnits(b.amount_minor - spentMinor, b.scale),
        exceeded: spentMinor > b.amount_minor,
      };
    },
    closeBudget(id) {
      return this.updateBudget(id, { status: 'CLOSED' });
    },
  };
}

export function createReserveService({ financeRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createReserve(input) {
      if (!input?.name) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en Reserve.');
      const currency = normalizeCurrency(input.currency);
      const now = nowIso();
      return financeRepository.insertReserve({
        id: randomUUID(),
        name: input.name.trim(),
        amount_minor: toMinorUnits(input.amount, 2),
        currency,
        scale: 2,
        purpose: (input.purpose ?? '').trim(),
        status: 'ACTIVE',
        related_entity_id: input.related_entity_id ?? null,
        created_at: now,
        updated_at: now,
      });
    },
    getReserve(id) {
      const r = financeRepository.findReserveById(id);
      if (!r) throw new NexusError(ERROR_CODES.NOT_FOUND, `Reserva no encontrada: ${id}`);
      return { ...r, amount: fromMinorUnits(r.amount_minor, r.scale) };
    },
    listReserves(filters = {}) {
      return financeRepository.listReserves(filters).map(r => ({ ...r, amount: fromMinorUnits(r.amount_minor, r.scale) }));
    },
    updateReserve(id, patch) {
      const r = financeRepository.findReserveById(id);
      if (!r) throw new NexusError(ERROR_CODES.NOT_FOUND, `Reserva no encontrada: ${id}`);
      return financeRepository.updateReserve({
        ...r,
        name: patch.name !== undefined ? patch.name.trim() : r.name,
        amount_minor: patch.amount !== undefined ? toMinorUnits(patch.amount, r.scale) : r.amount_minor,
        purpose: patch.purpose !== undefined ? patch.purpose.trim() : r.purpose,
        status: patch.status ?? r.status,
        updated_at: nowIso(),
      });
    },
    releaseReserve(id) {
      return this.updateReserve(id, { status: 'RELEASED' });
    },
  };
}

export function createFinancialCommitmentService({ financeRepository, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createFinancialCommitment(input) {
      if (!input?.description) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'description es obligatorio.');
      const currency = normalizeCurrency(input.currency);
      const now = nowIso();
      return financeRepository.insertCommitment({
        id: randomUUID(),
        description: input.description.trim(),
        amount_minor: toMinorUnits(input.amount, 2),
        currency,
        scale: 2,
        due_date: input.due_date ?? null,
        status: 'PENDING',
        related_entity_id: input.related_entity_id ?? null,
        settled_transaction_id: null,
        created_at: now,
        updated_at: now,
      });
    },
    updateFinancialCommitment(id, patch) {
      const c = financeRepository.findCommitmentById(id);
      if (!c) throw new NexusError(ERROR_CODES.NOT_FOUND, `Compromiso económico no encontrado: ${id}`);
      return financeRepository.updateCommitment({
        ...c,
        description: patch.description !== undefined ? patch.description.trim() : c.description,
        amount_minor: patch.amount !== undefined ? toMinorUnits(patch.amount, c.scale) : c.amount_minor,
        due_date: patch.due_date !== undefined ? patch.due_date : c.due_date,
        status: patch.status ?? c.status,
        settled_transaction_id: patch.settled_transaction_id !== undefined ? patch.settled_transaction_id : c.settled_transaction_id,
        updated_at: nowIso(),
      });
    },
    settleFinancialCommitment(id, { settled_transaction_id = null } = {}) {
      return this.updateFinancialCommitment(id, { status: 'SETTLED', settled_transaction_id });
    },
    cancelFinancialCommitment(id) {
      return this.updateFinancialCommitment(id, { status: 'CANCELLED' });
    },
    listPendingCommitments(filters = {}) {
      return financeRepository.listCommitments({ ...filters, status: 'PENDING' })
        .map(c => ({ ...c, amount: fromMinorUnits(c.amount_minor, c.scale) }));
    },
  };
}
