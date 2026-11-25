import { ERROR_CODES, NexusError, normalizeError } from '../shared/errors.js';
import { errorResponse, createOperationRequest } from './operation-contract.js';
import {
  prepareSaturdayReview,
  approveSaturdayDraft,
} from '../application/planning/saturday-review-orchestrator.js';
import { closeWeekAndAnalyze } from '../application/planning/weekly-execution-tracker.js';
import { formatDeterministicSaturdayBriefing } from '../integration/ai/copilot-proposal-bridge.js';
import { CLINICAL_RANGES } from '../domain/personal/clinical-reference-library.js';
import { STANDARD_EXERCISES } from '../domain/knowledge/exercise-library-contract.js';

export function createOperationRegistry(core) {
  const specs = new Map();

  function register(spec) {
    if (!spec?.operation_type || typeof spec.operation_type !== 'string') {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'operation_type requerido al registrar operación.');
    }
    if (typeof spec.handler !== 'function') {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `handler requerido para ${spec.operation_type}.`);
    }
    const kind = spec.kind ?? (spec.action === 'READ' ? 'QUERY' : 'MUTATION');
    const action = spec.action ?? (kind === 'QUERY' ? 'READ' : 'EXECUTE');
    const normalized = Object.freeze({
      operation_type: spec.operation_type,
      kind,
      module_id: spec.module_id ?? 'system',
      action,
      sensitivity: spec.sensitivity ?? 'PERSONAL',
      sensitiveOperation: Boolean(spec.sensitiveOperation ?? false),
      atomic: spec.atomic !== undefined ? Boolean(spec.atomic) : kind === 'MUTATION',
      async: Boolean(spec.async ?? false),
      bypassModuleCheck: Boolean(spec.bypassModuleCheck ?? false),
      event_type: spec.event_type ?? (kind === 'MUTATION' ? `operation.${spec.operation_type}` : null),
      description: spec.description ?? '',
      handler: spec.handler,
    });
    specs.set(normalized.operation_type, normalized);
    return normalized;
  }

  const q = (operation_type, module_id, handler, extra = {}) =>
    register({ operation_type, kind: 'QUERY', action: 'READ', module_id, handler, ...extra });

  const m = (operation_type, module_id, action, handler, extra = {}) =>
    register({ operation_type, kind: 'MUTATION', action, module_id, handler, ...extra });

  // === SYSTEM & MODULES ===
  q('system.status', 'system', () => core.systemService.getSystemStatus(), { sensitivity: 'INTERNAL', description: 'Estado general del núcleo y módulos.' });
  q('system.doctor', 'system', async req => core.doctorService.runDiagnostics({ referenceDate: req.payload?.referenceDate ?? null }), { async: true, sensitivity: 'INTERNAL', bypassModuleCheck: true, description: 'Diagnóstico operativo integral de almacenamiento, baselines SHA-256, espacios, bibliotecas y sonda de IA.' });
  q('system.version', 'system', () => core.systemService.getVersion(), { sensitivity: 'PUBLIC' });
  q('system.config.get', 'system', () => core.systemService.getConfiguration(), { sensitivity: 'INTERNAL' });
  m('system.config.update', 'system', 'UPDATE', req => core.systemService.updateConfiguration(req.payload), { sensitivity: 'INTERNAL' });
  q('modules.list', 'system', req => core.moduleRegistry.listModules(req.payload), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  q('modules.get', 'system', req => core.moduleRegistry.getModule(req.payload.id), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  m('modules.enable', 'system', 'UPDATE', req => core.moduleRegistry.enableModule(req.payload.id), { bypassModuleCheck: true });
  m('modules.disable', 'system', 'UPDATE', req => core.moduleRegistry.disableModule(req.payload.id), { bypassModuleCheck: true });
  q('events.list', 'system', req => core.eventService.listEvents(req.payload), { sensitivity: 'INTERNAL' });
  q('audit.history', 'persistence', req => core.auditService.getOperationHistory(req.payload), { sensitivity: 'SENSITIVE' });
  q('audit.entity', 'persistence', req => core.auditService.getEntityHistory(req.payload.entity_type, req.payload.entity_id, req.payload), { sensitivity: 'SENSITIVE' });
  q('audit.security', 'persistence', req => core.auditService.getSecurityEvents(req.payload), { sensitivity: 'SENSITIVE' });
  q('relations.list', 'personal', req => core.relationService.listRelations(req.payload));
  m('relations.create', 'personal', 'CREATE', req => core.relationService.createRelation(req.payload));
  m('relations.retire', 'personal', 'ARCHIVE', req => core.relationService.retireRelation(req.payload.id, req.payload));

  // === PERSISTENCE, MIGRATIONS, BACKUP, RESTORE, FILES & SECURITY ===
  q('persistence.health', 'persistence', () => core.storageHealthService.inspectStorage(), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  m('persistence.cleanTemp', 'persistence', 'EXECUTE', () => core.storageHealthService.cleanTemporaryFiles(), { atomic: false, bypassModuleCheck: true });
  q('migrations.status', 'persistence', () => core.migrationService.getMigrationStatus(), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  q('migrations.history', 'persistence', () => core.migrationService.getMigrationHistory(), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  q('migrations.legacyReports', 'persistence', () => core.migrationService.getLegacyMigrationReports(), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  m('migrations.execute', 'persistence', 'EXECUTE', req => core.migrationService.executeMigration(req.payload), { atomic: false, bypassModuleCheck: true });
  q('backup.list', 'persistence', () => core.backupService.listBackups(), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  q('backup.get', 'persistence', req => core.backupService.getBackup(req.payload.id), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  q('backup.verify', 'persistence', req => core.backupService.verifyBackup(req.payload.id), { sensitivity: 'INTERNAL', bypassModuleCheck: true });
  m('backup.create', 'persistence', 'CREATE', req => core.backupService.createBackup(req.payload), { atomic: false, bypassModuleCheck: true });
  m('backup.delete', 'persistence', 'DELETE', req => core.backupService.deleteBackup(req.payload.id), { sensitiveOperation: true, atomic: false, bypassModuleCheck: true });
  q('restore.inspect', 'persistence', req => core.restoreService.inspectBackup(req.payload.id), { sensitivity: 'SENSITIVE', bypassModuleCheck: true });
  q('restore.validate', 'persistence', req => core.restoreService.validateRestore(req.payload.id), { sensitivity: 'SENSITIVE', bypassModuleCheck: true });
  q('restore.history', 'persistence', () => core.restoreService.getRestoreHistory(), { sensitivity: 'SENSITIVE', bypassModuleCheck: true });
  m('restore.authorize', 'persistence', 'APPROVE', req => core.restoreService.requestRestoreAuthorization(req.payload.id, req.payload), { bypassModuleCheck: true });
  m('restore.execute', 'persistence', 'RESTORE', req => core.restoreService.restoreBackup(req.payload.id, { authorization: req.authorization ?? req.payload.authorization }), {
    sensitiveOperation: true,
    atomic: false,
    bypassModuleCheck: true,
  });
  q('files.list', 'persistence', req => core.fileStorageService.listFiles(req.payload));
  q('files.get', 'persistence', req => core.fileStorageService.getFileMetadata(req.payload.id));
  m('files.store', 'persistence', 'CREATE', req => core.fileStorageService.storeFile(req.payload), { atomic: false });
  q('security.policy', 'persistence', () => core.securityPolicyService.getSecurityPolicy(), { sensitivity: 'INTERNAL', bypassModuleCheck: true });

  // === MEMORY ===
  q('sources.list', 'memory', req => core.sourceService.listSources(req.payload));
  m('sources.register', 'memory', 'CREATE', req => core.sourceService.registerSource(req.payload));
  m('sources.attachEvidence', 'memory', 'CREATE', req => core.sourceService.attachEvidence(req.payload.memory_id, req.payload));
  q('memory.search', 'memory', req => core.memoryService.searchMemory(req.payload));
  q('memory.get', 'memory', req => core.memoryService.getMemory(req.payload.id));
  q('memory.history', 'memory', req => core.memoryService.getMemoryHistory(req.payload.id));
  q('memory.context', 'memory', req => core.memoryContextService.buildContext(req.payload));
  m('memory.create', 'memory', 'CREATE', req => core.memoryService.createMemory(req.payload));
  m('memory.update', 'memory', 'UPDATE', req => core.memoryService.updateMemory(req.payload.id, req.payload));
  m('memory.correct', 'memory', 'CORRECT', req => core.memoryService.correctMemory(req.payload.id, req.payload));
  m('memory.relate', 'memory', 'CREATE', req => core.memoryService.relateMemory(req.payload));
  m('memory.retire', 'memory', 'ARCHIVE', req => core.memoryService.retireMemory(req.payload.id, req.payload));
  m('memory.archive', 'memory', 'ARCHIVE', req => core.memoryService.archiveMemory(req.payload.id, req.payload));

  // === PERSONAL (GOALS, PROJECTS, TASKS, ACTIVITIES, PRIORITIES) ===
  q('priorities.list', 'personal', () => core.activityService.listPriorities());
  m('priorities.upsert', 'personal', 'UPDATE', req => core.activityService.upsertPriority(req.payload));
  q('goals.list', 'personal', req => core.goalService.listGoals(req.payload));
  q('goals.get', 'personal', req => core.goalService.getGoal(req.payload.id));
  m('goals.create', 'personal', 'CREATE', req => core.goalService.createGoal(req.payload));
  m('goals.update', 'personal', 'UPDATE', req => core.goalService.updateGoal(req.payload.id, req.payload));
  m('goals.changeStatus', 'personal', 'UPDATE', req => core.goalService.changeGoalStatus(req.payload.id, req.payload.status, req.payload));
  m('goals.relateProject', 'personal', 'UPDATE', req => core.goalService.relateProject(req.payload.goal_id, req.payload.project_id));
  m('goals.relateTask', 'personal', 'UPDATE', req => core.goalService.relateTask(req.payload.goal_id, req.payload.task_id));
  m('goals.recordOutcome', 'personal', 'CREATE', req => core.goalService.recordGoalOutcome(req.payload.goal_id, req.payload));
  m('goals.archive', 'personal', 'ARCHIVE', req => core.goalService.archiveGoal(req.payload.id));

  q('projects.list', 'personal', req => core.projectService.listProjects(req.payload));
  q('projects.get', 'personal', req => core.projectService.getProject(req.payload.id));
  q('projects.progress', 'personal', req => core.projectService.getProjectProgress(req.payload.id));
  m('projects.create', 'personal', 'CREATE', req => core.projectService.createProject(req.payload));
  m('projects.update', 'personal', 'UPDATE', req => core.projectService.updateProject(req.payload.id, req.payload));
  m('projects.changeStatus', 'personal', 'UPDATE', req => core.projectService.changeProjectStatus(req.payload.id, req.payload.status, req.payload));
  m('projects.relateGoal', 'personal', 'UPDATE', req => core.projectService.relateGoal(req.payload.project_id, req.payload.goal_id));
  m('projects.relateTask', 'personal', 'UPDATE', req => core.projectService.relateTask(req.payload.project_id, req.payload.task_id));
  m('projects.archive', 'personal', 'ARCHIVE', req => core.projectService.archiveProject(req.payload.id));

  q('tasks.list', 'personal', req => core.taskService.listTasks(req.payload));
  q('tasks.get', 'personal', req => core.taskService.getTask(req.payload.id));
  q('tasks.dependencies', 'personal', req => core.taskService.getTaskDependencies(req.payload.id));
  q('tasks.history', 'personal', req => core.taskService.getTaskHistory(req.payload.id));
  m('tasks.create', 'personal', 'CREATE', req => core.taskService.createTask(req.payload));
  m('tasks.update', 'personal', 'UPDATE', req => core.taskService.updateTask(req.payload.id, req.payload));
  m('tasks.changeStatus', 'personal', 'UPDATE', req => core.taskService.changeTaskStatus(req.payload.id, req.payload.status, req.payload));
  m('tasks.addDependency', 'personal', 'CREATE', req => core.taskService.addDependency(req.payload.task_id, req.payload.depends_on_task_id, req.payload));
  m('tasks.removeDependency', 'personal', 'UPDATE', req => core.taskService.removeDependency(req.payload.task_id, req.payload.depends_on_task_id));
  m('tasks.archive', 'personal', 'ARCHIVE', req => core.taskService.archiveTask(req.payload.id));

  q('activities.list', 'personal', req => core.activityService.listActivities(req.payload));
  q('activities.get', 'personal', req => core.activityService.getActivity(req.payload.id));
  m('activities.create', 'personal', 'CREATE', req => core.activityService.createActivity(req.payload));
  m('activities.update', 'personal', 'UPDATE', req => core.activityService.updateActivity(req.payload.id, req.payload));
  m('activities.archive', 'personal', 'ARCHIVE', req => core.activityService.archiveActivity(req.payload.id));

  // === TIME & AVAILABILITY ===
  q('calendar.listEvents', 'time', req => core.calendarService.listEvents(req.payload));
  q('calendar.getEvent', 'time', req => core.calendarService.getEvent(req.payload.id));
  q('calendar.conflicts', 'time', req => core.calendarService.detectEventConflicts(req.payload));
  m('calendar.createEvent', 'time', 'CREATE', req => core.calendarService.createEvent(req.payload));
  m('calendar.updateEvent', 'time', 'UPDATE', req => core.calendarService.updateEvent(req.payload.id, req.payload));
  m('calendar.rescheduleEvent', 'time', 'UPDATE', req =>
    core.calendarService.rescheduleEvent
      ? core.calendarService.rescheduleEvent(req.payload.id, req.payload)
      : core.calendarService.updateEvent(req.payload.id, req.payload)
  );
  m('calendar.confirmEvent', 'time', 'UPDATE', req => core.calendarService.confirmEvent(req.payload.id));
  m('calendar.cancelEvent', 'time', 'UPDATE', req => core.calendarService.cancelEvent(req.payload.id, req.payload));

  q('commitments.list', 'time', req => core.commitmentService.listCommitments(req.payload));
  q('commitments.get', 'time', req => core.commitmentService.getCommitment(req.payload.id));
  m('commitments.create', 'time', 'CREATE', req => core.commitmentService.createCommitment(req.payload));
  m('commitments.update', 'time', 'UPDATE', req => core.commitmentService.updateCommitment(req.payload.id, req.payload));
  m('commitments.complete', 'time', 'UPDATE', req => core.commitmentService.completeCommitment(req.payload.id));
  m('commitments.cancel', 'time', 'UPDATE', req => core.commitmentService.cancelCommitment(req.payload.id));

  q('availability.list', 'time', req => core.availabilityService.getAvailability(req.payload));
  q('availability.freeWindows', 'time', req => core.availabilityService.calculateFreeWindows(req.payload));
  m('availability.createWindow', 'time', 'CREATE', req => core.availabilityService.createAvailabilityWindow(req.payload));
  m('availability.updateWindow', 'time', 'UPDATE', req => core.availabilityService.updateAvailabilityWindow(req.payload.id, req.payload));

  q('timeBlocks.list', 'time', req => core.timeBlockService.getTimeBlocksByPeriod(req.payload));
  q('timeBlocks.conflicts', 'time', req => core.timeBlockService.detectTimeBlockConflicts(req.payload));
  m('timeBlocks.create', 'time', 'CREATE', req => core.timeBlockService.createTimeBlock(req.payload));
  m('timeBlocks.move', 'time', 'UPDATE', req => core.timeBlockService.moveTimeBlock(req.payload.id, req.payload));
  m('timeBlocks.remove', 'time', 'ARCHIVE', req => core.timeBlockService.removeTimeBlock(req.payload.id));

  // === EXECUTION & TRACKING ===
  q('executions.list', 'execution', req => core.executionService.listExecutions(req.payload));
  q('executions.get', 'execution', req => core.executionService.getExecution(req.payload.id));
  m('executions.start', 'execution', 'CREATE', req => core.executionService.startExecution(req.payload));
  m('executions.pause', 'execution', 'UPDATE', req => core.executionService.pauseExecution(req.payload.id, req.payload));
  m('executions.resume', 'execution', 'UPDATE', req => core.executionService.resumeExecution(req.payload.id));
  m('executions.complete', 'execution', 'UPDATE', req => core.executionService.completeExecution(req.payload.id, req.payload));
  m('executions.interrupt', 'execution', 'UPDATE', req => core.executionService.interruptExecution(req.payload.id, req.payload));
  m('executions.cancel', 'execution', 'UPDATE', req => core.executionService.cancelExecution(req.payload.id, req.payload));

  q('sessions.list', 'execution', req => core.workSessionService.listSessionsByExecution(req.payload.execution_id));
  m('sessions.start', 'execution', 'CREATE', req => core.workSessionService.startSession(req.payload));
  m('sessions.pause', 'execution', 'UPDATE', req => core.workSessionService.pauseSession(req.payload.id));
  m('sessions.resume', 'execution', 'UPDATE', req => core.workSessionService.resumeSession(req.payload.id));
  m('sessions.end', 'execution', 'UPDATE', req => core.workSessionService.endSession(req.payload.id, req.payload));

  q('outcomes.list', 'execution', req => core.outcomeService.listOutcomesByExecution(req.payload.execution_id));
  m('outcomes.record', 'execution', 'CREATE', req => core.outcomeService.recordOutcome(req.payload));
  m('outcomes.update', 'execution', 'UPDATE', req => core.outcomeService.updateOutcome(req.payload.id, req.payload));

  q('observations.list', 'execution', req => core.observationService.listObservations(req.payload));
  m('observations.create', 'execution', 'CREATE', req => core.observationService.createObservation(req.payload));

  // === FINANCE ===
  q('finance.accounts.list', 'finance', req => core.financialAccountService.listAccounts(req.payload), { sensitivity: 'SENSITIVE' });
  q('finance.accounts.balance', 'finance', req => core.financialAccountService.getAccountBalance(req.payload.id), { sensitivity: 'SENSITIVE' });
  m('finance.accounts.create', 'finance', 'CREATE', req => core.financialAccountService.createAccount(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.accounts.update', 'finance', 'UPDATE', req => core.financialAccountService.updateAccount(req.payload.id, req.payload), { sensitivity: 'SENSITIVE' });

  q('finance.transactions.list', 'finance', req => core.financialTransactionService.listTransactions(req.payload), { sensitivity: 'SENSITIVE' });
  q('finance.summary', 'finance', req => core.financialTransactionService.getFinancialSummary(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.recordIncome', 'finance', 'CREATE', req => core.financialTransactionService.recordIncome(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.recordExpense', 'finance', 'CREATE', req => core.financialTransactionService.recordExpense(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.recordTransfer', 'finance', 'CREATE', req => core.financialTransactionService.recordTransfer(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.recordRefund', 'finance', 'CREATE', req => core.financialTransactionService.recordRefund(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.recordAdjustment', 'finance', 'CORRECT', req => core.financialTransactionService.recordAdjustment(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.correctTransaction', 'finance', 'CORRECT', req => core.financialTransactionService.correctTransaction(req.payload.id, req.payload), { sensitivity: 'SENSITIVE' });

  q('finance.budgets.execution', 'finance', req => core.budgetService.getBudgetExecution(req.payload.id), { sensitivity: 'SENSITIVE' });
  m('finance.budgets.create', 'finance', 'CREATE', req => core.budgetService.createBudget(req.payload), { sensitivity: 'SENSITIVE' });
  q('finance.reserves.list', 'finance', req => core.reserveService.listReserves(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.reserves.create', 'finance', 'CREATE', req => core.reserveService.createReserve(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.reserves.release', 'finance', 'UPDATE', req => core.reserveService.releaseReserve(req.payload.id), { sensitivity: 'SENSITIVE' });
  q('finance.commitments.list', 'finance', req => core.financialCommitmentService.listPendingCommitments(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.commitments.create', 'finance', 'CREATE', req => core.financialCommitmentService.createFinancialCommitment(req.payload), { sensitivity: 'SENSITIVE' });
  m('finance.commitments.settle', 'finance', 'UPDATE', req => core.financialCommitmentService.settleFinancialCommitment(req.payload.id, req.payload), { sensitivity: 'SENSITIVE' });

  // === INVENTORY & PURCHASES ===
  q('inventory.products.list', 'inventory', req => core.productService.listProducts(req.payload));
  m('inventory.products.create', 'inventory', 'CREATE', req => core.productService.createProduct(req.payload));
  m('inventory.products.update', 'inventory', 'UPDATE', req => core.productService.updateProduct(req.payload.id, req.payload));
  q('inventory.stock.list', 'inventory', req => {
    const { product_id = null, id = null, location } = req.payload ?? {};
    const targetProductId = product_id ?? id ?? null;
    return core.inventoryService.getInventory(targetProductId, location);
  });
  q('inventory.stock.history', 'inventory', req => {
    const payload = req.payload ?? {};
    return core.inventoryService.getInventoryHistory(payload.product_id ?? payload.id ?? null, payload);
  });
  m('inventory.stock.register', 'inventory', 'CREATE', req => core.inventoryService.registerInventory(req.payload));
  m('inventory.stock.adjust', 'inventory', 'CORRECT', req => core.inventoryService.adjustInventory(req.payload));
  q('inventory.purchases.list', 'inventory', req => core.purchaseService.listPurchases(req.payload));
  q('inventory.purchases.get', 'inventory', req => core.purchaseService.getPurchase(req.payload.id));
  m('inventory.purchases.create', 'inventory', 'CREATE', req => core.purchaseService.createPurchase(req.payload));
  m('inventory.purchases.receive', 'inventory', 'UPDATE', req => core.purchaseService.receivePurchaseItems(req.payload.id, req.payload));
  m('inventory.payments.record', 'inventory', 'CREATE', req => core.paymentService.recordPayment(req.payload), { sensitivity: 'SENSITIVE' });
  m('inventory.payments.correct', 'inventory', 'CORRECT', req => core.paymentService.correctPayment(req.payload.id, req.payload), { sensitivity: 'SENSITIVE' });
  q('inventory.consumption.list', 'inventory', req => core.consumptionService.getConsumptionHistory(req.payload));
  m('inventory.consumption.record', 'inventory', 'CREATE', req => core.consumptionService.recordConsumption(req.payload));
  m('inventory.consumption.correct', 'inventory', 'CORRECT', req => core.consumptionService.correctConsumption(req.payload.id, req.payload));
  q('inventory.replenishment.status', 'inventory', req => core.replenishmentService.getReplenishmentStatus(req.payload));
  q('inventory.replenishment.calculate', 'inventory', req => {
    const payload = req.payload ?? {};
    if (payload.product && typeof payload.product === 'object') {
      return core.replenishmentService.evaluateReplenishmentNeed(payload);
    }
    return core.replenishmentService.calculateReplenishmentNeed(payload.product_id ?? payload.id, payload);
  });

  // === KNOWLEDGE LIBRARIES ===
  q('knowledge.libraries.list', 'knowledge', req => core.libraryService.listLibraries(req.payload), { sensitivity: 'INTERNAL' });
  q('knowledge.libraries.get', 'knowledge', req => core.libraryService.getLibrary(req.payload.id), { sensitivity: 'INTERNAL' });
  m('knowledge.libraries.create', 'knowledge', 'CREATE', req => core.libraryService.createLibrary(req.payload), { sensitivity: 'INTERNAL' });
  m('knowledge.libraries.disable', 'knowledge', 'UPDATE', req => core.libraryService.disableLibrary(req.payload.id), { sensitivity: 'INTERNAL' });
  m('knowledge.libraries.enable', 'knowledge', 'UPDATE', req => core.libraryService.enableLibrary(req.payload.id), { sensitivity: 'INTERNAL' });
  q('knowledge.documents.search', 'knowledge', req => core.knowledgeDocumentService.searchDocuments(req.payload), { sensitivity: 'INTERNAL' });
  q('knowledge.documents.get', 'knowledge', req => core.knowledgeDocumentService.getDocument(req.payload.id), { sensitivity: 'INTERNAL' });
  m('knowledge.documents.create', 'knowledge', 'CREATE', req => core.knowledgeDocumentService.createDocument(req.payload), { sensitivity: 'INTERNAL' });
  m('knowledge.documents.update', 'knowledge', 'UPDATE', req => core.knowledgeDocumentService.updateDocument(req.payload.id, req.payload), { sensitivity: 'INTERNAL' });
  q('knowledge.formats', 'knowledge', () => core.importService.listSupportedFormats(), { sensitivity: 'PUBLIC' });
  m('knowledge.import', 'knowledge', 'CREATE', async req => {
    const job = core.importService.createImportJob(req.payload);
    return core.importService.executeImport(job.id, req.payload);
  }, { async: true, atomic: false, sensitivity: 'INTERNAL' });
  m('knowledge.export', 'knowledge', 'EXPORT', async req => {
    const job = core.exportService.createExportJob(req.payload);
    return core.exportService.executeExport(job.id);
  }, { async: true, atomic: false, sensitivity: 'INTERNAL' });
  m('knowledge.seedStarter', 'knowledge', 'CREATE', () => core.starterLibrarySeeder.seedStarterLibraries(), { sensitivity: 'INTERNAL', description: 'Siembra idempotente de 27 productos en MXN y 15 recetas base en SQLite.' });

  // === HABITS & ROUTINES ===
  q('habits.list', 'habits', req => core.habitService.listHabits(req.payload));
  q('habits.get', 'habits', req => core.habitService.getHabit(req.payload.id));
  q('habits.occurrences', 'habits', req => core.habitService.getHabitOccurrences(req.payload.id, req.payload));
  q('habits.history', 'habits', req => core.habitService.getHabitHistory(req.payload.id));
  q('habits.stats', 'habits', req => core.habitService.calculateHabitStatistics(req.payload.id, req.payload));
  m('habits.create', 'habits', 'CREATE', req => core.habitService.createHabit(req.payload));
  m('habits.update', 'habits', 'UPDATE', req => core.habitService.updateHabit(req.payload.id, req.payload));
  m('habits.updateFrequency', 'habits', 'UPDATE', req => core.habitService.updateHabitFrequency(req.payload.id, req.payload));
  m('habits.pause', 'habits', 'UPDATE', req => core.habitService.pauseHabit(req.payload.id));
  m('habits.resume', 'habits', 'UPDATE', req => core.habitService.resumeHabit(req.payload.id));
  m('habits.archive', 'habits', 'ARCHIVE', req => core.habitService.archiveHabit(req.payload.id));
  m('habits.recordOccurrence', 'habits', 'CREATE', req => core.habitService.recordHabitOccurrence(req.payload.id ?? req.payload.habit_id, req.payload));
  m('habits.correctOccurrence', 'habits', 'CORRECT', req => core.habitService.correctHabitOccurrence(req.payload.id ?? req.payload.habit_id, req.payload));

  q('routines.list', 'routines', req => core.routineService.listRoutines(req.payload));
  q('routines.get', 'routines', req => core.routineService.getRoutine(req.payload.id));
  q('routines.executions', 'routines', req => core.routineService.listRoutineExecutions(req.payload));
  q('routines.history', 'routines', req => core.routineService.getRoutineHistory(req.payload.id));
  m('routines.create', 'routines', 'CREATE', req => core.routineService.createRoutine(req.payload));
  m('routines.update', 'routines', 'UPDATE', req => core.routineService.updateRoutine(req.payload.id, req.payload));
  m('routines.addStep', 'routines', 'CREATE', req => core.routineService.addRoutineStep(req.payload.routine_id ?? req.payload.id, req.payload));
  m('routines.reorderSteps', 'routines', 'UPDATE', req => core.routineService.reorderRoutineSteps(req.payload.routine_id ?? req.payload.id, req.payload.ordered_step_ids));
  m('routines.startExecution', 'routines', 'CREATE', req => core.routineService.startRoutineExecution(req.payload.routine_id ?? req.payload.id, req.payload));
  m('routines.updateStepExecution', 'routines', 'UPDATE', req => core.routineService.updateRoutineStepExecution(req.payload.execution_id, req.payload.step_execution_id, req.payload));
  m('routines.completeExecution', 'routines', 'UPDATE', req => core.routineService.completeRoutineExecution(req.payload.execution_id, req.payload));
  m('routines.interruptExecution', 'routines', 'UPDATE', req => core.routineService.interruptRoutineExecution(req.payload.execution_id, req.payload));

  // === PLANNING & DAILY REVIEW ===
  q('planning.plans.list', 'planning', req => core.planningService.listPlans(req.payload));
  q('planning.plans.get', 'planning', req => core.planningService.getPlan(req.payload.id));
  q('planning.plans.history', 'planning', req => core.planningService.getPlanHistory(req.payload.id));
  q('planning.proposals.get', 'planning', req => core.planningProposalService.getProposal(req.payload.id));
  q('planning.proposals.compare', 'planning', req => core.planningProposalService.compareProposals(req.payload.proposal_a_id, req.payload.proposal_b_id));
  q('planning.agenda.conflicts', 'planning', req => core.agendaService.getAgendaConflicts(req.payload.plan_id));
  q('planning.dailyReview.get', 'planning', req => core.dailyReviewService.getDailySummary(req.payload?.date ?? core.clock.todayDate()));
  m('planning.agenda.daily', 'planning', 'CREATE', req => core.agendaService.generateDailyAgenda(req.payload));
  m('planning.generateWeekly', 'planning', 'CREATE', req => core.agendaService.generateWeeklyAgenda(req.payload));
  m('planning.proposals.present', 'planning', 'UPDATE', req => core.planningProposalService.presentProposal(req.payload.id));
  m('planning.proposals.accept', 'planning', 'APPROVE', req => core.planningProposalService.acceptProposal(req.payload.id, req.payload));
  m('planning.proposals.reject', 'planning', 'UPDATE', req => core.planningProposalService.rejectProposal(req.payload.id, req.payload));
  m('planning.plans.supersede', 'planning', 'APPROVE', req => core.planningService.supersedePlanVersion(req.payload.plan_id, req.payload));
  m('planning.agenda.rescheduleItem', 'planning', 'UPDATE', req => core.agendaService.rescheduleAgendaItem(req.payload.item_id, req.payload));
  m('planning.dailyReview.generate', 'planning', 'CREATE', req => core.dailyReviewService.generateDailyReview(req.payload?.date ?? core.clock.todayDate()));
  m('planning.dailyReview.close', 'planning', 'APPROVE', req => core.dailyReviewService.closeDay(req.payload?.date ?? core.clock.todayDate(), req.payload));

  // === ADAPTATION & PROACTIVITY ===
  q('adaptation.observations.list', 'adaptation', req => core.adaptiveAnalysisService.listObservations(req.payload));
  q('adaptation.suggestions.list', 'adaptation', req => core.adaptiveAnalysisService.listSuggestions(req.payload));
  q('adaptation.analyzeHistory', 'adaptation', req => core.adaptiveAnalysisService.analyzeExecutionHistory(req.payload));
  q('adaptation.interventions.list', 'adaptation', req => core.proactivityService.listInterventions(req.payload));
  m('adaptation.interventions.evaluate', 'adaptation', 'EXECUTE', req => core.proactivityService.evaluateInterventionConditions(req.payload));
  m('adaptation.identifyPatterns', 'adaptation', 'CREATE', req => core.adaptiveAnalysisService.identifyPatterns(req.payload));
  m('adaptation.generateSuggestions', 'adaptation', 'CREATE', () => core.adaptiveAnalysisService.generateAdaptationSuggestions());
  m('adaptation.respondSuggestion', 'adaptation', 'APPROVE', req => core.adaptiveAnalysisService.respondToSuggestion(req.payload.id, req.payload));
  m('adaptation.applySuggestion', 'adaptation', 'EXECUTE', req => {
    if (typeof core.adaptiveAnalysisService.applySuggestion !== 'function') {
      throw new NexusError(ERROR_CODES.SERVICE_UNAVAILABLE, 'applySuggestion aún no está disponible.');
    }
    const authorizedBy = req.authorization?.authorized_by ?? req.payload?.authorized_by ?? req.payload?.authorizedBy;
    return core.adaptiveAnalysisService.applySuggestion(req.payload.id, { authorizedBy });
  }, { sensitiveOperation: true });
  m('adaptation.interventions.dismiss', 'adaptation', 'UPDATE', req => core.proactivityService.dismissIntervention(req.payload.id));

  // === AI PREPARED & CIO ===
  q('ai.status', 'ai_prepared', () => core.aiInteractionService.getAvailabilityStatus(), { sensitivity: 'INTERNAL' });
  q('ai.providers.list', 'ai_prepared', () => core.aiProviderRegistry.listProviders(), { sensitivity: 'INTERNAL' });
  q('ai.tools.list', 'ai_prepared', () => core.aiToolService.listAvailableTools(), { sensitivity: 'INTERNAL' });
  m('ai.providers.register', 'ai_prepared', 'CREATE', req => core.aiProviderRegistry.registerProvider(req.payload), { sensitivity: 'SENSITIVE' });
  m('ai.conversations.create', 'ai_prepared', 'CREATE', req => core.aiConversationService.createConversation(req.payload));
  m('ai.proposals.create', 'ai_prepared', 'CREATE', req => core.aiOperationService.createOperationProposal(req.payload));
  m('ai.proposals.validate', 'ai_prepared', 'UPDATE', req => core.aiOperationService.validateOperation(req.payload.id));
  m('ai.proposals.authorize', 'ai_prepared', 'APPROVE', req => core.aiOperationService.requestAuthorization(req.payload.id, req.payload), { sensitivity: 'SENSITIVE' });
  m('ai.proposals.execute', 'ai_prepared', 'EXECUTE', req => core.aiOperationService.executeOperation(req.payload.id), { sensitiveOperation: true, sensitivity: 'SENSITIVE' });
  q('cio.contract', 'ai_prepared', () => core.cioBridge.getContractInfo(), { sensitivity: 'PUBLIC' });
  m('cio.receiveSignal', 'ai_prepared', 'CREATE', req => core.cioBridge.receiveExternalSignal(req.payload));

  // === SPECIALIZED SPACES, SATURDAY ORCHESTRATOR & COPILOT BRIDGE ===
  q('spaces.snapshot', 'personal', req => {
    const referenceDate = req.payload?.referenceDate ?? core.clock.todayDate();
    const snap = core.specializedSpacesService.getSnapshot();
    return {
      profile: snap.profile,
      biometricsUpdatedAt: snap.biometricsUpdatedAt,
      latestClinicalPanel: core.specializedSpacesService.getLatestClinicalPanel(),
      unpaidCommitments: core.specializedSpacesService.detectUnpaidCommitments(referenceDate),
      biometricFreshness: core.specializedSpacesService.checkBiometricFreshness(referenceDate),
      baselines: core.specializedSpacesService.listBaselines(),
    };
  });
  q('spaces.commitments.unpaid', 'finance', req =>
    core.specializedSpacesService.detectUnpaidCommitments(req.payload?.referenceDate ?? core.clock.todayDate()),
    { sensitivity: 'SENSITIVE' }
  );
  q('spaces.baselines.list', 'planning', () => core.specializedSpacesService.listBaselines());
  q('spaces.catalog', 'personal', () => ({
    clinicalRanges: CLINICAL_RANGES,
    standardExercises: STANDARD_EXERCISES,
  }), { sensitivity: 'PUBLIC', description: 'Catálogo canónico de rangos clínicos y ejercicios estándar.' });
  q('spaces.baselines.get', 'planning', req => {
    const id = req.payload?.id ?? req.payload?.baselineId;
    const ctx = core.specializedSpacesService.getExecutionContext(id);
    if (!ctx) {
      throw new NexusError(ERROR_CODES.NOT_FOUND, `Baseline semanal no encontrada: ${id}`, {
        entity: 'WeeklyBaseline',
      });
    }
    return {
      baseline: ctx.baseline,
      executionLog: ctx.executionLog,
      revisionsLog: ctx.revisionsLog,
      analysis: closeWeekAndAnalyze(ctx.baseline, ctx.executionLog, ctx.revisionsLog),
    };
  });

  m('spaces.profile.save', 'personal', 'CREATE', req =>
    core.specializedSpacesService.saveProfile(req.payload?.profile ?? req.payload, {
      recordedAt: req.payload?.recordedAt ?? core.clock.nowIso(),
    })
  );
  m('spaces.biometrics.update', 'personal', 'UPDATE', req =>
    core.specializedSpacesService.updateBiometricsSpace(req.payload?.biometrics ?? req.payload, {
      recordedAt: req.payload?.recordedAt ?? core.clock.nowIso(),
    })
  );
  m('spaces.clinical.record', 'personal', 'CREATE', req =>
    core.specializedSpacesService.recordClinicalLabPanel(req.payload?.panel ?? req.payload, {
      recordedAt: req.payload?.recordedAt ?? core.clock.nowIso(),
    }),
    { sensitivity: 'SENSITIVE' }
  );
  m('spaces.employments.update', 'personal', 'UPDATE', req =>
    core.specializedSpacesService.updateEmploymentsSpace(req.payload?.employments, {
      recordedAt: req.payload?.recordedAt ?? core.clock.nowIso(),
    }),
    { sensitivity: 'SENSITIVE' }
  );
  m('spaces.commitments.update', 'finance', 'UPDATE', req =>
    core.specializedSpacesService.updateRecurringCommitmentsSpace(
      req.payload?.recurringCommitments ?? req.payload?.commitments,
      { recordedAt: req.payload?.recordedAt ?? core.clock.nowIso() }
    ),
    { sensitivity: 'SENSITIVE' }
  );
  m('spaces.commitments.pay', 'finance', 'CREATE', req => {
    const paidAt = req.payload?.paidAt ?? core.clock.nowIso();
    const payment = core.specializedSpacesService.recordCommitmentPayment({
      ...req.payload,
      paidAt,
    });
    if (req.payload?.account_id) {
      const financeTransaction = core.financialTransactionService.recordExpense({
        account_id: req.payload.account_id,
        amount: req.payload.amount,
        category: req.payload.category ?? 'recurring_commitment',
        description: `Pago compromiso: ${req.payload.commitmentName}`,
        occurred_at: paidAt,
      });
      return { ...payment, financeTransaction };
    }
    return payment;
  }, { sensitivity: 'SENSITIVE' });
  m('saturday.review.prepare', 'planning', 'EXECUTE', req => {
    const p = req.payload ?? {};
    const assembled = core.weeklyContextAssembler.assembleWeeklyInputs({
      weekStartDate: p.nextWeekStartDate ?? p.weekStartDate ?? core.clock.todayDate(),
      activeGoals: p.activeGoals ?? null,
      fixedCommitments: p.fixedCommitments ?? null,
      libraries: p.libraries ?? null,
      currentInventory: p.currentInventory ?? null,
    });
    const review = prepareSaturdayReview({
      spacesService: core.specializedSpacesService,
      previousBaselineId: p.previousBaselineId ?? null,
      nextWeekStartDate: p.nextWeekStartDate ?? assembled.weekStartDate,
      referenceDate: p.referenceDate ?? core.clock.todayDate(),
      activeGoals: assembled.activeGoals,
      fixedCommitments: assembled.fixedCommitments,
      libraries: assembled.libraries,
      currentInventory: assembled.currentInventory,
      weeklyGroceryBudget: p.weeklyGroceryBudget !== undefined ? Number(p.weeklyGroceryBudget) : 0,
      exerciseScheduleRequests: p.exerciseScheduleRequests ?? [],
      preferences: p.preferences ?? {},
    });
    return {
      ...review,
      briefingMarkdown: formatDeterministicSaturdayBriefing(review),
    };
  }, { atomic: false });
  m('saturday.baseline.approve', 'planning', 'APPROVE', req => {
    if (req.source?.actor_type === 'AI_ASSISTANT') {
      throw new NexusError(
        ERROR_CODES.PERMISSION_DENIED,
        'HUMAN_APPROVAL_REQUIRED: La IA no puede aprobar ni sellar la baseline semanal.',
        { statusCode: 403 }
      );
    }
    return approveSaturdayDraft({
      spacesService: core.specializedSpacesService,
      draft: req.payload?.draft,
      baselineId: req.payload?.baselineId ?? null,
      approvedAt: req.payload?.approvedAt ?? core.clock.nowIso(),
      approvedBy: req.payload?.approvedBy ?? 'user',
    });
  });
  m('week.execution.record', 'planning', 'CREATE', req =>
    core.specializedSpacesService.appendExecutionRecord(req.payload?.baselineId ?? req.payload?.id, {
      ...req.payload,
      recordedAt: req.payload?.recordedAt ?? core.clock.nowIso(),
    })
  );
  m('week.revision.record', 'planning', 'CREATE', req =>
    core.specializedSpacesService.appendPlanRevision(req.payload?.baselineId ?? req.payload?.id, {
      ...req.payload,
      authorizedBy: req.payload?.authorizedBy ?? 'user',
      recordedAt: req.payload?.recordedAt ?? core.clock.nowIso(),
    })
  );
  m('copilot.proposals.draft', 'ai_prepared', 'EXECUTE', async req =>
    core.copilotBridge.draftProposalsFromText({
      text: req.payload?.text ?? '',
      context: req.payload?.context ?? {},
    }),
    { async: true, atomic: false }
  );

  return {
    registerOperation: register,

    getOperationSpec(operationType) {
      return specs.get(operationType) ?? null;
    },

    listOperations({ module_id = null, kind = null } = {}) {
      const list = [...specs.values()];
      return list
        .filter(s => (!module_id || s.module_id === module_id) && (!kind || s.kind === kind))
        .map(({ handler: _h, ...meta }) => ({ ...meta }));
    },

    dispatch(rawRequest = {}) {
      const req = createOperationRequest(rawRequest, core.clock);
      const spec = specs.get(req.operation_type);
      if (!spec) {
        return errorResponse(
          req.operation_id,
          new NexusError(ERROR_CODES.NOT_FOUND, `Operación no registrada en el catálogo: ${req.operation_type}`, {
            field: 'operation_type',
            remediation: 'Consulta operations.listOperations() para conocer los tipos de operación válidos.',
          }),
          { metadata: { operation_type: req.operation_type ?? 'UNKNOWN', correlation_id: req.correlation_id } }
        );
      }
      if (spec.async) {
        return errorResponse(
          req.operation_id,
          new NexusError(
            ERROR_CODES.VALIDATION_ERROR,
            `La operación '${spec.operation_type}' es asíncrona y debe invocarse mediante executeOperationAsync / dispatchAsync.`,
            { remediation: 'Utiliza core.executeOperationAsync(request).' }
          ),
          { metadata: { operation_type: spec.operation_type, correlation_id: req.correlation_id } }
        );
      }
      return core.dispatcher.execute(req, spec.handler, spec);
    },

    async dispatchAsync(rawRequest = {}) {
      const req = createOperationRequest(rawRequest, core.clock);
      const spec = specs.get(req.operation_type);
      if (!spec) {
        return errorResponse(
          req.operation_id,
          new NexusError(ERROR_CODES.NOT_FOUND, `Operación no registrada en el catálogo: ${req.operation_type}`, {
            field: 'operation_type',
            remediation: 'Consulta operations.listOperations() para conocer los tipos de operación válidos.',
          }),
          { metadata: { operation_type: req.operation_type ?? 'UNKNOWN', correlation_id: req.correlation_id } }
        );
      }
      try {
        return await core.dispatcher.executeAsync(req, spec.handler, spec);
      } catch (err) {
        return errorResponse(req.operation_id, normalizeError(err), {
          metadata: { operation_type: spec.operation_type, correlation_id: req.correlation_id },
        });
      }
    },
  };
}
