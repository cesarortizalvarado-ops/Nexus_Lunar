import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSpecializedSpacesRepository } from '../src/infrastructure/repositories/specialized-spaces-repository.js';
import { createSpecializedSpacesService } from '../src/application/planning/specialized-spaces-service.js';
import {
  prepareSaturdayReview,
  approveSaturdayDraft,
} from '../src/application/planning/saturday-review-orchestrator.js';
import {
  createCopilotProposalBridge,
  formatDeterministicSaturdayBriefing,
} from '../src/integration/ai/copilot-proposal-bridge.js';

const baseProfile = {
  biometrics: { birthDate: '1985-06-05', heightCm: 158, currentWeightKg: 80, sex: 'male' },
  employments: [
    {
      type: 'fixed',
      title: 'Trabajo Base',
      workingHoursWindows: [
        { dayOfWeek: 1, startHour: 8, endHour: 15 },
        { dayOfWeek: 1, startHour: 16, endHour: 18 },
      ],
      income: { amount: 6000, frequency: 'biweekly' },
    },
  ],
  recurringCommitments: [
    { name: 'Netflix', amount: 220, frequency: 'monthly', dueDayOfMonth: 15 },
    { name: 'Internet', amount: 500, frequency: 'monthly', dueDayOfMonth: 28 },
  ],
  preferences: { dislikedIngredients: [] },
};

const sampleRecipes = [
  {
    id: 'r-b',
    name: 'Omelette proteico',
    category: 'breakfast',
    prepTimeMinutes: 10,
    servings: 1,
    caloriesPerServing: 450,
    macros: { proteinGrams: 32, carbsGrams: 10, fatGrams: 18 },
    ingredients: [{ itemId: 'egg', itemName: 'Huevo', requiredQuantity: 3, unit: 'unit' }],
  },
  {
    id: 'r-l',
    name: 'Pollo con verduras',
    category: 'lunch',
    prepTimeMinutes: 25,
    servings: 1,
    caloriesPerServing: 650,
    macros: { proteinGrams: 50, carbsGrams: 22, fatGrams: 16 },
    ingredients: [{ itemId: 'chicken', itemName: 'Pollo', requiredQuantity: 250, unit: 'g' }],
  },
  {
    id: 'r-d',
    name: 'Atún con ensalada',
    category: 'dinner',
    prepTimeMinutes: 10,
    servings: 1,
    caloriesPerServing: 500,
    macros: { proteinGrams: 35, carbsGrams: 14, fatGrams: 20 },
    ingredients: [{ itemId: 'tuna', itemName: 'Atún', requiredQuantity: 140, unit: 'g' }],
  },
];

