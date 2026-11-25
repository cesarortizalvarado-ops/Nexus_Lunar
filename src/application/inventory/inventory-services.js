import { randomUUID } from 'node:crypto';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { normalizeCurrency, toMinorUnits, fromMinorUnits } from '../../domain/finance/money.js';
import { normalizeUnit, validatePositiveQuantity, assertCompatibleUnit } from '../../domain/inventory/units.js';
import { evaluateReplenishmentNeed } from '../../domain/inventory/replenishment.js';
import { addDays } from '../../shared/clock.js';

export { evaluateReplenishmentNeed };

function computeProductReplenishmentFromRepo({ inventoryRepository, productId, windowDays = 30, referenceDate }) {
  if (!productId || typeof productId !== 'string') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'productId es obligatorio para calcular reposición.', { field: 'product_id' });
  }
  const p = inventoryRepository.findProductById(productId);
  if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Producto no encontrado: ${productId}`, { entity: 'Product' });
  const wDays = Number(windowDays ?? 30);
  if (!Number.isFinite(wDays) || wDays <= 0) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'windowDays debe ser un número positivo.', { field: 'windowDays' });
  }
  const stockRecords = inventoryRepository.listInventories({ product_id: productId });
  const fromDate = referenceDate ? `${addDays(referenceDate, -wDays)}T00:00:00.000Z` : null;
  const consumptions = inventoryRepository.listConsumptions({ product_id: productId, from: fromDate });
  return evaluateReplenishmentNeed({
    product: p,
    stock_records: stockRecords,
    consumptions,
    window_days: wDays,
    reference_date: referenceDate,
  });
}

function refreshMaterializedCycleIfPresent({ inventoryRepository, productId, referenceDate, nowIso, windowDays = 30 }) {
  const existing = inventoryRepository.findReplenishmentCycle(productId);
  if (!existing) return null;
  const calc = computeProductReplenishmentFromRepo({
    inventoryRepository,
    productId,
    windowDays,
    referenceDate,
  });
  return inventoryRepository.upsertReplenishmentCycle({
    id: existing.id,
    product_id: productId,
    average_daily_consumption: calc.average_daily_consumption,
    minimum_quantity: calc.minimum_quantity ?? 0,
    estimated_replenishment_date: calc.estimated_replenishment_date,
    cycle_status: calc.cycle_status,
    updated_at: nowIso(),
  });
}

export function createProductService({ inventoryRepository, transactionService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));
  const inTx = fn => (transactionService ? transactionService.executeAtomicOperation(fn) : fn());

  return {
    createProduct(input) {
      if (!input?.name || !input.name.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en Product.');
      const unit = normalizeUnit(input.unit);
      const currency = input.currency ? normalizeCurrency(input.currency) : null;
      const minQty = Number(input.minimum_quantity ?? 0);
      if (!Number.isFinite(minQty) || minQty < 0) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'minimum_quantity debe ser un número mayor o igual a 0.', { field: 'minimum_quantity' });
      }
      const now = nowIso();
      const product = {
        id: randomUUID(),
        name: input.name.trim(),
        description: (input.description ?? '').trim(),
        category: (input.category ?? 'general').trim(),
        unit,
        reference_price_minor: input.reference_price !== undefined && input.reference_price !== null ? toMinorUnits(input.reference_price, 2) : null,
        currency,
        minimum_quantity: minQty,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      };
      return inventoryRepository.insertProduct(product);
    },
    getProduct(id) {
      const p = inventoryRepository.findProductById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Producto no encontrado: ${id}`, { entity: 'Product' });
      return p;
    },
    listProducts(filters = {}) { return inventoryRepository.listProducts(filters); },
    updateProduct(id, patch) {
      const p = this.getProduct(id);
      const nextMinQty = patch.minimum_quantity !== undefined ? Number(patch.minimum_quantity) : p.minimum_quantity;
      if (!Number.isFinite(nextMinQty) || nextMinQty < 0) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'minimum_quantity debe ser un número mayor o igual a 0.', { field: 'minimum_quantity' });
      }
      return inTx(() => {
        const updated = inventoryRepository.updateProduct({
          ...p,
          name: patch.name !== undefined ? patch.name.trim() : p.name,
          description: patch.description !== undefined ? patch.description.trim() : p.description,
          category: patch.category !== undefined ? patch.category.trim() : p.category,
          unit: patch.unit !== undefined ? normalizeUnit(patch.unit) : p.unit,
          reference_price_minor: patch.reference_price !== undefined
            ? (patch.reference_price === null ? null : toMinorUnits(patch.reference_price, 2))
            : p.reference_price_minor,
          currency: patch.currency !== undefined ? (patch.currency ? normalizeCurrency(patch.currency) : null) : p.currency,
          minimum_quantity: nextMinQty,
          status: patch.status ?? p.status,
          updated_at: nowIso(),
        });
        if (patch.minimum_quantity !== undefined) {
          refreshMaterializedCycleIfPresent({
            inventoryRepository,
            productId: id,
            referenceDate: todayDate(),
            nowIso,
          });
        }
        return updated;
      });
    },
    archiveProduct(id) { return this.updateProduct(id, { status: 'ARCHIVED' }); },
  };
}

