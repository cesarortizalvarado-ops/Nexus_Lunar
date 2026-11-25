import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { createInventoryRepository } from '../src/infrastructure/repositories/inventory-repository.js';
import {
  createConsumptionService,
  createInventoryService,
  createProductService,
  createReplenishmentService,
  evaluateReplenishmentNeed,
} from '../src/application/inventory/inventory-services.js';
import { runCli } from '../src/interfaces/cli/nexus-cli.js';
import {
  assertDatabaseSnapshotsEqual,
  captureDatabaseSnapshot,
  diffDatabaseSnapshots,
} from './http-method-integrity.test.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-int-002-inv-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return Object.freeze(obj);
}

test('NL-INT-002 · Escenarios 1 y 2 — Reproducibilidad determinista y pureza estricta de evaluateReplenishmentNeed sin SQLite ni reloj', () => {
  const frozenInput = deepFreeze({
    product: {
      id: 'prod_filament_01',
      name: 'Filamento PLA Gris',
      unit: 'g',
      minimum_quantity: 200,
    },
    stock_records: [
      { location: 'estante_a', quantity: 500, unit: 'g' },
      { location: 'estante_b', quantity: 300, unit: 'g' },
    ],
    consumptions: [
      { id: 'c1', quantity: 150, unit: 'g', consumed_at: '2026-11-10T12:00:00.000Z', status: 'RECORDED' },
      { id: 'c2', quantity: 150, unit: 'g', consumed_at: '2026-11-20T12:00:00.000Z', status: 'RECORDED' },
      { id: 'c3_old', quantity: 900, unit: 'g', consumed_at: '2026-09-01T12:00:00.000Z', status: 'RECORDED' },
      { id: 'c4_corr', quantity: 600, unit: 'g', consumed_at: '2026-11-18T12:00:00.000Z', status: 'CORRECTED' },
    ],
    window_days: 30,
    reference_date: '2026-11-24',
  });

  // Escenario 1: Reproducibilidad exacta ante las mismas entradas
  const res1 = evaluateReplenishmentNeed(frozenInput);
  const res2 = evaluateReplenishmentNeed(frozenInput);
  assert.deepEqual(res1, res2, 'Mismas entradas producen exactamente la misma evaluación determinista');

  // Escenario 2: Verificación de resultados calculados sin tocar SQLite ni mutar la entrada congelada
  assert.equal(res1.current_quantity, 800);
  assert.equal(res1.average_daily_consumption, 10); // 300g / 30 días (excluye fuera de ventana y CORRECTED)
  assert.equal(res1.needed_quantity, 0);
  assert.equal(res1.days_until_minimum, 60); // (800 - 200) / 10 = 60 días
  assert.equal(res1.estimated_replenishment_date, '2027-01-23');
  assert.equal(res1.cycle_status, 'SUFFICIENT');
  assert.deepEqual(res1.data_states, {
    stock: 'KNOWN',
    consumption_rate: 'CALCULATED',
    needed_quantity: 'NOT_APPLICABLE',
    estimated_date: 'CALCULATED',
  });
  assert.equal(res1.is_estimate, true);
  assert.equal(res1.authorizes_purchase, false);
});

