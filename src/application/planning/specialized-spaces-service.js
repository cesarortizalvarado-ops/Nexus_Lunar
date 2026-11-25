import {
  validatePersonalProfile,
  validateBiometrics,
  validateEmployments,
  validateRecurringCommitments,
} from '../../domain/personal/personal-profile-contract.js';
import { evaluateClinicalPanel } from '../../domain/personal/clinical-reference-library.js';
import {
  deepFreeze,
  verifyBaselineIntegrity,
} from '../../domain/planning/weekly-baseline-contract.js';
import {
  recordBlockExecution,
  recordPlanRevision,
} from './weekly-execution-tracker.js';

function parseIsoDateParts(isoDateStr) {
  if (typeof isoDateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(isoDateStr)) {
    throw new Error(`INVALID_ISO_DATE: Fecha ISO inválida (${isoDateStr}).`);
  }
  const [year, month, day] = isoDateStr.slice(0, 10).split('-').map(Number);
  return { year, month, day, periodKey: `${year}-${String(month).padStart(2, '0')}` };
}

function computeIsoWeekKey(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

function computePeriodKey(isoDateStr, frequency = 'monthly') {
  const { year, month, day } = parseIsoDateParts(isoDateStr);
  const freq = String(frequency || 'monthly').toLowerCase();
  const mm = String(month).padStart(2, '0');
  if (freq === 'annual') return String(year);
  if (freq === 'biweekly') return `${year}-${mm}-${day <= 15 ? 'Q1' : 'Q2'}`;
  if (freq === 'weekly') return computeIsoWeekKey(year, month, day);
  return `${year}-${mm}`;
}

function isCommitmentDueNow(commitment, refParts) {
  const freq = String(commitment.frequency || 'monthly').toLowerCase();
  const dueDay = Number.isInteger(commitment.dueDayOfMonth) ? commitment.dueDayOfMonth : null;
  const dueMonth = Number.isInteger(commitment.dueMonth) ? commitment.dueMonth : null;

  if (freq === 'weekly') return true;

  if (freq === 'annual') {
    if (dueMonth !== null) {
      return refParts.month > dueMonth || (refParts.month === dueMonth && refParts.day >= (dueDay ?? 1));
    }
    return dueDay === null || refParts.day >= dueDay;
  }

  if (freq === 'biweekly') {
    if (dueDay === null) return true;
    if (refParts.day <= 15) {
      return dueDay > 15 ? false : refParts.day >= dueDay;
    }
    return dueDay <= 15 ? true : refParts.day >= dueDay;
  }

  return dueDay === null || refParts.day >= dueDay;
}

function daysBetweenIsoDates(olderIso, newerIso) {
  const a = parseIsoDateParts(olderIso);
  const b = parseIsoDateParts(newerIso);
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.floor((msB - msA) / (1000 * 60 * 60 * 24));
}

export function createSpecializedSpacesService({ repository }) {
  if (!repository || typeof repository.loadState !== 'function' || typeof repository.saveState !== 'function') {
    throw new Error('INVALID_REPOSITORY: Se requiere un repositorio con loadState y saveState.');
  }

  function getSnapshot() {
    return repository.loadState();
  }

  function saveProfile(profile, { recordedAt } = {}) {
    validatePersonalProfile(profile);
    const state = repository.loadState();
    const nowIso = recordedAt || new Date().toISOString();

    state.profile = structuredClone(profile);
    if (!Array.isArray(state.profile.clinicalHistory)) {
      state.profile.clinicalHistory = [];
    }
    state.biometricsUpdatedAt = nowIso;
    state.updatedAt = nowIso;

    repository.saveState(state);
    return structuredClone(state.profile);
  }

  function updateBiometricsSpace(biometricsPatch, { recordedAt } = {}) {
    const state = repository.loadState();
    if (!state.profile) {
      throw new Error('PROFILE_NOT_INITIALIZED: Inicializa el perfil personal antes de actualizar biometría.');
    }

    const updatedBiometrics = {
      ...state.profile.biometrics,
      ...biometricsPatch,
    };
    validateBiometrics(updatedBiometrics);

    const nowIso = recordedAt || new Date().toISOString();
    state.profile.biometrics = updatedBiometrics;
    state.biometricsUpdatedAt = nowIso;
    state.updatedAt = nowIso;

    repository.saveState(state);
    return structuredClone(updatedBiometrics);
  }

  function recordClinicalLabPanel(panel, { recordedAt } = {}) {
    const state = repository.loadState();
    if (!state.profile) {
      throw new Error('PROFILE_NOT_INITIALIZED: Inicializa el perfil personal antes de registrar análisis clínicos.');
    }

    const nowIso = recordedAt || panel.recordedAt || new Date().toISOString();
    const panelWithDate = { ...panel, recordedAt: nowIso };
    const evaluation = evaluateClinicalPanel(panelWithDate);

    if (!Array.isArray(state.profile.clinicalHistory)) {
      state.profile.clinicalHistory = [];
    }
    state.profile.clinicalHistory.push(panelWithDate);
    state.updatedAt = nowIso;

    repository.saveState(state);
    return {
      panel: panelWithDate,
      evaluation,
    };
  }

  function getLatestClinicalPanel() {
    const state = repository.loadState();
    const history = state.profile?.clinicalHistory;
    if (!Array.isArray(history) || history.length === 0) return null;
    return structuredClone(history[history.length - 1]);
  }

  function updateEmploymentsSpace(employments, { recordedAt } = {}) {
    const state = repository.loadState();
    if (!state.profile) {
      throw new Error('PROFILE_NOT_INITIALIZED: Inicializa el perfil personal antes de actualizar empleos.');
    }

    validateEmployments(employments);
    const nowIso = recordedAt || new Date().toISOString();
    state.profile.employments = structuredClone(employments);
    delete state.profile.employment;
    state.updatedAt = nowIso;

    repository.saveState(state);
    return structuredClone(state.profile.employments);
  }

  function updateRecurringCommitmentsSpace(commitments, { recordedAt } = {}) {
    const state = repository.loadState();
    if (!state.profile) {
      throw new Error('PROFILE_NOT_INITIALIZED: Inicializa el perfil personal antes de actualizar compromisos.');
    }

    validateRecurringCommitments(commitments);
    const nowIso = recordedAt || new Date().toISOString();
    state.profile.recurringCommitments = structuredClone(commitments);
    state.updatedAt = nowIso;

    repository.saveState(state);
    return structuredClone(state.profile.recurringCommitments);
  }

  function recordCommitmentPayment({ commitmentName, amount, paidAt, periodKey = null, notes = null }) {
    if (!commitmentName || typeof commitmentName !== 'string') {
      throw new Error('INVALID_COMMITMENT_PAYMENT: commitmentName requerido.');
    }
    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('INVALID_COMMITMENT_PAYMENT: amount debe ser mayor a 0.');
    }

    const nowIso = paidAt || new Date().toISOString();
    const state = repository.loadState();
    const matchedCommitment = (state.profile?.recurringCommitments || []).find(
      (c) => c.name.trim().toLowerCase() === commitmentName.trim().toLowerCase()
    );
    const resolvedPeriod =
      periodKey || computePeriodKey(nowIso, matchedCommitment?.frequency || 'monthly');

    const payment = {
      id: `pay-${resolvedPeriod}-${commitmentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${state.commitmentPayments.length + 1}`,
      commitmentName,
      amount,
      periodKey: resolvedPeriod,
      paidAt: nowIso,
      notes,
    };

    state.commitmentPayments.push(payment);
    state.updatedAt = nowIso;
    repository.saveState(state);
    return payment;
  }

  function detectUnpaidCommitments(referenceDate) {
    const state = repository.loadState();
    const commitments = state.profile?.recurringCommitments || [];
    const refParts = parseIsoDateParts(referenceDate);
    const missing = [];

    for (const commitment of commitments) {
      const dueDay = Number.isInteger(commitment.dueDayOfMonth) ? commitment.dueDayOfMonth : null;
      if (!isCommitmentDueNow(commitment, refParts)) continue;

      const expectedPeriodKey = computePeriodKey(referenceDate, commitment.frequency || 'monthly');
      const hasPayment = state.commitmentPayments.some(
        (p) =>
          p.commitmentName.trim().toLowerCase() === commitment.name.trim().toLowerCase() &&
          p.periodKey === expectedPeriodKey
      );

      if (!hasPayment) {
        missing.push({
          commitmentName: commitment.name,
          expectedAmount: commitment.amount,
          frequency: commitment.frequency,
          dueDayOfMonth: dueDay,
          periodKey: expectedPeriodKey,
          prompt: `No se ha registrado el pago de "${commitment.name}" ($${commitment.amount}) para el periodo ${expectedPeriodKey}. ¿Se pagó, se canceló o se pospuso?`,
        });
      }
    }

    return missing;
  }

  function checkBiometricFreshness(referenceDate, maxStaleDays = 14) {
    const state = repository.loadState();
    if (!state.biometricsUpdatedAt) {
      return {
        isStale: true,
        daysSinceUpdate: null,
        message: 'No hay fecha de actualización biométrica registrada.',
      };
    }
    const daysSinceUpdate = daysBetweenIsoDates(state.biometricsUpdatedAt, referenceDate);
    const isStale = daysSinceUpdate > maxStaleDays;
    return {
      isStale,
      daysSinceUpdate,
      lastUpdatedAt: state.biometricsUpdatedAt,
      message: isStale
        ? `Tu peso y datos biométricos llevan ${daysSinceUpdate} días sin actualizarse (límite recomendado: ${maxStaleDays} días).`
        : null,
    };
  }

  function saveBaseline(baseline) {
    const integrity = verifyBaselineIntegrity(baseline);
    if (!integrity.valid) {
      throw new Error(`INVALID_BASELINE_INTEGRITY: ${integrity.reason}`);
    }

    const state = repository.loadState();
    if (state.baselines[baseline.baselineId]) {
      throw new Error(`BASELINE_ALREADY_EXISTS: La baseline ${baseline.baselineId} es inmutable y no puede sobrescribirse.`);
    }

    state.baselines[baseline.baselineId] = structuredClone(baseline);
    state.executionLogs[baseline.baselineId] = state.executionLogs[baseline.baselineId] || [];
    state.revisionsLogs[baseline.baselineId] = state.revisionsLogs[baseline.baselineId] || [];
    state.updatedAt = baseline.approvedAt || new Date().toISOString();

    repository.saveState(state);
    return deepFreeze(structuredClone(baseline));
  }

  function getBaseline(baselineId) {
    const state = repository.loadState();
    const stored = state.baselines[baselineId];
    if (!stored) return null;

    const integrity = verifyBaselineIntegrity(stored);
    if (!integrity.valid) {
      throw new Error(`STORED_BASELINE_CORRUPTED: ${integrity.reason} (${baselineId})`);
    }
    return deepFreeze(structuredClone(stored));
  }

  function appendExecutionRecord(baselineId, record) {
    const baseline = getBaseline(baselineId);
    if (!baseline) {
      throw new Error(`BASELINE_NOT_FOUND: No existe la baseline ${baselineId}.`);
    }
    const state = repository.loadState();
    const updatedLog = recordBlockExecution(baseline, state.executionLogs[baselineId] || [], record);
    state.executionLogs[baselineId] = updatedLog;
    state.updatedAt = record.recordedAt || new Date().toISOString();
    repository.saveState(state);
    return updatedLog;
  }

  function appendPlanRevision(baselineId, revision) {
    const baseline = getBaseline(baselineId);
    if (!baseline) {
      throw new Error(`BASELINE_NOT_FOUND: No existe la baseline ${baselineId}.`);
    }
    const state = repository.loadState();
    const updatedRevisions = recordPlanRevision(baseline, state.revisionsLogs[baselineId] || [], revision);
    state.revisionsLogs[baselineId] = updatedRevisions;
    state.updatedAt = revision.recordedAt || new Date().toISOString();
    repository.saveState(state);
    return updatedRevisions;
  }

  function getExecutionContext(baselineId) {
    const baseline = getBaseline(baselineId);
    if (!baseline) return null;
    const state = repository.loadState();
    return {
      baseline,
      executionLog: structuredClone(state.executionLogs[baselineId] || []),
      revisionsLog: structuredClone(state.revisionsLogs[baselineId] || []),
    };
  }

  function listBaselines() {
    const state = repository.loadState();
    return Object.values(state.baselines || {})
      .map((b) => ({
        baselineId: b.baselineId,
        weekStartDate: b.plan?.weekStartDate ?? null,
        status: b.status,
        approvedAt: b.approvedAt,
        approvedBy: b.approvedBy,
        integrityHash: b.integrityHash,
        executionsCount: (state.executionLogs?.[b.baselineId] || []).length,
        revisionsCount: (state.revisionsLogs?.[b.baselineId] || []).length,
      }))
      .sort((a, b) => String(b.weekStartDate || '').localeCompare(String(a.weekStartDate || '')));
  }

  return {
    getSnapshot,
    saveProfile,
    updateBiometricsSpace,
    recordClinicalLabPanel,
    getLatestClinicalPanel,
    updateEmploymentsSpace,
    updateRecurringCommitmentsSpace,
    recordCommitmentPayment,
    detectUnpaidCommitments,
    checkBiometricFreshness,
    saveBaseline,
    getBaseline,
    listBaselines,
    appendExecutionRecord,
    appendPlanRevision,
    getExecutionContext,
  };
}