test('SPACES PERSISTENCE: Guarda y recarga Espacios Especializados en disco con detección proactiva de pagos omitidos', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-lunar-spaces-'));
  const filePath = path.join(tempDir, 'spaces.json');

  try {
    const repo1 = createSpecializedSpacesRepository({ filePath });
    const service1 = createSpecializedSpacesService({ repository: repo1 });

    service1.saveProfile(baseProfile, { recordedAt: '2026-11-01T10:00:00.000Z' });
    service1.updateBiometricsSpace({ currentWeightKg: 79.2 }, { recordedAt: '2026-11-02T09:00:00.000Z' });
    const lab = service1.recordClinicalLabPanel({ triglycerides: 175 }, { recordedAt: '2026-11-10T08:00:00.000Z' });
    assert.equal(lab.evaluation.hasAlerts, true);

    // Simular reinicio: nueva instancia leyendo del disco
    const repo2 = createSpecializedSpacesRepository({ filePath });
    const service2 = createSpecializedSpacesService({ repository: repo2 });

    const loaded = service2.getSnapshot();
    assert.equal(loaded.profile.biometrics.currentWeightKg, 79.2);
    assert.equal(service2.getLatestClinicalPanel().triglycerides, 175);

    // Día 21: Netflix (vence día 15) debe alertar; Internet (vence día 28) aún no
    const missingBefore = service2.detectUnpaidCommitments('2026-11-21');
    assert.equal(missingBefore.length, 1);
    assert.equal(missingBefore[0].commitmentName, 'Netflix');

    // Al registrar el pago, la alerta desaparece
    service2.recordCommitmentPayment({
      commitmentName: 'Netflix',
      amount: 220,
      paidAt: '2026-11-21T18:00:00.000Z',
    });
    const missingAfter = service2.detectUnpaidCommitments('2026-11-21');
    assert.equal(missingAfter.length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('SATURDAY ORCHESTRATOR: Cierra semana 1, detecta fricción/pagos/biometría vieja y sella semana 2 solo con aprobación humana', () => {
  const repo = createSpecializedSpacesRepository();
  const spacesService = createSpecializedSpacesService({ repository: repo });
  spacesService.saveProfile(baseProfile, { recordedAt: '2026-11-01T10:00:00.000Z' });

  // Semana 1: generar y aprobar
  const reviewW1 = prepareSaturdayReview({
    spacesService,
    nextWeekStartDate: '2026-11-15',
    referenceDate: '2026-11-14',
    libraries: { recipes: sampleRecipes },
    weeklyGroceryBudget: 1000,
    exerciseScheduleRequests: [
      { exerciseId: 'ex-walk-brisk', daysOfWeek: [1], durationMinutes: 30, preferredStartHour: 6.5 },
    ],
  });

  // La IA no puede aprobar la baseline
  assert.throws(() => {
    approveSaturdayDraft({ spacesService, draft: reviewW1.nextWeekDraft, approvedBy: 'ai_agent' });
  }, /HUMAN_APPROVAL_REQUIRED/);

  const baselineW1 = approveSaturdayDraft({
    spacesService,
    draft: reviewW1.nextWeekDraft,
    baselineId: 'wk-2026-46',
    approvedAt: '2026-11-14T21:00:00.000Z',
    approvedBy: 'user',
  });

  const walkBlock = baselineW1.plan.dailySchedules[1].blocks.find((b) => b.category === 'exercise');
  spacesService.appendExecutionRecord(baselineW1.baselineId, {
    blockId: walkBlock.id,
    status: 'missed_with_reason',
    reason: 'Tráfico imprevisto',
  });

  // Semana 2 (sábado 21 nov: biometría tiene 20 días de antigüedad y Netflix está pendiente)
  const reviewW2 = prepareSaturdayReview({
    spacesService,
    previousBaselineId: baselineW1.baselineId,
    nextWeekStartDate: '2026-11-22',
    referenceDate: '2026-11-21',
    libraries: { recipes: sampleRecipes },
    weeklyGroceryBudget: 1000,
  });

  assert.equal(reviewW2.status, 'awaiting_human_approval');
  assert.equal(reviewW2.previousWeekSummary.documentedFrictionReasons[0].reason, 'Tráfico imprevisto');
  assert.equal(reviewW2.proactiveChecks.unpaidCommitments.length, 1);
  assert.equal(reviewW2.proactiveChecks.biometricFreshness.isStale, true);
  assert.ok(reviewW2.pendingQuestions.length >= 2);

  const briefingText = formatDeterministicSaturdayBriefing(reviewW2);
  assert.match(briefingText, /Tráfico imprevisto/);
  assert.match(briefingText, /Netflix/);
});

test('COPILOT BRIDGE: Valida propuestas de IA, bloquea acciones sensibles y degrada sin LLM', async () => {
  // 1. Con transporte IA simulado devolviendo mezcla de propuesta válida y acción prohibida
  const mockTransport = async () => ({
    proposals: [
      { type: 'update_weight', payload: { currentWeightKg: 78.5 }, confidence: 0.92, rationale: 'Usuario reportó peso.' },
      { type: 'execute_bank_transfer', payload: { amount: 5000 }, confidence: 0.99 },
      { type: 'mutate_baseline', payload: { baselineId: 'wk-1' } },
    ],
  });

  const aiBridge = createCopilotProposalBridge({ transport: mockTransport });
  const aiResult = await aiBridge.draftProposalsFromText({ text: 'Hoy peso 78.5 kg y paga todo' });

  assert.equal(aiResult.mode, 'ai_validated');
  assert.equal(aiResult.acceptedProposals.length, 1);
  assert.equal(aiResult.acceptedProposals[0].requiresHumanConfirmation, true);
  assert.equal(aiResult.acceptedProposals[0].canAutoExecute, false);
  assert.equal(aiResult.rejectedProposals.length, 2);
  assert.match(aiResult.rejectedProposals[0].reason, /UNAUTHORIZED_SENSITIVE_ACTION/);

  // 2. Sin transporte IA (o fallo de red): degradación determinista local
  const offlineBridge = createCopilotProposalBridge({
    transport: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const fallbackResult = await offlineBridge.draftProposalsFromText({
    text: 'Hoy estoy en 78.4 kg y pagué Netflix 220',
  });

  assert.equal(fallbackResult.mode, 'deterministic_fallback');
  assert.equal(fallbackResult.aiAvailable, false);
  assert.equal(fallbackResult.acceptedProposals.length, 2);
  assert.equal(fallbackResult.acceptedProposals[0].type, 'update_weight');
  assert.equal(fallbackResult.acceptedProposals[1].type, 'record_payment');
});
