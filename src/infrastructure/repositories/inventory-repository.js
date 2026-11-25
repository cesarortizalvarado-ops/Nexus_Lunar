export function createInventoryRepository(persistenceService) {
  return {
    insertProduct(p) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO products (id, name, description, category, unit, reference_price_minor, currency, minimum_quantity, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, p.name, p.description, p.category, p.unit, p.reference_price_minor, p.currency, p.minimum_quantity, p.status, p.created_at, p.updated_at);
      return p;
    },
    findProductById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM products WHERE id = ?').get(id) ?? null;
    },
    listProducts({ status = null, category = null, q = null } = {}) {
      const s = q?.trim() ? `%${q.trim()}%` : null;
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM products
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR category = ?) AND (? IS NULL OR name LIKE ? OR description LIKE ?)
        ORDER BY name ASC
      `).all(status, status, category, category, s, s, s);
    },
    updateProduct(p) {
      persistenceService.getDatabase().prepare(`
        UPDATE products SET name=?, description=?, category=?, unit=?, reference_price_minor=?, currency=?, minimum_quantity=?, status=?, updated_at=? WHERE id=?
      `).run(p.name, p.description, p.category, p.unit, p.reference_price_minor, p.currency, p.minimum_quantity, p.status, p.updated_at, p.id);
      return p;
    },

    insertPurchase(p) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO purchases (id, purchase_date, supplier, total_amount_minor, currency, scale, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.id, p.purchase_date, p.supplier, p.total_amount_minor, p.currency, p.scale, p.status, p.notes, p.created_at, p.updated_at);
      return p;
    },
    insertPurchaseItem(item) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO purchase_items (id, purchase_id, product_id, quantity, unit, unit_price_minor, total_price_minor, received_quantity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(item.id, item.purchase_id, item.product_id, item.quantity, item.unit, item.unit_price_minor, item.total_price_minor, item.received_quantity);
      return item;
    },
    findPurchaseById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM purchases WHERE id = ?').get(id) ?? null;
    },
    listPurchaseItems(purchaseId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchaseId);
    },
    listPurchases({ status = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM purchases WHERE (? IS NULL OR status = ?) ORDER BY purchase_date DESC
      `).all(status, status);
    },
    updatePurchase(p) {
      persistenceService.getDatabase().prepare(`
        UPDATE purchases SET supplier=?, total_amount_minor=?, status=?, notes=?, updated_at=? WHERE id=?
      `).run(p.supplier, p.total_amount_minor, p.status, p.notes, p.updated_at, p.id);
      return p;
    },
    updatePurchaseItemReceived(itemId, receivedQuantity) {
      persistenceService.getDatabase().prepare('UPDATE purchase_items SET received_quantity = ? WHERE id = ?').run(receivedQuantity, itemId);
    },

    insertPayment(pay) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO payments (id, amount_minor, currency, scale, paid_at, payment_method, related_purchase_id, corrected_payment_id, reason, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(pay.id, pay.amount_minor, pay.currency, pay.scale, pay.paid_at, pay.payment_method, pay.related_purchase_id, pay.corrected_payment_id, pay.reason, pay.status, pay.created_at);
      return pay;
    },
    findPaymentById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM payments WHERE id = ?').get(id) ?? null;
    },
    listPayments({ related_purchase_id = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM payments WHERE (? IS NULL OR related_purchase_id = ?) ORDER BY paid_at DESC
      `).all(related_purchase_id, related_purchase_id);
    },
    updatePaymentStatus(id, status) {
      persistenceService.getDatabase().prepare('UPDATE payments SET status = ? WHERE id = ?').run(status, id);
    },

    findInventoryById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM inventories WHERE id = ?').get(id) ?? null;
    },
    findInventoryByProductAndLocation(productId, location = 'default') {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM inventories WHERE product_id = ? AND location = ?').get(productId, location) ?? null;
    },
    listInventories({ product_id = null, location = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM inventories WHERE (? IS NULL OR product_id = ?) AND (? IS NULL OR location = ?) ORDER BY updated_at DESC
      `).all(product_id, product_id, location, location);
    },
    upsertInventory(inv) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO inventories (id, product_id, location, quantity, unit, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id, location) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
      `).run(inv.id, inv.product_id, inv.location, inv.quantity, inv.unit, inv.updated_at);
      return this.findInventoryByProductAndLocation(inv.product_id, inv.location);
    },
    insertInventoryMovement(m) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO inventory_movements (id, inventory_id, product_id, movement_type, quantity_delta, unit, cause, reference_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(m.id, m.inventory_id, m.product_id, m.movement_type, m.quantity_delta, m.unit, m.cause, m.reference_id ?? null, m.occurred_at);
      return m;
    },
    listInventoryMovements({ product_id = null, limit = 100 } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM inventory_movements WHERE (? IS NULL OR product_id = ?) ORDER BY occurred_at DESC LIMIT ?
      `).all(product_id, product_id, limit);
    },

    insertConsumption(c) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO consumptions (id, product_id, location, quantity, unit, consumed_at, related_activity_id, corrected_consumption_id, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(c.id, c.product_id, c.location, c.quantity, c.unit, c.consumed_at, c.related_activity_id, c.corrected_consumption_id, c.notes, c.status);
      return c;
    },
    findConsumptionById(id) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM consumptions WHERE id = ?').get(id) ?? null;
    },
    listConsumptions({ product_id = null, from = null, to = null } = {}) {
      return persistenceService.getReadDatabase().prepare(`
        SELECT * FROM consumptions
        WHERE status != 'CORRECTED'
          AND (? IS NULL OR product_id = ?)
          AND (? IS NULL OR consumed_at >= ?)
          AND (? IS NULL OR consumed_at <= ?)
        ORDER BY consumed_at DESC
      `).all(product_id, product_id, from, from, to, to);
    },
    updateConsumptionStatus(id, status) {
      persistenceService.getDatabase().prepare('UPDATE consumptions SET status = ? WHERE id = ?').run(status, id);
    },

    upsertReplenishmentCycle(rc) {
      persistenceService.getDatabase().prepare(`
        INSERT INTO replenishment_cycles (id, product_id, average_daily_consumption, minimum_quantity, estimated_replenishment_date, cycle_status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET
          average_daily_consumption = excluded.average_daily_consumption,
          minimum_quantity = excluded.minimum_quantity,
          estimated_replenishment_date = excluded.estimated_replenishment_date,
          cycle_status = excluded.cycle_status,
          updated_at = excluded.updated_at
      `).run(rc.id, rc.product_id, rc.average_daily_consumption, rc.minimum_quantity, rc.estimated_replenishment_date, rc.cycle_status, rc.updated_at);
      return this.findReplenishmentCycle(rc.product_id);
    },
    findReplenishmentCycle(productId) {
      return persistenceService.getReadDatabase().prepare('SELECT * FROM replenishment_cycles WHERE product_id = ?').get(productId) ?? null;
    },
  };
}
