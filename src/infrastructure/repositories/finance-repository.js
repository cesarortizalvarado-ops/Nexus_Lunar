export function createFinanceRepository(persistenceService) {
  return {
    insertAccount(a) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO financial_accounts (id, name, account_type, currency, scale, confirmed_balance_minor, confirmed_balance_at, spendable, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(a.id, a.name, a.account_type, a.currency, a.scale, a.confirmed_balance_minor, a.confirmed_balance_at, a.spendable ? 1 : 0, a.status, a.created_at, a.updated_at);
      return a;
    },
    findAccountById(id) {
      const r = persistenceService.getReadDatabase().prepare('SELECT * FROM financial_accounts WHERE id = ?').get(id);
      return r ? { ...r, spendable: Boolean(r.spendable) } : null;
    },
    listAccounts({ status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM financial_accounts WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC
      `).all(status, status).map(r => ({ ...r, spendable: Boolean(r.spendable) }));
    },
    updateAccount(a) {
      persistenceService.getDatabase().prepare(`
        UPDATE financial_accounts SET name=?, account_type=?, confirmed_balance_minor=?, confirmed_balance_at=?, spendable=?, status=?, updated_at=?
        WHERE id=?
      `).run(a.name, a.account_type, a.confirmed_balance_minor, a.confirmed_balance_at, a.spendable ? 1 : 0, a.status, a.updated_at, a.id);
      return a;
    },

    insertTransaction(tx) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO financial_transactions (
          id, transaction_type, amount_minor, currency, scale, occurred_at, account_id, counterparty_account_id,
          category, description, related_entity_type, related_entity_id, corrected_transaction_id, reason, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tx.id, tx.transaction_type, tx.amount_minor, tx.currency, tx.scale, tx.occurred_at, tx.account_id, tx.counterparty_account_id,
        tx.category, tx.description, tx.related_entity_type, tx.related_entity_id, tx.corrected_transaction_id, tx.reason, tx.status, tx.created_at
      );
      return tx;
    },
    findTransactionById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM financial_transactions WHERE id = ?').get(id) ?? null;
    },
    listTransactions({ account_id = null, transaction_type = null, category = null, from = null, to = null, includeVoided = false } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM financial_transactions
        WHERE (? = 1 OR status != 'VOIDED')
          AND (? IS NULL OR account_id = ? OR counterparty_account_id = ?)
          AND (? IS NULL OR transaction_type = ?)
          AND (? IS NULL OR category = ?)
          AND (? IS NULL OR occurred_at >= ?)
          AND (? IS NULL OR occurred_at <= ?)
        ORDER BY occurred_at DESC
      `).all(
        includeVoided ? 1 : 0,
        account_id, account_id, account_id,
        transaction_type, transaction_type,
        category, category,
        from, from, to, to
      );
    },
    updateTransactionStatus(id, status) {
      persistenceService.getDatabase().prepare('UPDATE financial_transactions SET status = ? WHERE id = ?').run(status, id);
    },

    insertBudget(b) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO budgets (id, name, period_start, period_end, amount_minor, currency, scale, category, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(b.id, b.name, b.period_start, b.period_end, b.amount_minor, b.currency, b.scale, b.category, b.status, b.created_at, b.updated_at);
      return b;
    },
    findBudgetById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM budgets WHERE id = ?').get(id) ?? null;
    },
    updateBudget(b) {
      persistenceService.getDatabase().prepare(`
        UPDATE budgets SET name=?, period_start=?, period_end=?, amount_minor=?, category=?, status=?, updated_at=? WHERE id=?
      `).run(b.name, b.period_start, b.period_end, b.amount_minor, b.category, b.status, b.updated_at, b.id);
      return b;
    },

    insertReserve(r) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO reserves (id, name, amount_minor, currency, scale, purpose, status, related_entity_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(r.id, r.name, r.amount_minor, r.currency, r.scale, r.purpose, r.status, r.related_entity_id, r.created_at, r.updated_at);
      return r;
    },
    findReserveById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM reserves WHERE id = ?').get(id) ?? null;
    },
    listReserves({ status = null, currency = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM reserves WHERE (? IS NULL OR status = ?) AND (? IS NULL OR currency = ?) ORDER BY created_at DESC
      `).all(status, status, currency, currency);
    },
    updateReserve(r) {
      persistenceService.getDatabase().prepare(`
        UPDATE reserves SET name=?, amount_minor=?, purpose=?, status=?, updated_at=? WHERE id=?
      `).run(r.name, r.amount_minor, r.purpose, r.status, r.updated_at, r.id);
      return r;
    },

    insertCommitment(c) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO financial_commitments (id, description, amount_minor, currency, scale, due_date, status, related_entity_id, settled_transaction_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(c.id, c.description, c.amount_minor, c.currency, c.scale, c.due_date, c.status, c.related_entity_id, c.settled_transaction_id, c.created_at, c.updated_at);
      return c;
    },
    findCommitmentById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM financial_commitments WHERE id = ?').get(id) ?? null;
    },
    listCommitments({ status = null, currency = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM financial_commitments WHERE (? IS NULL OR status = ?) AND (? IS NULL OR currency = ?) ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC
      `).all(status, status, currency, currency);
    },
    updateCommitment(c) {
      persistenceService.getDatabase().prepare(`
        UPDATE financial_commitments SET description=?, amount_minor=?, due_date=?, status=?, settled_transaction_id=?, updated_at=? WHERE id=?
      `).run(c.description, c.amount_minor, c.due_date, c.status, c.settled_transaction_id, c.updated_at, c.id);
      return c;
    },
  };
}