export function createInventoryService({ inventoryRepository, transactionService, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));

  return {
    getInventory(productId = null, location = 'default') {
      if (productId === null || productId === undefined || productId === '') {
        return inventoryRepository.listInventories({
          location: location && location !== 'default' ? location : null,
        });
      }
      if (typeof productId !== 'string') {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'productId debe ser un identificador de texto válido.', {
          field: 'product_id',
        });
      }
      return inventoryRepository.findInventoryByProductAndLocation(productId, location ?? 'default');
    },

    getProductQuantity(productId) {
      const p = inventoryRepository.findProductById(productId);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Producto no encontrado: ${productId}`);
      const rows = inventoryRepository.listInventories({ product_id: productId });
      const hasInventoryRecord = rows.length > 0;
      const knownTotal = hasInventoryRecord
        ? Number(rows.reduce((acc, r) => acc + Number(r.quantity), 0).toFixed(6))
        : null;
      return {
        product_id: productId,
        unit: p.unit,
        has_inventory_record: hasInventoryRecord,
        quantity_state: hasInventoryRecord ? 'KNOWN' : 'UNKNOWN',
        current_quantity: knownTotal,
        total_quantity: knownTotal,
        locations: rows,
      };
    },

    registerInventory({ product_id, location = 'default', quantity, unit, cause = 'Registro inicial de inventario' }) {
      const p = inventoryRepository.findProductById(product_id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Producto no encontrado: ${product_id}`);
      const u = unit ? normalizeUnit(unit) : p.unit;
      assertCompatibleUnit(p.unit, u);
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty < 0) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'quantity debe ser >= 0.');
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        const inv = inventoryRepository.upsertInventory({
          id: randomUUID(),
          product_id,
          location,
          quantity: qty,
          unit: u,
          updated_at: now,
        });
        inventoryRepository.insertInventoryMovement({
          id: randomUUID(),
          inventory_id: inv.id,
          product_id,
          movement_type: 'INITIAL',
          quantity_delta: qty,
          unit: u,
          cause,
          occurred_at: now,
        });
        refreshMaterializedCycleIfPresent({
          inventoryRepository,
          productId: product_id,
          referenceDate: todayDate(),
          nowIso,
        });
        return inv;
      });
    },

    adjustInventory({ product_id, location = 'default', delta, quantity_delta, unit, cause, movement_type = 'ADJUSTMENT', reference_id = null }) {
      if (!cause || !cause.trim()) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Toda modificación de inventario requiere causa identificable (cause).', { field: 'cause' });
      }
      const p = inventoryRepository.findProductById(product_id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Producto no encontrado: ${product_id}`);
      const u = unit ? normalizeUnit(unit) : p.unit;
      assertCompatibleUnit(p.unit, u);
      const d = Number(delta ?? quantity_delta);
      if (!Number.isFinite(d) || d === 0) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'delta debe ser un número distinto de 0.');

      return transactionService.executeAtomicOperation(() => {
        const existing = inventoryRepository.findInventoryByProductAndLocation(product_id, location);
        const currentQty = existing ? Number(existing.quantity) : 0;
        const nextQty = Number((currentQty + d).toFixed(6));
        if (nextQty < 0) {
          throw new NexusError(ERROR_CODES.CONFLICT, `Existencias insuficientes para ${p.name} (disponible: ${currentQty} ${p.unit}).`);
        }
        const now = nowIso();
        const inv = inventoryRepository.upsertInventory({
          id: existing?.id ?? randomUUID(),
          product_id,
          location,
          quantity: nextQty,
          unit: u,
          updated_at: now,
        });
        inventoryRepository.insertInventoryMovement({
          id: randomUUID(),
          inventory_id: inv.id,
          product_id,
          movement_type,
          quantity_delta: d,
          unit: u,
          cause: cause.trim(),
          reference_id,
          occurred_at: now,
        });
        refreshMaterializedCycleIfPresent({
          inventoryRepository,
          productId: product_id,
          referenceDate: todayDate(),
          nowIso,
        });
        return inv;
      });
    },

    getInventoryHistory(productId, { limit = 100 } = {}) {
      return inventoryRepository.listInventoryMovements({ product_id: productId, limit });
    },
  };
}

export function createPurchaseService({ inventoryRepository, inventoryService, transactionService, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    createPurchase(input) {
      const currency = normalizeCurrency(input.currency);
      if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Una compra debe incluir al menos un artículo (items).');
      }
      return transactionService.executeAtomicOperation(() => {
        const now = nowIso();
        const purchaseId = randomUUID();
        let totalMinor = 0;
        const preparedItems = input.items.map(item => {
          const p = inventoryRepository.findProductById(item.product_id);
          if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Producto no encontrado: ${item.product_id}`);
          const unit = item.unit ? normalizeUnit(item.unit) : p.unit;
          assertCompatibleUnit(p.unit, unit);
          const qty = validatePositiveQuantity(item.quantity);
          const unitPriceMinor = toMinorUnits(item.unit_price, 2);
          const lineTotalMinor = Math.round(unitPriceMinor * qty);
          totalMinor += lineTotalMinor;
          return {
            id: randomUUID(),
            purchase_id: purchaseId,
            product_id: p.id,
            quantity: qty,
            unit,
            unit_price_minor: unitPriceMinor,
            total_price_minor: lineTotalMinor,
            received_quantity: 0,
          };
        });

        const purchase = {
          id: purchaseId,
          purchase_date: input.purchase_date ?? now,
          supplier: (input.supplier ?? '').trim(),
          total_amount_minor: totalMinor,
          currency,
          scale: 2,
          status: input.status ?? 'ORDERED',
          notes: (input.notes ?? '').trim(),
          created_at: now,
          updated_at: now,
        };
        inventoryRepository.insertPurchase(purchase);
        for (const it of preparedItems) inventoryRepository.insertPurchaseItem(it);
        return { ...purchase, total_amount: fromMinorUnits(totalMinor, 2), items: preparedItems };
      });
    },

    getPurchase(id) {
      const p = inventoryRepository.findPurchaseById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Compra no encontrada: ${id}`, { entity: 'Purchase' });
      return {
        ...p,
        total_amount: fromMinorUnits(p.total_amount_minor, p.scale),
        items: inventoryRepository.listPurchaseItems(id),
        payments: inventoryRepository.listPayments({ related_purchase_id: id }),
      };
    },

    listPurchases(filters = {}) {
      return inventoryRepository.listPurchases(filters).map(p => ({ ...p, total_amount: fromMinorUnits(p.total_amount_minor, p.scale) }));
    },

    updatePurchase(id, patch) {
      const p = inventoryRepository.findPurchaseById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Compra no encontrada: ${id}`);
      return inventoryRepository.updatePurchase({
        ...p,
        supplier: patch.supplier !== undefined ? patch.supplier.trim() : p.supplier,
        status: patch.status ?? p.status,
        notes: patch.notes !== undefined ? patch.notes.trim() : p.notes,
        updated_at: nowIso(),
      });
    },

    cancelPurchase(id) {
      return this.updatePurchase(id, { status: 'CANCELLED' });
    },

    receivePurchaseItems(purchaseId, receipts, { location = 'default' } = {}) {
      const purchase = inventoryRepository.findPurchaseById(purchaseId);
      if (!purchase) throw new NexusError(ERROR_CODES.NOT_FOUND, `Compra no encontrada: ${purchaseId}`);
      if (purchase.status === 'CANCELLED') throw new NexusError(ERROR_CODES.CONFLICT, 'No se puede recibir una compra cancelada.');

      return transactionService.executeAtomicOperation(() => {
        const items = inventoryRepository.listPurchaseItems(purchaseId);
        const byItemId = new Map(items.map(i => [i.id, i]));
        for (const rec of receipts) {
          const item = byItemId.get(rec.purchase_item_id) ?? items.find(i => i.product_id === rec.product_id);
          if (!item) throw new NexusError(ERROR_CODES.NOT_FOUND, 'Artículo de compra no encontrado en la recepción.');
          const qty = validatePositiveQuantity(rec.quantity, 'received_quantity');
          const nextReceived = Number((Number(item.received_quantity) + qty).toFixed(6));
          if (nextReceived > Number(item.quantity) + 1e-6) {
            throw new NexusError(ERROR_CODES.CONFLICT, 'La cantidad recibida excede la cantidad comprada.');
          }
          inventoryRepository.updatePurchaseItemReceived(item.id, nextReceived);
          item.received_quantity = nextReceived;
          inventoryService.adjustInventory({
            product_id: item.product_id,
            location,
            delta: qty,
            unit: item.unit,
            cause: `Recepción de compra ${purchaseId}`,
            movement_type: 'RECEIPT',
            reference_id: purchaseId,
          });
        }

        const allReceived = items.every(i => Number(i.received_quantity) >= Number(i.quantity) - 1e-6);
        const anyReceived = items.some(i => Number(i.received_quantity) > 0);
        const nextStatus = allReceived ? 'RECEIVED' : (anyReceived ? 'RECEIVED_PARTIALLY' : purchase.status);
        inventoryRepository.updatePurchase({ ...purchase, status: nextStatus, updated_at: nowIso() });
        return this.getPurchase(purchaseId);
      });
    },
  };
}

