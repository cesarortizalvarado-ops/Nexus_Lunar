export const migrationV11FinanceInventory = {
  version: 11,
  name: 'finance_and_inventory_domains',
  description: 'Dominios economico e inventario: cuentas, transacciones, compromisos, presupuestos, reservas, productos, compras, pagos, existencias, consumos y reposicion',
  reversible: false,
  sql: `
    CREATE TABLE IF NOT EXISTS financial_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'CHECKING',
      currency TEXT NOT NULL,
      scale INTEGER NOT NULL DEFAULT 2,
      confirmed_balance_minor INTEGER,
      confirmed_balance_at TEXT,
      spendable INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED','ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS financial_transactions (
      id TEXT PRIMARY KEY,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('INCOME','EXPENSE','TRANSFER','REFUND','ADJUSTMENT')),
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      scale INTEGER NOT NULL DEFAULT 2,
      occurred_at TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
      counterparty_account_id TEXT REFERENCES financial_accounts(id) ON DELETE RESTRICT,
      category TEXT NOT NULL DEFAULT 'general',
      description TEXT NOT NULL DEFAULT '',
      related_entity_type TEXT,
      related_entity_id TEXT,
      corrected_transaction_id TEXT REFERENCES financial_transactions(id) ON DELETE RESTRICT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','CORRECTED','VOIDED')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fintx_account ON financial_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_fintx_occurred ON financial_transactions(occurred_at);

    CREATE TABLE IF NOT EXISTS financial_commitments (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      scale INTEGER NOT NULL DEFAULT 2,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SETTLED','CANCELLED')),
      related_entity_id TEXT,
      settled_transaction_id TEXT REFERENCES financial_transactions(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      scale INTEGER NOT NULL DEFAULT 2,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED','ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reserves (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      scale INTEGER NOT NULL DEFAULT 2,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RELEASED','ARCHIVED')),
      related_entity_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      unit TEXT NOT NULL,
      reference_price_minor INTEGER,
      currency TEXT,
      minimum_quantity REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      purchase_date TEXT NOT NULL,
      supplier TEXT NOT NULL DEFAULT '',
      total_amount_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL,
      scale INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','ORDERED','RECEIVED_PARTIALLY','RECEIVED','CANCELLED')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      unit_price_minor INTEGER NOT NULL,
      total_price_minor INTEGER NOT NULL,
      received_quantity REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pitems_purchase ON purchase_items(purchase_id);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      scale INTEGER NOT NULL DEFAULT 2,
      paid_at TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'UNSPECIFIED',
      related_purchase_id TEXT REFERENCES purchases(id) ON DELETE RESTRICT,
      corrected_payment_id TEXT REFERENCES payments(id) ON DELETE RESTRICT,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('PENDING','COMPLETED','CORRECTED','REFUNDED','CANCELLED')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventories (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      location TEXT NOT NULL DEFAULT 'default',
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(product_id, location)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      inventory_id TEXT NOT NULL REFERENCES inventories(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('INITIAL','RECEIPT','CONSUMPTION','ADJUSTMENT')),
      quantity_delta REAL NOT NULL,
      unit TEXT NOT NULL,
      cause TEXT NOT NULL,
      reference_id TEXT,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON inventory_movements(product_id);

    CREATE TABLE IF NOT EXISTS consumptions (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      location TEXT NOT NULL DEFAULT 'default',
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      consumed_at TEXT NOT NULL,
      related_activity_id TEXT,
      corrected_consumption_id TEXT REFERENCES consumptions(id) ON DELETE RESTRICT,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'RECORDED' CHECK(status IN ('RECORDED','CORRECTED'))
    );
    CREATE INDEX IF NOT EXISTS idx_cons_product ON consumptions(product_id);

    CREATE TABLE IF NOT EXISTS replenishment_cycles (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL UNIQUE REFERENCES products(id) ON DELETE RESTRICT,
      average_daily_consumption REAL,
      minimum_quantity REAL NOT NULL DEFAULT 0,
      estimated_replenishment_date TEXT,
      cycle_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(cycle_status IN ('SUFFICIENT','LOW','NEEDS_REPLENISHMENT','UNKNOWN')),
      updated_at TEXT NOT NULL
    );
  `,
};