test('NL-INT-002 · Escenarios 3, 4 y 6 — Separación consulta sin escrituras, materialización explícita y coherencia inmediata tras mutar datos primarios', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-24T18:00:00.000Z'),
  });
  const roDb = core.persistenceService.getReadDatabase();
  const rwDb = core.persistenceService.getDatabase();

  try {
    const prod = core.productService.createProduct({
      name: 'Alcohol Isopropílico',
      unit: 'ml',
      minimum_quantity: 250,
    });
    core.inventoryService.registerInventory({
      product_id: prod.id,
      quantity: 400,
      unit: 'ml',
    });
    core.consumptionService.recordConsumption({
      product_id: prod.id,
      quantity: 300, // Quedan 100 ml (<= 250 ml mínimo), tasa = 10 ml/día
      unit: 'ml',
      consumed_at: '2026-11-20T15:00:00.000Z',
    });

    // Antes de materializar explícitamente, replenishment_cycles permanece vacía (no se persiste sin necesidad demostrada)
    assert.equal(
      roDb.prepare('SELECT COUNT(*) AS c FROM replenishment_cycles').get().c,
      0,
      'Las mutaciones ordinarias no crean filas innecesarias en replenishment_cycles mientras no se materialice el ciclo'
    );

    // === Escenario 3: Ninguna modalidad de consulta o cálculo modifica SQLite ===
    const snapBeforeQueries = captureDatabaseSnapshot(roDb);

    const statusSingle = core.replenishmentService.getReplenishmentStatus(prod.id);
    assert.equal(statusSingle.cycle_status, 'NEEDS_REPLENISHMENT');
    assert.equal(statusSingle.current_quantity, 100);
    assert.equal(statusSingle.needed_quantity, 150);
    assert.equal(statusSingle.average_daily_consumption, 10);
    assert.equal(statusSingle.estimated_replenishment_date, '2026-11-24');

    const statusAll = core.replenishmentService.getReplenishmentStatus();
    assert.equal(statusAll.length, 1);
    assert.equal(statusAll[0].cycle_status, 'NEEDS_REPLENISHMENT');

    const statusAlerts = core.replenishmentService.getReplenishmentStatus({ onlyAlerts: true });
    assert.equal(statusAlerts.length, 1);

    const calcPureFromRepo = core.replenishmentService.calculateReplenishmentNeed(prod.id);
    assert.equal(calcPureFromRepo.cycle_status, 'NEEDS_REPLENISHMENT');

    const estDate = core.replenishmentService.estimateReplenishmentDate(prod.id);
    assert.equal(estDate.estimated_replenishment_date, '2026-11-24');

    const dispStatus = core.executeOperation({
      operation_type: 'inventory.replenishment.status',
      payload: { product_id: prod.id },
    });
    assert.equal(dispStatus.success, true);
    assert.equal(dispStatus.metadata.kind, 'QUERY');
    assert.equal(dispStatus.result.cycle_status, 'NEEDS_REPLENISHMENT');

    const dispCalc = core.executeOperation({
      operation_type: 'inventory.replenishment.calculate',
      payload: { product_id: prod.id },
    });
    assert.equal(dispCalc.success, true);
    assert.equal(dispCalc.metadata.kind, 'QUERY');
    assert.equal(dispCalc.result.needed_quantity, 150);

    assertDatabaseSnapshotsEqual(
      captureDatabaseSnapshot(roDb),
      snapBeforeQueries,
      'Escenario 3: Ninguna consulta ni cálculo de reposición produce escrituras en SQLite'
    );
    assert.equal(roDb.prepare('SELECT COUNT(*) AS c FROM replenishment_cycles').get().c, 0);

    // === Escenario 4: Materialización explícita mediante materializeReplenishmentCycle ===
    const materialized = core.replenishmentService.materializeReplenishmentCycle(prod.id);
    assert.ok(materialized.id, 'Devuelve el identificador del ciclo materializado');
    const rowInDb = roDb.prepare('SELECT * FROM replenishment_cycles WHERE product_id = ?').get(prod.id);
    assert.ok(rowInDb, 'Escenario 4: El registro derivado se persiste en replenishment_cycles al solicitarlo explícitamente');
    assert.equal(rowInDb.id, materialized.id);
    assert.equal(rowInDb.cycle_status, 'NEEDS_REPLENISHMENT');
    assert.equal(rowInDb.average_daily_consumption, 10);

    // === Escenario 6: Coherencia inmediata tras modificar existencias o consumos (nunca devolver ciclos obsoletos) ===
    core.inventoryService.adjustInventory({
      product_id: prod.id,
      delta: 500, // Pasa de 100 ml a 600 ml (> 250 ml mínimo; margen = 350 ml -> 35 días -> SUFFICIENT)
      cause: 'Recepción de botella nueva de 500 ml',
    });

    // Tanto la fila materializada mantenida en la transacción como la consulta en vivo reflejan SUFFICIENT
    const rowAfterAdjust = roDb.prepare('SELECT * FROM replenishment_cycles WHERE product_id = ?').get(prod.id);
    assert.equal(rowAfterAdjust.id, materialized.id, 'Conserva identidad estable del ciclo materializado');
    assert.equal(rowAfterAdjust.cycle_status, 'SUFFICIENT');

    // Incluso si existiera una fila obsoleta en replenishment_cycles, getReplenishmentStatus evalúa los datos primarios actuales sin escribir
    rwDb.prepare("UPDATE replenishment_cycles SET cycle_status = 'NEEDS_REPLENISHMENT', estimated_replenishment_date = '1999-01-01' WHERE product_id = ?").run(prod.id);
    const snapWithStaleCache = captureDatabaseSnapshot(roDb);

    const liveStatus = core.replenishmentService.getReplenishmentStatus(prod.id);
    assert.equal(liveStatus.current_quantity, 600);
    assert.equal(liveStatus.cycle_status, 'SUFFICIENT', 'Escenario 6: La consulta jamás devuelve el estado obsoleto de replenishment_cycles');
    assert.equal(liveStatus.estimated_replenishment_date, '2026-12-29');

    assertDatabaseSnapshotsEqual(
      captureDatabaseSnapshot(roDb),
      snapWithStaleCache,
      'Consultar con caché desactualizada devuelve datos frescos sin escribir en SQLite'
    );
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('NL-INT-002 · Escenario 7 — Tratamiento estricto de UNKNOWN vs 0 en existencias, consumos y estimación de fechas', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-24T18:00:00.000Z'),
  });

  try {
    // 1. Producto SIN inventario registrado -> current_quantity: null, cycle_status: UNKNOWN (jamás 0 ni alerta falsa)
    const unrecordedProd = core.productService.createProduct({
      name: 'Resina UV Gris',
      unit: 'ml',
      minimum_quantity: 500,
    });
    const qtyUnrecorded = core.inventoryService.getProductQuantity(unrecordedProd.id);
    assert.equal(qtyUnrecorded.has_inventory_record, false);
    assert.equal(qtyUnrecorded.quantity_state, 'UNKNOWN');
    assert.equal(qtyUnrecorded.current_quantity, null);
    assert.equal(qtyUnrecorded.total_quantity, null);

    const statusUnrecorded = core.replenishmentService.getReplenishmentStatus(unrecordedProd.id);
    assert.equal(statusUnrecorded.current_quantity, null);
    assert.equal(statusUnrecorded.cycle_status, 'UNKNOWN');
    assert.equal(statusUnrecorded.needed_quantity, null);
    assert.equal(statusUnrecorded.average_daily_consumption, null);
    assert.equal(statusUnrecorded.estimated_replenishment_date, null);
    assert.equal(statusUnrecorded.data_states.stock, 'UNKNOWN');
    assert.equal(statusUnrecorded.data_states.consumption_rate, 'UNKNOWN');
    assert.equal(
      core.replenishmentService.getReplenishmentStatus({ onlyAlerts: true }).some(a => a.product_id === unrecordedProd.id),
      false,
      'Un producto sin inventario registrado (UNKNOWN) no debe emitirse como falsa alerta de agotamiento'
    );

    // 2. Producto CON inventario registrado igual a CERO y sin consumos -> current_quantity: 0, cycle_status: NEEDS_REPLENISHMENT, pero sin fecha inventada
    const zeroStockProd = core.productService.createProduct({
      name: 'Guantes de nitrilo',
      unit: 'unit',
      minimum_quantity: 10,
    });
    core.inventoryService.registerInventory({
      product_id: zeroStockProd.id,
      quantity: 0,
      unit: 'unit',
      cause: 'Conteo físico inicial en cero',
    });
    const qtyZero = core.inventoryService.getProductQuantity(zeroStockProd.id);
    assert.equal(qtyZero.has_inventory_record, true);
    assert.equal(qtyZero.quantity_state, 'KNOWN');
    assert.equal(qtyZero.current_quantity, 0);

    const statusZero = core.replenishmentService.getReplenishmentStatus(zeroStockProd.id);
    assert.equal(statusZero.current_quantity, 0);
    assert.equal(statusZero.cycle_status, 'NEEDS_REPLENISHMENT');
    assert.equal(statusZero.needed_quantity, 10);
    assert.equal(statusZero.average_daily_consumption, null, 'Sin consumos registrados, la tasa permanece null');
    assert.equal(statusZero.estimated_replenishment_date, null, 'Sin tasa de consumo, no se inventa fecha estimada');
    assert.equal(statusZero.data_states.stock, 'KNOWN');
    assert.equal(statusZero.data_states.consumption_rate, 'UNKNOWN');
    assert.equal(statusZero.data_states.estimated_date, 'INSUFFICIENT');
    assert.ok(statusZero.warnings.some(w => w.includes('reposición inmediata')));

    // 3. Producto con existencias suficientes pero SIN datos de consumo -> SUFFICIENT con tasa y fecha null
    const noConsumptionProd = core.productService.createProduct({
      name: 'Lubricante PTFE',
      unit: 'ml',
      minimum_quantity: 50,
    });
    core.inventoryService.registerInventory({
      product_id: noConsumptionProd.id,
      quantity: 200,
      unit: 'ml',
    });
    const statusNoCons = core.replenishmentService.getReplenishmentStatus(noConsumptionProd.id);
    assert.equal(statusNoCons.current_quantity, 200);
    assert.equal(statusNoCons.cycle_status, 'SUFFICIENT');
    assert.equal(statusNoCons.average_daily_consumption, null);
    assert.equal(statusNoCons.estimated_replenishment_date, null);
    assert.equal(statusNoCons.data_states.estimated_date, 'INSUFFICIENT');

    // 4. Producto con consumo conocido pero evaluación pura sin reference_date -> INSUFFICIENT para proyectar fecha de calendario
    const noRefDateEval = evaluateReplenishmentNeed({
      product: { id: 'p_noref', name: 'Cinta Kapton', unit: 'm', minimum_quantity: 5 },
      stock_records: [{ quantity: 20, unit: 'm' }],
      consumptions: [{ quantity: 30, unit: 'm', status: 'RECORDED' }],
      window_days: 30,
      reference_date: null,
    });
    assert.equal(noRefDateEval.average_daily_consumption, 1);
    assert.equal(noRefDateEval.days_until_minimum, 15);
    assert.equal(noRefDateEval.estimated_replenishment_date, null);
    assert.equal(noRefDateEval.data_states.estimated_date, 'INSUFFICIENT');
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('NL-INT-002 · Escenarios 5 y 8 — Compatibilidad con PlanningInputService / AdaptiveAnalysisService y atomicidad ante fallo de materialización', () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
    nowFn: () => new Date('2026-11-24T18:00:00.000Z'),
  });
  const roDb = core.persistenceService.getReadDatabase();

  try {
    // === Escenario 5: Compatibilidad con PlanningInputService y AdaptiveAnalysisService ===
    const prodDepleted = core.productService.createProduct({ name: 'Boquilla 0.4mm', unit: 'unit', minimum_quantity: 2 });
    core.inventoryService.registerInventory({ product_id: prodDepleted.id, quantity: 1, unit: 'unit' });

    const prodUnknown = core.productService.createProduct({ name: 'Sensor sin conteo', unit: 'unit', minimum_quantity: 2 });

    const snapBeforePlanningInputs = captureDatabaseSnapshot(roDb);
    const constraints = core.planningInputService.identifyPlanningConstraints({
      period_start: '2026-11-24T06:00:00.000Z',
      period_end: '2026-11-25T05:59:59.999Z',
    });
    assert.equal(constraints.replenishment_alerts.length, 1);
    assert.equal(constraints.replenishment_alerts[0].product_id, prodDepleted.id);
    assert.equal(constraints.replenishment_alerts[0].cycle_status, 'NEEDS_REPLENISHMENT');

    const planningInputs = core.planningInputService.collectPlanningInputs({
      period_start: '2026-11-24T06:00:00.000Z',
      period_end: '2026-11-25T05:59:59.999Z',
    });
    assert.equal(planningInputs.replenishment_alerts.length, 1);
    assert.equal(planningInputs.replenishment_alerts.some(r => r.product_id === prodUnknown.id), false);

    assertDatabaseSnapshotsEqual(
      captureDatabaseSnapshot(roDb),
      snapBeforePlanningInputs,
      'PlanningInputService (identifyPlanningConstraints y collectPlanningInputs) no produce ninguna escritura en SQLite'
    );

    const observations = core.adaptiveAnalysisService.identifyPatterns();
    const depObs = observations.find(o => o.observation_type === 'DEPLETING_RESOURCE' && o.related_entity_id === prodDepleted.id);
    assert.ok(depObs, 'AdaptiveAnalysisService sigue generando DEPLETING_RESOURCE compatible');
    assert.ok(depObs.description.includes('Boquilla 0.4mm'));

    // === Escenario 8: Atomicidad transaccional cuando falla la actualización de un ciclo materializado ===
    core.replenishmentService.materializeReplenishmentCycle(prodDepleted.id);

    const baseRepo = createInventoryRepository(core.persistenceService);
    let failNextUpsert = false;
    const faultInjectedRepo = {
      ...baseRepo,
      upsertReplenishmentCycle(rc) {
        if (failNextUpsert) {
          throw new Error('FALLO_SIMULADO_MATERIALIZACION');
        }
        return baseRepo.upsertReplenishmentCycle(rc);
      },
    };

    const guardedProductService = createProductService({
      inventoryRepository: faultInjectedRepo,
      transactionService: core.transactionService,
      clock: core.clock,
    });
    const guardedInventoryService = createInventoryService({
      inventoryRepository: faultInjectedRepo,
      transactionService: core.transactionService,
      clock: core.clock,
    });
    const guardedConsumptionService = createConsumptionService({
      inventoryRepository: faultInjectedRepo,
      inventoryService: guardedInventoryService,
      transactionService: core.transactionService,
      clock: core.clock,
    });
    const guardedReplenishmentService = createReplenishmentService({
      inventoryRepository: faultInjectedRepo,
      inventoryService: guardedInventoryService,
      transactionService: core.transactionService,
      clock: core.clock,
    });

    const snapBeforeFaults = captureDatabaseSnapshot(roDb);
    failNextUpsert = true;

    // 8.1 Fallo durante adjustInventory revierte tanto inventories como inventory_movements
    assert.throws(
      () => guardedInventoryService.adjustInventory({ product_id: prodDepleted.id, delta: 5, cause: 'Ingreso con fallo' }),
      /FALLO_SIMULADO_MATERIALIZACION/
    );
    assertDatabaseSnapshotsEqual(
      captureDatabaseSnapshot(roDb),
      snapBeforeFaults,
      'Escenario 8.1: Fallo en materialización durante adjustInventory revierte atómicamente inventario y movimientos'
    );

    // 8.2 Fallo durante recordConsumption revierte tanto consumptions como inventories e inventory_movements
    assert.throws(
      () => guardedConsumptionService.recordConsumption({ product_id: prodDepleted.id, quantity: 1, unit: 'unit' }),
      /FALLO_SIMULADO_MATERIALIZACION/
    );
    assertDatabaseSnapshotsEqual(
      captureDatabaseSnapshot(roDb),
      snapBeforeFaults,
      'Escenario 8.2: Fallo en materialización durante recordConsumption revierte atómicamente consumo e inventario'
    );

    // 8.3 Fallo durante updateReplenishmentParameters revierte la actualización de products.minimum_quantity
    assert.throws(
      () => guardedReplenishmentService.updateReplenishmentParameters(prodDepleted.id, { minimum_quantity: 10 }),
      /FALLO_SIMULADO_MATERIALIZACION/
    );
    assertDatabaseSnapshotsEqual(
      captureDatabaseSnapshot(roDb),
      snapBeforeFaults,
      'Escenario 8.3: Fallo en materialización durante updateReplenishmentParameters revierte products.minimum_quantity'
    );

    // 8.4 Fallo durante updateProduct (cambio de minimum_quantity) revierte la edición del producto
    assert.throws(
      () => guardedProductService.updateProduct(prodDepleted.id, { minimum_quantity: 12 }),
      /FALLO_SIMULADO_MATERIALIZACION/
    );
    assertDatabaseSnapshotsEqual(
      captureDatabaseSnapshot(roDb),
      snapBeforeFaults,
      'Escenario 8.4: Fallo en materialización durante updateProduct revierte el cambio en products'
    );

    // Al restaurar operación normal, la actualización atómica confirma tanto primario como derivado
    failNextUpsert = false;
    const updatedCycle = guardedReplenishmentService.updateReplenishmentParameters(prodDepleted.id, { minimum_quantity: 4 });
    assert.equal(updatedCycle.minimum_quantity, 4);
    assert.equal(diffDatabaseSnapshots(snapBeforeFaults, captureDatabaseSnapshot(roDb)).identical, false);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('NL-INT-002 · Escenarios 9 y 10 — Corrección CLI inventory stock <id> (H-INT-003) e integridad global de consultas sobre las 92 tablas', async () => {
  const dirs = makeTempDirs();
  const cfg = { dataDir: dirs.dataDir, backupDir: dirs.backupDir };

  const execCliJson = async argv => {
    const stdout = [];
    const stderr = [];
    const code = await runCli(argv, cfg, {
      stdout: s => stdout.push(s),
      stderr: s => stderr.push(s),
    });
    return {
      code,
      json: stdout.length > 0 ? JSON.parse(stdout[0]) : null,
      errJson: stderr.length > 0 ? JSON.parse(stderr[0]) : null,
    };
  };

  try {
    // 1. Crear producto desde CLI
    const createdProd = await execCliJson(['inventory', 'product', '--name', 'Cable Silicona AWG18', '--unit', 'm']);
    assert.equal(createdProd.code, 0);
    const productId = createdProd.json.id;

    // 2. Escenario 9a: `inventory stock <id>` antes de registrar existencias (devuelve null sin error de binding SQLite)
    const stockBeforeReg = await execCliJson(['inventory', 'stock', productId]);
    assert.equal(stockBeforeReg.code, 0, 'H-INT-003: inventory stock <id> no debe fallar con Unknown named parameter');
    assert.equal(stockBeforeReg.errJson, null);
    assert.equal(stockBeforeReg.json, null);

    // 3. Registrar existencias vía operación universal CLI y volver a consultar `inventory stock <id>`, `inventory stock` y `inventory replenishment`
    const regStock = await execCliJson([
      'op',
      'inventory.stock.register',
      '--json',
      JSON.stringify({ product_id: productId, quantity: 25, unit: 'm' }),
    ]);
    assert.equal(regStock.code, 0);

    const stockAfterReg = await execCliJson(['inventory', 'stock', productId]);
    assert.equal(stockAfterReg.code, 0);
    assert.equal(stockAfterReg.json.product_id, productId);
    assert.equal(stockAfterReg.json.quantity, 25);

    const stockListNoId = await execCliJson(['inventory', 'stock']);
    assert.equal(stockListNoId.code, 0);
    assert.equal(Array.isArray(stockListNoId.json), true);
    assert.equal(stockListNoId.json.length, 1);

    const stockAllOp = await execCliJson(['op', 'inventory.stock.list', '--json', '{}']);
    assert.equal(stockAllOp.code, 0);
    assert.equal(Array.isArray(stockAllOp.json), true);
    assert.equal(stockAllOp.json.length, 1);
    assert.equal(stockAllOp.json[0].product_id, productId);

    const cliReplenishment = await execCliJson(['inventory', 'replenishment', productId]);
    assert.equal(cliReplenishment.code, 0);
    assert.equal(cliReplenishment.json.product_id, productId);
    assert.equal(cliReplenishment.json.current_quantity, 25);

    // 4. Escenario 10: Integridad global verificada mediante snapshot completo de las 92 tablas en una serie amplia de operaciones QUERY
    const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
    try {
      const roDb = core.persistenceService.getReadDatabase();
      const globalSnapBefore = captureDatabaseSnapshot(roDb);
      assert.equal(globalSnapBefore.table_count, 92);

      const queryOperationsToVerify = [
        { operation_type: 'system.status', payload: {} },
        { operation_type: 'modules.list', payload: {} },
        { operation_type: 'persistence.health', payload: {} },
        { operation_type: 'inventory.products.list', payload: {} },
        { operation_type: 'inventory.stock.list', payload: {} },
        { operation_type: 'inventory.stock.list', payload: { product_id: productId } },
        { operation_type: 'inventory.stock.history', payload: { product_id: productId } },
        { operation_type: 'inventory.consumption.list', payload: { product_id: productId } },
        { operation_type: 'inventory.replenishment.status', payload: {} },
        { operation_type: 'inventory.replenishment.status', payload: { product_id: productId } },
        { operation_type: 'inventory.replenishment.status', payload: { onlyAlerts: true } },
        { operation_type: 'inventory.replenishment.calculate', payload: { product_id: productId } },
        { operation_type: 'finance.summary', payload: {} },
        { operation_type: 'memory.context', payload: {} },
        { operation_type: 'adaptation.analyzeHistory', payload: {} },
      ];

      for (const qReq of queryOperationsToVerify) {
        const res = core.executeOperation(qReq);
        assert.equal(res.success, true, `La operación QUERY ${qReq.operation_type} debe ejecutarse con éxito`);
        assert.equal(res.metadata.kind, 'QUERY');
      }

      assertDatabaseSnapshotsEqual(
        captureDatabaseSnapshot(roDb),
        globalSnapBefore,
        'Escenario 10: Cero modificaciones persistentes en las 92 tablas tras ejecutar la batería de operaciones QUERY'
      );
    } finally {
      core.shutdown();
    }
  } finally {
    dirs.cleanup();
  }
});