export function createPaymentService({ inventoryRepository, transactionService, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    recordPayment(input) {
      const currency = normalizeCurrency(input.currency);
      const amountMinor = toMinorUnits(input.amount, 2);
      if (amountMinor <= 0) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'amount debe ser positivo.');
      if (input.related_purchase_id && !inventoryRepository.findPurchaseById(input.related_purchase_id)) {
        throw new NexusError(ERROR_CODES.NOT_FOUND, `Compra asociada no encontrada: ${input.related_purchase_id}`);
      }
      const now = nowIso();
      const pay = {
        id: randomUUID(),
        amount_minor: amountMinor,
        currency,
        scale: 2,
        paid_at: input.paid_at ?? now,
        payment_method: (input.payment_method ?? 'UNSPECIFIED').trim(),
        related_purchase_id: input.related_purchase_id ?? null,
        corrected_payment_id: input.corrected_payment_id ?? null,
        reason: input.reason?.trim() ?? null,
        status: 'COMPLETED',
        created_at: now,
      };
      inventoryRepository.insertPayment(pay);
      return { ...pay, amount: fromMinorUnits(pay.amount_minor, pay.scale) };
    },
    getPayment(id) {
      const p = inventoryRepository.findPaymentById(id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Pago no encontrado: ${id}`);
      return { ...p, amount: fromMinorUnits(p.amount_minor, p.scale) };
    },
    listPayments(filters = {}) {
      return inventoryRepository.listPayments(filters).map(p => ({ ...p, amount: fromMinorUnits(p.amount_minor, p.scale) }));
    },
    correctPayment(id, { amount, payment_method, reason }) {
      if (!reason || !reason.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'reason es obligatorio para corregir un pago.');
      const original = inventoryRepository.findPaymentById(id);
      if (!original) throw new NexusError(ERROR_CODES.NOT_FOUND, `Pago no encontrado: ${id}`);
      return transactionService.executeAtomicOperation(() => {
        inventoryRepository.updatePaymentStatus(id, 'CORRECTED');
        return this.recordPayment({
          amount: amount !== undefined ? amount : fromMinorUnits(original.amount_minor, original.scale),
          currency: original.currency,
          paid_at: original.paid_at,
          payment_method: payment_method ?? original.payment_method,
          related_purchase_id: original.related_purchase_id,
          corrected_payment_id: id,
          reason,
        });
      });
    },
  };
}

export function createConsumptionService({ inventoryRepository, inventoryService, transactionService, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());

  return {
    recordConsumption(input) {
      const p = inventoryRepository.findProductById(input.product_id);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Producto no encontrado: ${input.product_id}`);
      const unit = input.unit ? normalizeUnit(input.unit) : p.unit;
      assertCompatibleUnit(p.unit, unit);
      const qty = validatePositiveQuantity(input.quantity);
      const location = input.location ?? 'default';

      return transactionService.executeAtomicOperation(() => {
        const consumption = {
          id: randomUUID(),
          product_id: p.id,
          location,
          quantity: qty,
          unit,
          consumed_at: input.consumed_at ?? nowIso(),
          related_activity_id: input.related_activity_id ?? null,
          corrected_consumption_id: input.corrected_consumption_id ?? null,
          notes: (input.notes ?? '').trim(),
          status: 'RECORDED',
        };
        inventoryRepository.insertConsumption(consumption);
        inventoryService.adjustInventory({
          product_id: p.id,
          location,
          delta: -qty,
          unit,
          cause: `Consumo ${consumption.id}`,
          movement_type: 'CONSUMPTION',
          reference_id: consumption.id,
        });
        return consumption;
      });
    },

    correctConsumption(id, { quantity, notes, reason }) {
      if (!reason || !reason.trim()) throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'reason es obligatorio para corregir consumo.');
      const original = inventoryRepository.findConsumptionById(id);
      if (!original) throw new NexusError(ERROR_CODES.NOT_FOUND, `Consumo no encontrado: ${id}`);
      const newQty = validatePositiveQuantity(quantity);
      return transactionService.executeAtomicOperation(() => {
        inventoryRepository.updateConsumptionStatus(id, 'CORRECTED');
        // Devolver existencia original y aplicar nuevo consumo atómicamente
        inventoryService.adjustInventory({
          product_id: original.product_id,
          location: original.location,
          delta: original.quantity,
          unit: original.unit,
          cause: `Reversión por corrección de consumo ${id}: ${reason}`,
          movement_type: 'ADJUSTMENT',
          reference_id: id,
        });
        return this.recordConsumption({
          product_id: original.product_id,
          location: original.location,
          quantity: newQty,
          unit: original.unit,
          consumed_at: original.consumed_at,
          related_activity_id: original.related_activity_id,
          corrected_consumption_id: id,
          notes: notes ?? original.notes,
        });
      });
    },

    getConsumptionHistory(productIdOrOpts = null) {
      if (productIdOrOpts && typeof productIdOrOpts === 'object') {
        return inventoryRepository.listConsumptions(productIdOrOpts);
      }
      return inventoryRepository.listConsumptions({ product_id: productIdOrOpts });
    },

    getConsumptionByPeriod(from, to, { product_id = null } = {}) {
      return inventoryRepository.listConsumptions({ product_id, from, to });
    },
  };
}

