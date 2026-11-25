import { createConfig } from '../config.js';
import { createClock } from '../shared/clock.js';
import { ERROR_CODES, NexusError } from '../shared/errors.js';
import { createEventService } from './event-service.js';
import { createAuditService } from './audit-service.js';
import { createModuleRegistryService } from './module-registry-service.js';
import { createSystemService } from './system-service.js';
import { createOperationDispatcher } from './operation-contract.js';
import { createOperationRegistry } from './operation-registry.js';

import { createPersistenceService } from '../infrastructure/persistence/persistence-service.js';
import { createTransactionService } from '../infrastructure/persistence/transaction-service.js';
import { createBackupService } from '../infrastructure/persistence/backup-service.js';
import { createMigrationService } from '../infrastructure/persistence/migration-service.js';
import { createRestoreService } from '../infrastructure/persistence/restore-service.js';
import { createStorageHealthService } from '../infrastructure/persistence/storage-health-service.js';
import { createFileStorageService } from '../infrastructure/persistence/file-storage-service.js';
import { createPreparedSecretStore } from '../infrastructure/security/secret-store-contract.js';
import { createSecurityPolicyService } from '../infrastructure/security/security-policy-service.js';

import { createSystemRepository } from '../infrastructure/repositories/system-repository.js';
import { createMemoryRepository } from '../infrastructure/repositories/memory-repository.js';
import { createPersonalRepository } from '../infrastructure/repositories/personal-repository.js';
import { createTimeRepository } from '../infrastructure/repositories/time-repository.js';
import { createExecutionRepository } from '../infrastructure/repositories/execution-repository.js';
import { createFinanceRepository } from '../infrastructure/repositories/finance-repository.js';
import { createInventoryRepository } from '../infrastructure/repositories/inventory-repository.js';
import { createKnowledgeRepository } from '../infrastructure/repositories/knowledge-repository.js';
import { createHabitRoutineRepository } from '../infrastructure/repositories/habit-routine-repository.js';
import { createPlanningRepository } from '../infrastructure/repositories/planning-repository.js';
import { createAdaptationRepository } from '../infrastructure/repositories/adaptation-repository.js';
import { createAIRepository } from '../infrastructure/repositories/ai-repository.js';

import { createEntityReferenceResolver } from '../application/shared/entity-reference-resolver.js';
import { createRelationService } from '../application/shared/relation-service.js';
import { createSourceService } from '../application/memory/source-service.js';
import { createMemoryService } from '../application/memory/memory-service.js';
import { createMemoryContextService } from '../application/memory/memory-context-service.js';
import { createGoalService } from '../application/personal/goal-service.js';
import { createProjectService } from '../application/personal/project-service.js';
import { createTaskService } from '../application/personal/task-service.js';
import { createActivityService } from '../application/personal/activity-service.js';
import { createCalendarService, createCommitmentService, createAvailabilityService, createTimeBlockService } from '../application/time/time-services.js';
import { createExecutionService, createWorkSessionService, createOutcomeService, createObservationService } from '../application/execution/execution-services.js';
import { createFinancialAccountService, createFinancialTransactionService, createBudgetService, createReserveService, createFinancialCommitmentService } from '../application/finance/finance-services.js';
import { createProductService, createInventoryService, createPurchaseService, createPaymentService, createConsumptionService, createReplenishmentService } from '../application/inventory/inventory-services.js';
import { createLibraryService, createKnowledgeDocumentService, createImportService, createExportService } from '../application/knowledge/knowledge-services.js';
import { createHabitService } from '../application/habits/habit-service.js';
import { createRoutineService } from '../application/routines/routine-service.js';
import { createPlanningEngine } from '../application/planning/planning-engine.js';
import { createPlanningInputService, createPlanningService, createPlanningProposalService, createAgendaService, createDailyReviewService } from '../application/planning/planning-services.js';
import { createAdaptiveAnalysisService, createProactivityService } from '../application/adaptation/adaptation-services.js';
import { createAIProviderRegistry, createAIConversationService, createAIContextService, createAIToolService, createAIOperationService, createAIInteractionService } from '../integration/ai/ai-services.js';
import { createCIOContractBridge } from '../integration/cio/cio-contract.js';
import { markdownAdapter, csvAdapter, jsonAdapter } from '../integration/importers/text-adapters.js';
import { xlsxAdapter } from '../integration/importers/xlsx-adapter.js';

