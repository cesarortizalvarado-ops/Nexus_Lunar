import { sealWeeklyBaseline } from '../../domain/planning/weekly-baseline-contract.js';
import { generateWeeklyPlanDraft } from './multidomain-weekly-optimizer.js';
import { closeWeekAndAnalyze } from './weekly-execution-tracker.js';

export function prepareSaturdayReview({
  spacesService,
  previousBaselineId = null,
  nextWeekStartDate,
  referenceDate,
  activeGoals = [],
  fixedCommitments = [],
  libraries = {},
  currentInventory = [],
  weeklyGroceryBudget = 0,
  exerciseScheduleRequests = [],
  preferences = {},
}) {
  if (!spacesService) {
    throw new Error('SPACES_SERVICE_REQUIRED: Se requiere specializedSpacesService.');
  }
  const snapshot = spacesService.getSnapshot();
  if (!snapshot.profile) {
    throw new Error('PROFILE_NOT_INITIALIZED: Configura el perfil en los Espacios Especializados antes de planificar.');
  }

  const effectiveReferenceDate = referenceDate || nextWeekStartDate;

  // 1. Cierre analítico de la semana saliente (si existe baseline previa)
  let previousWeekSummary = null;
  if (previousBaselineId) {
    const ctx = spacesService.getExecutionContext(previousBaselineId);
    if (!ctx) {
      throw new Error(`PREVIOUS_BASELINE_NOT_FOUND: No existe la baseline previa ${previousBaselineId}.`);
    }
    previousWeekSummary = closeWeekAndAnalyze(ctx.baseline, ctx.executionLog, ctx.revisionsLog);
  }

  // 2. Auditoría proactiva de Espacios Especializados
  const unpaidCommitments = spacesService.detectUnpaidCommitments(effectiveReferenceDate);
  const biometricFreshness = spacesService.checkBiometricFreshness(effectiveReferenceDate);
  const latestClinicalPanel = spacesService.getLatestClinicalPanel();

  // 3. Generación determinista del borrador para la semana entrante
  const nextWeekDraft = generateWeeklyPlanDraft({
    weekStartDate: nextWeekStartDate,
    userProfile: snapshot.profile,
    activeGoals,
    fixedCommitments,
    clinicalPanel: latestClinicalPanel,
    libraries,
    currentInventory,
    weeklyGroceryBudget,
    exerciseScheduleRequests,
    preferences,
  });

  // 4. Lista determinista de preguntas pendientes (solo lo estrictamente necesario)
  const pendingQuestions = [];
  for (const unpaid of unpaidCommitments) {
    pendingQuestions.push({
      category: 'finance_commitment',
      severity: 'HIGH',
      question: unpaid.prompt,
      metadata: unpaid,
    });
  }
  if (biometricFreshness.isStale) {
    pendingQuestions.push({
      category: 'biometrics',
      severity: 'MEDIUM',
      question: `${biometricFreshness.message} ¿Deseas actualizar tu peso antes de aprobar la semana?`,
      metadata: biometricFreshness,
    });
  }
  if (!nextWeekDraft.feasibilityReport.feasible) {
    for (const conflict of nextWeekDraft.feasibilityReport.conflicts) {
      const summary =
        conflict.message ||
        conflict.suggestions?.[0] ||
        `Conflicto de recurso: ${conflict.resource}.`;
      const suggestion =
        conflict.resolutionSuggestion ||
        conflict.suggestions?.[1] ||
        '';
      pendingQuestions.push({
        category: 'goal_conflict',
        severity: conflict.severity || 'HIGH',
        question: suggestion ? `${summary} Sugerencia: ${suggestion}` : summary,
        metadata: conflict,
      });
    }
  }
  if (nextWeekDraft.sundayPrep?.pantryReport?.budgetAlert) {
    pendingQuestions.push({
      category: 'pantry_budget',
      severity: 'HIGH',
      question: nextWeekDraft.sundayPrep.pantryReport.budgetAlert.message,
      metadata: nextWeekDraft.sundayPrep.pantryReport.budgetAlert,
    });
  }

  return {
    status: 'awaiting_human_approval',
    generatedAt: effectiveReferenceDate,
    previousWeekSummary,
    proactiveChecks: {
      unpaidCommitments,
      biometricFreshness,
      hasClinicalAlerts: nextWeekDraft.clinicalReport.hasAlerts,
    },
    pendingQuestions,
    nextWeekDraft,
  };
}

export function approveSaturdayDraft({
  spacesService,
  draft,
  baselineId = null,
  approvedAt = null,
  approvedBy = 'user',
}) {
  if (!spacesService) {
    throw new Error('SPACES_SERVICE_REQUIRED: Se requiere specializedSpacesService.');
  }
  if (approvedBy !== 'user') {
    throw new Error('HUMAN_APPROVAL_REQUIRED: Solo el usuario humano puede aprobar y sellar la baseline semanal.');
  }

  const sealed = sealWeeklyBaseline(draft, {
    baselineId: baselineId || undefined,
    approvedAt: approvedAt || new Date().toISOString(),
    approvedBy,
  });

  return spacesService.saveBaseline(sealed);
}