export function createReplenishmentService({ inventoryRepository, inventoryService = null, transactionService = null, clock = null }) {
  const nowIso = () => (clock ? clock.nowIso() : new Date().toISOString());
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));
  const inTx = fn => (transactionService ? transactionService.executeAtomicOperation(fn) : fn());

  return {
    evaluateReplenishmentNeed(input) {
      return evaluateReplenishmentNeed(input);
    },

    calculateReplenishmentNeed(productOrInput, options = {}) {
      if (productOrInput && typeof productOrInput === 'object') {
        return evaluateReplenishmentNeed(productOrInput);
      }
      const windowDays = options?.windowDays ?? options?.window_days ?? 30;
      const referenceDate = options?.referenceDate ?? options?.reference_date ?? todayDate();
      return computeProductReplenishmentFromRepo({
        inventoryRepository,
        productId: productOrInput,
        windowDays,
        referenceDate,
      });
    },

    estimateReplenishmentDate(productId, options = {}) {
      const calc = this.calculateReplenishmentNeed(productId, options);
      return {
        product_id: calc.product_id,
        estimated_replenishment_date: calc.estimated_replenishment_date,
        days_until_minimum: calc.days_until_minimum,
        cycle_status: calc.cycle_status,
        data_states: calc.data_states,
        warnings: calc.warnings,
        is_estimate: true,
      };
    },

    getReplenishmentStatus(productIdOrOpts = null) {
      if (typeof productIdOrOpts === 'string') {
        const calc = this.calculateReplenishmentNeed(productIdOrOpts);
        const existing = inventoryRepository.findReplenishmentCycle(productIdOrOpts);
        return {
          ...calc,
          id: existing?.id ?? null,
          materialized_cycle_id: existing?.id ?? null,
          materialized_at: existing?.updated_at ?? null,
        };
      }
      if (productIdOrOpts && typeof productIdOrOpts === 'object' && (productIdOrOpts.product_id || productIdOrOpts.id)) {
        const targetId = productIdOrOpts.product_id ?? productIdOrOpts.id;
        const calc = this.calculateReplenishmentNeed(targetId, productIdOrOpts);
        const existing = inventoryRepository.findReplenishmentCycle(targetId);
        return {
          ...calc,
          id: existing?.id ?? null,
          materialized_cycle_id: existing?.id ?? null,
          materialized_at: existing?.updated_at ?? null,
        };
      }
      const opts = productIdOrOpts && typeof productIdOrOpts === 'object' ? productIdOrOpts : {};
      const onlyAlerts = Boolean(opts.onlyAlerts ?? false);
      const products = inventoryRepository.listProducts({ status: 'ACTIVE' });
      const list = products.map(p => {
        const calc = this.calculateReplenishmentNeed(p.id, opts);
        const existing = inventoryRepository.findReplenishmentCycle(p.id);
        return {
          ...calc,
          id: existing?.id ?? null,
          materialized_cycle_id: existing?.id ?? null,
          materialized_at: existing?.updated_at ?? null,
        };
      });
      return onlyAlerts
        ? list.filter(item => item.cycle_status === 'NEEDS_REPLENISHMENT' || item.cycle_status === 'LOW')
        : list;
    },

    materializeReplenishmentCycle(productId, options = {}) {
      return inTx(() => {
        const calc = this.calculateReplenishmentNeed(productId, options);
        const existing = inventoryRepository.findReplenishmentCycle(calc.product_id);
        const persisted = inventoryRepository.upsertReplenishmentCycle({
          id: existing?.id ?? randomUUID(),
          product_id: calc.product_id,
          average_daily_consumption: calc.average_daily_consumption,
          minimum_quantity: calc.minimum_quantity ?? 0,
          estimated_replenishment_date: calc.estimated_replenishment_date,
          cycle_status: calc.cycle_status,
          updated_at: nowIso(),
        });
        return {
          ...calc,
          id: persisted.id,
          updated_at: persisted.updated_at,
          materialized_cycle_id: persisted.id,
          materialized_at: persisted.updated_at,
        };
      });
    },

    updateReplenishmentParameters(productId, { minimum_quantity }) {
      const p = inventoryRepository.findProductById(productId);
      if (!p) throw new NexusError(ERROR_CODES.NOT_FOUND, `Producto no encontrado: ${productId}`, { entity: 'Product' });
      const minQty = Number(minimum_quantity);
      if (!Number.isFinite(minQty) || minQty < 0) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'minimum_quantity debe ser un número mayor o igual a 0.', {
          field: 'minimum_quantity',
        });
      }
      return inTx(() => {
        inventoryRepository.updateProduct({ ...p, minimum_quantity: minQty, updated_at: nowIso() });
        return this.materializeReplenishmentCycle(productId);
      });
    },
  };
}