const MODULE_DEFS = Object.freeze([
  { id: 'persistence', name: 'Persistencia y Seguridad', dependencies: [], capabilities: ['sqlite', 'migrations', 'backups', 'audit', 'security_policy'] },
  { id: 'memory', name: 'Memoria Personal', dependencies: ['persistence'], capabilities: ['records', 'sources', 'evidences', 'revisions', 'context'] },
  { id: 'personal', name: 'Gestión Personal', dependencies: ['persistence', 'memory'], capabilities: ['goals', 'projects', 'tasks', 'activities', 'dependencies', 'relations'] },
  { id: 'time', name: 'Tiempo y Disponibilidad', dependencies: ['persistence', 'personal'], capabilities: ['events', 'commitments', 'availability', 'time_blocks'] },
  { id: 'execution', name: 'Ejecución y Seguimiento', dependencies: ['persistence', 'personal', 'time'], capabilities: ['executions', 'sessions', 'outcomes', 'observations'] },
  { id: 'finance', name: 'Finanzas Personales', dependencies: ['persistence', 'personal'], capabilities: ['accounts', 'transactions', 'budgets', 'reserves', 'commitments'] },
  { id: 'inventory', name: 'Compras e Inventario', dependencies: ['persistence', 'finance'], capabilities: ['products', 'purchases', 'payments', 'inventory', 'consumption', 'replenishment'] },
  { id: 'knowledge', name: 'Bibliotecas de Conocimiento', dependencies: ['persistence', 'memory'], capabilities: ['libraries', 'documents', 'import_md_csv_json', 'xlsx_contract'] },
  { id: 'habits', name: 'Hábitos', dependencies: ['persistence', 'personal'], capabilities: ['habits', 'occurrences', 'revisions', 'statistics'] },
  { id: 'routines', name: 'Rutinas', dependencies: ['persistence', 'personal', 'habits'], capabilities: ['routines', 'steps', 'executions', 'revisions'] },
  { id: 'planning', name: 'Planificación Determinista', dependencies: ['personal', 'time', 'execution', 'habits', 'routines'], capabilities: ['weekly_preagenda', 'daily_agenda', 'versioning', 'daily_review'] },
  { id: 'adaptation', name: 'Adaptación y Proactividad', dependencies: ['planning', 'execution', 'habits'], capabilities: ['patterns', 'suggestions', 'proactivity'] },
  { id: 'ai_prepared', name: 'Infraestructura IA Preparada', dependencies: ['persistence', 'memory', 'knowledge', 'planning'], optional: true, capabilities: ['contracts_only_no_llm'] },
]);

