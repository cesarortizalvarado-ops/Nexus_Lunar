import { addDays } from '../../shared/clock.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Evaluación determinista y pura de necesidades de reposición (NL-INT-002 / NL-MASTER-02 §10.7 / NL-MASTER-03 §11.6).
 *
 * Restricciones garantizadas:
 * - Cero lecturas o escrituras en SQLite.
 * - Cero uso de repositorios.
 * - Cero acceso al reloj del sistema (si se requiere proyectar fecha de calendario, debe pasarse `reference_date`).
 * - Cero efectos secundarios y cero mutación del objeto `input` recibido.
 * - Distingue explícitamente existencias conocidas (incluyendo 0) frente a existencias desconocidas (sin registros -> null / UNKNOWN),
 *   y consumo calculado frente a consumo desconocido o insuficiente (null, nunca 0 inventado).
 */
export function evaluateReplenishmentNeed(input) {
  if (!input || typeof input !== 'object') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'evaluateReplenishmentNeed requiere un objeto de entrada explícito.');
  }

  const product = input.product;
  if (!product || typeof product !== 'object') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'evaluateReplenishmentNeed requiere la entidad product en input.product.', {
      field: 'product',
    });
  }

  const productId = product.id ?? product.product_id ?? null;
  if (!productId || typeof productId !== 'string') {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'product.id es obligatorio para evaluar reposición.', {
      field: 'product.id',
    });
  }

  const windowDays = Number(input.window_days ?? input.windowDays ?? 30);
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'window_days debe ser un número positivo.', {
      field: 'window_days',
    });
  }

  const hasMinQuantity = product.minimum_quantity !== undefined && product.minimum_quantity !== null && Number.isFinite(Number(product.minimum_quantity));
  const minimumQuantity = hasMinQuantity ? Number(Number(product.minimum_quantity).toFixed(6)) : null;
  if (minimumQuantity !== null && minimumQuantity < 0) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'minimum_quantity no puede ser negativo.', {
      field: 'product.minimum_quantity',
    });
  }

  const rawReferenceDate = input.reference_date ?? input.referenceDate ?? null;
  if (rawReferenceDate !== null && (typeof rawReferenceDate !== 'string' || !ISO_DATE_RE.test(rawReferenceDate))) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'reference_date debe tener formato YYYY-MM-DD cuando se especifica.', {
      field: 'reference_date',
    });
  }
  const referenceDate = rawReferenceDate;

  const warnings = [];
  const criteria = [];

  // 1. Determinar estado de existencias (KNOWN vs UNKNOWN; nunca asumir 0 ante ausencia de registros)
  let hasInventoryRecord = false;
  let currentQuantity = null;
  let stockState = 'UNKNOWN';

  if (Array.isArray(input.stock_records)) {
    if (input.stock_records.length > 0) {
      hasInventoryRecord = true;
      let sum = 0;
      for (const rec of input.stock_records) {
        const q = Number(rec?.quantity);
        if (!Number.isFinite(q)) {
          throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Cada registro en stock_records debe tener una cantidad numérica finita.');
        }
        sum += q;
      }
      currentQuantity = Number(sum.toFixed(6));
      stockState = 'KNOWN';
    }
  } else if (input.has_inventory_record === true) {
    if (input.current_quantity === null || input.current_quantity === undefined || !Number.isFinite(Number(input.current_quantity))) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'has_inventory_record=true requiere un current_quantity numérico válido.');
    }
    hasInventoryRecord = true;
    currentQuantity = Number(Number(input.current_quantity).toFixed(6));
    stockState = 'KNOWN';
  } else if (input.has_inventory_record === undefined && typeof input.current_quantity === 'number' && Number.isFinite(input.current_quantity)) {
    hasInventoryRecord = true;
    currentQuantity = Number(input.current_quantity.toFixed(6));
    stockState = 'KNOWN';
  }

  // 2. Determinar consumo medio diario sobre consumos activos (CALCULATED vs UNKNOWN vs INSUFFICIENT)
  const rawConsumptions = Array.isArray(input.consumptions) ? input.consumptions : null;
  const cutoffIso = referenceDate ? `${addDays(referenceDate, -windowDays)}T00:00:00.000Z` : null;

  let averageDailyConsumption = null;
  let consumptionState = 'UNKNOWN';
  let activeConsumptionCount = 0;
  let totalConsumedInWindow = null;

  if (!rawConsumptions || rawConsumptions.length === 0) {
    consumptionState = 'UNKNOWN';
    warnings.push('No existen registros de consumo disponibles; no se asume tasa de consumo cero.');
  } else {
    let sumConsumed = 0;
    for (const c of rawConsumptions) {
      if (!c || c.status === 'CORRECTED') continue;
      if (cutoffIso && typeof c.consumed_at === 'string' && c.consumed_at < cutoffIso) continue;
      const qty = Number(c.quantity);
      if (!Number.isFinite(qty) || qty < 0) continue;
      sumConsumed += qty;
      activeConsumptionCount += 1;
    }

    if (activeConsumptionCount === 0) {
      consumptionState = 'UNKNOWN';
      warnings.push(`No existen consumos registrados dentro de la ventana de ${windowDays} días; no se asume tasa de consumo cero.`);
    } else if (sumConsumed <= 0) {
      totalConsumedInWindow = 0;
      consumptionState = 'INSUFFICIENT';
      warnings.push('Los registros de consumo en la ventana suman cero y resultan insuficientes para proyectar agotamiento.');
    } else {
      totalConsumedInWindow = Number(sumConsumed.toFixed(6));
      averageDailyConsumption = Number((totalConsumedInWindow / windowDays).toFixed(6));
      consumptionState = 'CALCULATED';
    }
  }

  // 3. Determinar estado del ciclo, cantidad necesaria y fecha estimada de reposición
  let cycleStatus = 'UNKNOWN';
  let neededQuantity = null;
  let neededQuantityState = 'UNKNOWN';
  let estimatedReplenishmentDate = null;
  let dateEstimationState = 'INSUFFICIENT';
  let daysUntilMinimum = null;

  if (stockState === 'UNKNOWN' || currentQuantity === null) {
    cycleStatus = 'UNKNOWN';
    neededQuantity = null;
    neededQuantityState = 'UNKNOWN';
    estimatedReplenishmentDate = null;
    dateEstimationState = 'INSUFFICIENT';
    warnings.push('No existe inventario registrado para este producto; las existencias se mantienen como desconocidas (UNKNOWN).');
    criteria.push('Sin registros en inventario: no se asume existencia 0 ni se dispara reposición ficticia.');
  } else if (minimumQuantity === null) {
    cycleStatus = 'UNKNOWN';
    neededQuantity = null;
    neededQuantityState = 'INSUFFICIENT';
    estimatedReplenishmentDate = null;
    dateEstimationState = 'INSUFFICIENT';
    warnings.push('El producto carece de umbral mínimo configurado (minimum_quantity).');
    criteria.push(`Existencias confirmadas (${currentQuantity} ${product.unit ?? ''}), pero falta minimum_quantity para evaluar el ciclo.`);
  } else if (currentQuantity <= minimumQuantity) {
    cycleStatus = 'NEEDS_REPLENISHMENT';
    neededQuantity = Number(Math.max(0, minimumQuantity - currentQuantity).toFixed(6));
    neededQuantityState = 'CALCULATED';
    warnings.push(
      `Umbral de reposición alcanzado con existencias confirmadas (${currentQuantity} <= ${minimumQuantity} ${product.unit ?? ''}): requiere reposición inmediata.`
    );
    criteria.push(
      `Existencias confirmadas (${currentQuantity} ${product.unit ?? ''}) iguales o inferiores al umbral mínimo (${minimumQuantity} ${product.unit ?? ''}).`
    );

    if (consumptionState === 'CALCULATED' && averageDailyConsumption !== null && averageDailyConsumption > 0 && referenceDate) {
      daysUntilMinimum = 0;
      estimatedReplenishmentDate = referenceDate;
      dateEstimationState = 'CALCULATED';
      criteria.push(`Con consumo medio calculado (${averageDailyConsumption} ${product.unit ?? ''}/día) y umbral ya alcanzado, la fecha de reposición es ${referenceDate}.`);
    } else {
      estimatedReplenishmentDate = null;
      dateEstimationState = 'INSUFFICIENT';
      criteria.push('No se inventa fecha estimada de agotamiento por falta de tasa de consumo calculada o fecha de referencia.');
    }
  } else {
    // currentQuantity > minimumQuantity con existencias confirmadas
    neededQuantity = 0;
    neededQuantityState = 'NOT_APPLICABLE';

    if (consumptionState === 'CALCULATED' && averageDailyConsumption !== null && averageDailyConsumption > 0) {
      const surplus = currentQuantity - minimumQuantity;
      daysUntilMinimum = Math.max(0, Math.floor(surplus / averageDailyConsumption));
      cycleStatus = daysUntilMinimum <= 7 ? 'LOW' : 'SUFFICIENT';

      if (referenceDate) {
        estimatedReplenishmentDate = addDays(referenceDate, daysUntilMinimum);
        dateEstimationState = 'CALCULATED';
        criteria.push(
          `Margen sobre mínimo: ${Number(surplus.toFixed(6))} ${product.unit ?? ''}; a razón de ${averageDailyConsumption} ${product.unit ?? ''}/día restan ${daysUntilMinimum} día(s) hasta el umbral (${estimatedReplenishmentDate}).`
        );
      } else {
        estimatedReplenishmentDate = null;
        dateEstimationState = 'INSUFFICIENT';
        warnings.push('Falta reference_date explícita para proyectar la fecha exacta en el calendario.');
        criteria.push(
          `Margen sobre mínimo: ${Number(surplus.toFixed(6))} ${product.unit ?? ''}; restan ${daysUntilMinimum} día(s) hasta el umbral al ritmo calculado (${averageDailyConsumption} ${product.unit ?? ''}/día).`
        );
      }

      if (cycleStatus === 'LOW') {
        warnings.push(`Existencias próximas al umbral mínimo (${daysUntilMinimum} día(s) restantes).`);
      }
    } else {
      cycleStatus = 'SUFFICIENT';
      estimatedReplenishmentDate = null;
      dateEstimationState = 'INSUFFICIENT';
      criteria.push(
        `Existencias confirmadas (${currentQuantity} ${product.unit ?? ''}) superiores al mínimo (${minimumQuantity} ${product.unit ?? ''}), pero sin datos suficientes de consumo para estimar fecha de reposición.`
      );
    }
  }

  return {
    product_id: productId,
    product_name: product.name ?? null,
    unit: product.unit ?? null,
    has_inventory_record: hasInventoryRecord,
    current_quantity: currentQuantity,
    minimum_quantity: minimumQuantity,
    needed_quantity: neededQuantity,
    average_daily_consumption: averageDailyConsumption,
    total_consumed_in_window: totalConsumedInWindow,
    consumption_sample_count: activeConsumptionCount,
    window_days: windowDays,
    reference_date: referenceDate,
    days_until_minimum: daysUntilMinimum,
    estimated_replenishment_date: estimatedReplenishmentDate,
    cycle_status: cycleStatus,
    data_states: {
      stock: stockState,
      consumption_rate: consumptionState,
      needed_quantity: neededQuantityState,
      estimated_date: dateEstimationState,
    },
    warnings,
    explanation: criteria.join(' '),
    is_estimate: true,
    authorizes_purchase: false, // NL-MASTER-01 §10.3 / NL-MASTER-02 §10.7: nunca constituye orden de compra
  };
}