export function createNexusCore(configOverrides = {}) {
  const { autoInit = true, nowFn, ...rawConfig } = configOverrides;
  const cfg = createConfig(rawConfig);
  const clock = createClock({ timezone: cfg.timezone, nowFn });

  const persistenceService = createPersistenceService(cfg);
  const backupService = createBackupService({ config: cfg, persistenceService });
  const migrationService = createMigrationService({ persistenceService, backupService });
  const transactionService = createTransactionService(persistenceService);
  const systemRepository = createSystemRepository(persistenceService);
  const eventService = createEventService({ repository: systemRepository, clock });
  const auditService = createAuditService({ persistenceService, clock });
  const secretStore = createPreparedSecretStore();
  const securityPolicyService = createSecurityPolicyService({ config: cfg, auditService });
  const restoreService = createRestoreService({ config: cfg, persistenceService, backupService, migrationService, auditService });
  const storageHealthService = createStorageHealthService({ config: cfg, persistenceService, migrationService, backupService });
  const fileStorageService = createFileStorageService({ config: cfg, persistenceService });

  const moduleRegistry = createModuleRegistryService({ repository: systemRepository, eventService, clock });
  const systemService = createSystemService({ config: cfg, moduleRegistry, eventService, persistenceService, clock });
  const dispatcher = createOperationDispatcher({
    securityPolicyService,
    idempotencyStore: systemRepository,
    auditService,
    eventService,
    moduleRegistry,
    transactionService,
    clock,
  });

  // Repositorios por dominio
  const memoryRepo = createMemoryRepository(persistenceService);
  const personalRepo = createPersonalRepository(persistenceService);
  const timeRepo = createTimeRepository(persistenceService);
  const execRepo = createExecutionRepository(persistenceService);
  const financeRepo = createFinanceRepository(persistenceService);
  const inventoryRepo = createInventoryRepository(persistenceService);
  const knowledgeRepo = createKnowledgeRepository(persistenceService);
  const habitRoutineRepo = createHabitRoutineRepository(persistenceService);
  const planningRepo = createPlanningRepository(persistenceService);
  const adaptationRepo = createAdaptationRepository(persistenceService);
  const aiRepo = createAIRepository(persistenceService);

  const referenceResolver = createEntityReferenceResolver({
    memoryRepository: memoryRepo,
    personalRepository: personalRepo,
    timeRepository: timeRepo,
    executionRepository: execRepo,
    financeRepository: financeRepo,
    inventoryRepository: inventoryRepo,
    knowledgeRepository: knowledgeRepo,
    habitRoutineRepository: habitRoutineRepo,
    planningRepository: planningRepo,
    aiRepository: aiRepo,
  });

  const relationService = createRelationService({
    systemRepository,
    referenceResolver,
    transactionService,
    auditService,
  });

  // Servicios de dominio
  const sourceService = createSourceService({ memoryRepository: memoryRepo, clock });
  const memoryService = createMemoryService({ memoryRepository: memoryRepo, sourceService, transactionService, auditService, clock });
  const memoryContextService = createMemoryContextService({ memoryRepository: memoryRepo, sourceService, securityPolicyService, clock });

  const taskService = createTaskService({ personalRepository: personalRepo, auditService, clock });
  const goalService = createGoalService({ personalRepository: personalRepo, auditService, clock });
  const projectService = createProjectService({ personalRepository: personalRepo, taskService, auditService, clock });
  const activityService = createActivityService({ personalRepository: personalRepo, auditService, clock });

  const calendarService = createCalendarService({ timeRepository: timeRepo, referenceResolver, auditService, clock });
  const commitmentService = createCommitmentService({ timeRepository: timeRepo, referenceResolver, auditService, clock });
  const availabilityService = createAvailabilityService({ timeRepository: timeRepo, clock });
  const timeBlockService = createTimeBlockService({ timeRepository: timeRepo, referenceResolver, clock });

  const executionService = createExecutionService({ executionRepository: execRepo, referenceResolver, auditService, clock });
  const workSessionService = createWorkSessionService({ executionRepository: execRepo, taskService, transactionService, clock });
  const outcomeService = createOutcomeService({ executionRepository: execRepo, clock });
  const observationService = createObservationService({ executionRepository: execRepo, referenceResolver, clock });

  const financialAccountService = createFinancialAccountService({ financeRepository: financeRepo, clock });
  const financialTransactionService = createFinancialTransactionService({ financeRepository: financeRepo, referenceResolver, transactionService, auditService, clock });
  const budgetService = createBudgetService({ financeRepository: financeRepo, clock });
  const reserveService = createReserveService({ financeRepository: financeRepo, referenceResolver, clock });
  const financialCommitmentService = createFinancialCommitmentService({ financeRepository: financeRepo, referenceResolver, clock });

  const productService = createProductService({ inventoryRepository: inventoryRepo, transactionService, clock });
  const inventoryService = createInventoryService({ inventoryRepository: inventoryRepo, transactionService, clock });
  const purchaseService = createPurchaseService({ inventoryRepository: inventoryRepo, inventoryService, transactionService, clock });
  const paymentService = createPaymentService({ inventoryRepository: inventoryRepo, transactionService, clock });
  const consumptionService = createConsumptionService({ inventoryRepository: inventoryRepo, inventoryService, transactionService, clock });
  const replenishmentService = createReplenishmentService({ inventoryRepository: inventoryRepo, inventoryService, transactionService, clock });

  const defaultFormatAdapters = [markdownAdapter, csvAdapter, jsonAdapter, xlsxAdapter];
  const libraryService = createLibraryService({ knowledgeRepository: knowledgeRepo, clock });
  const knowledgeDocumentService = createKnowledgeDocumentService({ knowledgeRepository: knowledgeRepo, clock });
  const importService = createImportService({
    knowledgeRepository: knowledgeRepo,
    documentService: knowledgeDocumentService,
    sourceService,
    transactionService,
    adapters: defaultFormatAdapters,
    clock,
  });
  const exportService = createExportService({
    knowledgeRepository: knowledgeRepo,
    adapters: defaultFormatAdapters,
    clock,
  });

  const habitService = createHabitService({ habitRoutineRepository: habitRoutineRepo, transactionService, auditService, clock });
  const routineService = createRoutineService({ habitRoutineRepository: habitRoutineRepo, habitService, transactionService, auditService, clock });

  const planningInputService = createPlanningInputService({
    goalService,
    projectService,
    taskService,
    activityService,
    habitService,
    routineService,
    calendarService,
    commitmentService,
    availabilityService,
    financialTransactionService,
    financialCommitmentService,
    replenishmentService,
    relationService,
    personalRepository: personalRepo,
    clock,
  });
  const planningEngine = createPlanningEngine({ clock });
  const planningService = createPlanningService({ planningRepository: planningRepo, transactionService, auditService, clock });
  const planningProposalService = createPlanningProposalService({
    planningRepository: planningRepo,
    planningInputService,
    planningEngine,
    planningService,
    transactionService,
    clock,
  });
  const agendaService = createAgendaService({ planningService, planningProposalService, planningRepository: planningRepo, clock });
  const dailyReviewService = createDailyReviewService({ planningRepository: planningRepo, executionService, habitService, routineService, clock });

  const adaptiveAnalysisService = createAdaptiveAnalysisService({
    adaptationRepository: adaptationRepo,
    projectService,
    taskService,
    executionService,
    workSessionService,
    observationService,
    habitService,
    planningService,
    replenishmentService,
    transactionService,
    auditService,
    clock,
  });
  const proactivityService = createProactivityService({ adaptationRepository: adaptationRepo, calendarService, taskService, clock });

  const aiProviderRegistry = createAIProviderRegistry({ aiRepository: aiRepo, secretStore, clock });
  const aiConversationService = createAIConversationService({ aiRepository: aiRepo, clock });
  const aiContextService = createAIContextService({
    aiRepository: aiRepo,
    memoryContextService,
    documentService: knowledgeDocumentService,
    securityPolicyService,
    clock,
  });
  const aiToolService = createAIToolService({ aiRepository: aiRepo, clock });
  const aiOperationService = createAIOperationService({ aiRepository: aiRepo, transactionService, auditService, clock });
  const aiInteractionService = createAIInteractionService({
    providerRegistry: aiProviderRegistry,
    conversationService: aiConversationService,
    contextService: aiContextService,
  });
  const cioBridge = createCIOContractBridge({ memoryService, sourceService, transactionService });

  let initialized = false;

  const core = {
    config: cfg,
    clock,
    dispatcher,
    systemRepository,
    referenceResolver,
    relationService,
    // Transversales
    systemService,
    moduleRegistry,
    eventService,
    auditService,
    persistenceService,
    transactionService,
    migrationService,
    backupService,
    restoreService,
    storageHealthService,
    fileStorageService,
    securityPolicyService,
    secretStore,
    // Dominios
    sourceService,
    memoryService,
    memoryContextService,
    goalService,
    projectService,
    taskService,
    activityService,
    calendarService,
    commitmentService,
    availabilityService,
    timeBlockService,
    executionService,
    workSessionService,
    outcomeService,
    observationService,
    financialAccountService,
    financialTransactionService,
    budgetService,
    reserveService,
    financialCommitmentService,
    productService,
    inventoryService,
    purchaseService,
    paymentService,
    consumptionService,
    replenishmentService,
    libraryService,
    knowledgeDocumentService,
    importService,
    exportService,
    habitService,
    routineService,
    planningInputService,
    planningEngine,
    planningService,
    planningProposalService,
    agendaService,
    dailyReviewService,
    adaptiveAnalysisService,
    proactivityService,
    // Integraciones preparadas
    aiProviderRegistry,
    aiConversationService,
    aiContextService,
    aiToolService,
    aiOperationService,
    aiInteractionService,
    cioBridge,

    initialize() {
      if (initialized) return systemService.getSystemStatus();
      persistenceService.initializeStorage();
      migrationService.executeMigration();
      for (const m of MODULE_DEFS) moduleRegistry.registerModule(m);
      const status = systemService.initialize();
      initialized = true;
      return status;
    },

    isInitialized() {
      return initialized;
    },

    shutdown() {
      initialized = false;
      return systemService.shutdown();
    },
  };

  const operations = createOperationRegistry(core);
  core.operations = operations;
  core.executeOperation = rawRequest => operations.dispatch(rawRequest);
  core.executeOperationAsync = rawRequest => operations.dispatchAsync(rawRequest);

  // Conectar herramientas de solo lectura y ejecutores de propuestas autorizadas de IA al catálogo común
  aiToolService.registerTool({ name: 'tasks.list', description: 'Consulta tareas', mode: 'READ_ONLY', handler: i => taskService.listTasks(i) });
  aiToolService.registerTool({ name: 'habits.list', description: 'Consulta hábitos', mode: 'READ_ONLY', handler: i => habitService.listHabits(i) });
  aiToolService.registerTool({ name: 'memory.search', description: 'Consulta memoria autorizada', mode: 'READ_ONLY', handler: i => aiContextService.retrieveRelevantMemory(i) });

  for (const opMeta of operations.listOperations({ kind: 'MUTATION' })) {
    if (opMeta.module_id === 'ai_prepared' || opMeta.async) continue;
    aiOperationService.registerOperationExecutor(opMeta.operation_type, (proposedChanges, { authorization, proposal }) => {
      const resp = operations.dispatch({
        operation_type: opMeta.operation_type,
        payload: proposedChanges,
        source: { actor_type: 'AI_ASSISTANT', actor_id: `ai_proposal:${proposal.id}` },
        authorization: {
          approved: true,
          authorized_by: authorization.authorized_by,
          expires_at: authorization.expiration,
          scope: opMeta.operation_type,
        },
      });
      if (!resp.success) {
        const firstErr = resp.errors?.[0];
        throw new NexusError(firstErr?.code ?? ERROR_CODES.OPERATION_FAILED, firstErr?.description ?? 'Fallo al ejecutar propuesta de IA.');
      }
      return resp.result;
    });
  }

  if (autoInit) {
    core.initialize();
  }

  return core;
}
