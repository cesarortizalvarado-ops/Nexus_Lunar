import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { isValidDate, isValidIsoDateTime } from '../../shared/clock.js';
import { BIWEEKLY_FREQUENCY_FACTORS, FINANCIAL_FREQUENCIES } from './goal-resource-contract.js';
import { RECIPE_CATEGORIES } from '../knowledge/recipe-contract.js';
import { evaluateClinicalPanel } from './clinical-reference-library.js';

export const BIOMETRIC_SEXES = Object.freeze(['male', 'female']);
export const EMPLOYMENT_TYPES = Object.freeze(['fixed', 'freelance', 'contract']);
export const RECURRING_EXPENSE_FREQUENCIES = Object.freeze([
  'weekly',
  'biweekly',
  'monthly',
  'annual',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function normalizeIsoDateOnly(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `${field} debe ser una fecha ISO válida (YYYY-MM-DD).`,
      { field }
    );
  }
  const trimmed = value.trim();
  if (isValidDate(trimmed)) return trimmed;
  if (isValidIsoDateTime(trimmed)) {
    const datePart = trimmed.slice(0, 10);
    if (isValidDate(datePart)) return datePart;
  }
  throw new NexusError(
    ERROR_CODES.VALIDATION_ERROR,
    `${field} debe ser una fecha ISO válida (YYYY-MM-DD).`,
    { field }
  );
}

function resolveReferenceDate(referenceDateOrClock) {
  if (referenceDateOrClock === undefined || referenceDateOrClock === null) {
    return new Date().toISOString().slice(0, 10);
  }
  if (typeof referenceDateOrClock === 'string') {
    return normalizeIsoDateOnly(referenceDateOrClock, 'referenceDate');
  }
  if (referenceDateOrClock instanceof Date) {
    if (Number.isNaN(referenceDateOrClock.getTime())) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Fecha de referencia inválida.', {
        field: 'referenceDate',
      });
    }
    return referenceDateOrClock.toISOString().slice(0, 10);
  }
  if (typeof referenceDateOrClock === 'object') {
    if (typeof referenceDateOrClock.todayDate === 'function') {
      return normalizeIsoDateOnly(referenceDateOrClock.todayDate(), 'referenceDate');
    }
    if (typeof referenceDateOrClock.nowIso === 'function') {
      return normalizeIsoDateOnly(referenceDateOrClock.nowIso(), 'referenceDate');
    }
    if (typeof referenceDateOrClock.now === 'function') {
      const d = referenceDateOrClock.now();
      return d.toISOString().slice(0, 10);
    }
  }
  throw new NexusError(
    ERROR_CODES.VALIDATION_ERROR,
    'referenceDateOrClock debe ser una fecha ISO, instancia Date o reloj (clock).',
    { field: 'referenceDate' }
  );
}

export function validateBiometrics(biometrics) {
  if (!isPlainObject(biometrics)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'biometrics debe ser un objeto válido.', {
      field: 'biometrics',
    });
  }

  const birthDate = normalizeIsoDateOnly(biometrics.birthDate, 'biometrics.birthDate');

  const heightCm = Number(biometrics.heightCm);
  if (!Number.isFinite(heightCm) || heightCm <= 0 || heightCm > 300) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'biometrics.heightCm debe ser un número positivo válido (cm).',
      { field: 'biometrics.heightCm' }
    );
  }

  const currentWeightKg = Number(biometrics.currentWeightKg);
  if (!Number.isFinite(currentWeightKg) || currentWeightKg <= 0 || currentWeightKg > 500) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'biometrics.currentWeightKg debe ser un número positivo válido (kg).',
      { field: 'biometrics.currentWeightKg' }
    );
  }

  const sex = typeof biometrics.sex === 'string' ? biometrics.sex.trim().toLowerCase() : '';
  if (!BIOMETRIC_SEXES.includes(sex)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `biometrics.sex inválido: ${biometrics.sex}. Permitidos: ${BIOMETRIC_SEXES.join(', ')}.`,
      { field: 'biometrics.sex' }
    );
  }

  return {
    birthDate,
    heightCm: round2(heightCm),
    currentWeightKg: round2(currentWeightKg),
    sex,
  };
}

function validateWorkingHoursWindows(windows, fieldPrefix = 'employment') {
  if (windows === undefined || windows === null) return [];
  if (!Array.isArray(windows)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `${fieldPrefix}.workingHoursWindows debe ser un arreglo.`,
      { field: `${fieldPrefix}.workingHoursWindows` }
    );
  }

  return windows.map((win, idx) => {
    if (!isPlainObject(win)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.workingHoursWindows[${idx}] debe ser un objeto válido.`,
        { field: `${fieldPrefix}.workingHoursWindows[${idx}]` }
      );
    }
    const dayOfWeek = Number(win.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.workingHoursWindows[${idx}].dayOfWeek debe ser un entero entre 0 y 6.`,
        { field: `${fieldPrefix}.workingHoursWindows[${idx}].dayOfWeek` }
      );
    }
    const startHour = Number(win.startHour);
    const endHour = Number(win.endHour);
    if (!Number.isFinite(startHour) || startHour < 0 || startHour >= 24) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.workingHoursWindows[${idx}].startHour debe estar entre 0 y 24.`,
        { field: `${fieldPrefix}.workingHoursWindows[${idx}].startHour` }
      );
    }
    if (!Number.isFinite(endHour) || endHour <= 0 || endHour > 24 || endHour <= startHour) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.workingHoursWindows[${idx}].endHour debe ser mayor a startHour y menor o igual a 24.`,
        { field: `${fieldPrefix}.workingHoursWindows[${idx}].endHour` }
      );
    }
    return {
      dayOfWeek,
      startHour: round2(startHour),
      endHour: round2(endHour),
    };
  });
}

export function validateEmployment(employment, fieldPrefix = 'employment') {
  if (!isPlainObject(employment)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `${fieldPrefix} debe ser un objeto válido.`, {
      field: fieldPrefix,
    });
  }

  const type = typeof employment.type === 'string' ? employment.type.trim().toLowerCase() : '';
  if (!EMPLOYMENT_TYPES.includes(type)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `${fieldPrefix}.type inválido: ${employment.type}. Permitidos: ${EMPLOYMENT_TYPES.join(', ')}.`,
      { field: `${fieldPrefix}.type` }
    );
  }

  const title =
    typeof employment.title === 'string' && employment.title.trim()
      ? employment.title.trim()
      : null;

  let fixedExpensesBiweekly = 0;
  if (employment.fixedExpensesBiweekly !== undefined && employment.fixedExpensesBiweekly !== null) {
    const parsedExp = Number(employment.fixedExpensesBiweekly);
    if (!Number.isFinite(parsedExp) || parsedExp < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.fixedExpensesBiweekly debe ser un número finito mayor o igual a 0.`,
        { field: `${fieldPrefix}.fixedExpensesBiweekly` }
      );
    }
    fixedExpensesBiweekly = round2(parsedExp);
  }

  if (type === 'fixed') {
    const workingHoursWindows = validateWorkingHoursWindows(
      employment.workingHoursWindows,
      fieldPrefix
    );

    const rawIncome = employment.fixedIncome ?? employment.income;
    if (!isPlainObject(rawIncome)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.income (o fixedIncome) es obligatorio para empleo de tipo fixed.`,
        { field: `${fieldPrefix}.income` }
      );
    }
    const amount = Number(rawIncome.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.income.amount debe ser un número finito mayor o igual a 0.`,
        { field: `${fieldPrefix}.income.amount` }
      );
    }
    const frequency = rawIncome.frequency ?? 'biweekly';
    if (!FINANCIAL_FREQUENCIES.includes(frequency)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.income.frequency inválida: ${frequency}. Permitidas: ${FINANCIAL_FREQUENCIES.join(', ')}.`,
        { field: `${fieldPrefix}.income.frequency` }
      );
    }

    const normalizedIncome = {
      amount: round2(amount),
      frequency,
    };

    return {
      type: 'fixed',
      title,
      workingHoursWindows,
      income: normalizedIncome,
      fixedIncome: normalizedIncome,
      fixedExpensesBiweekly,
    };
  }

  const targetWeeklyHours = Number(employment.targetWeeklyHours ?? 0);
  if (!Number.isFinite(targetWeeklyHours) || targetWeeklyHours < 0 || targetWeeklyHours > 168) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `${fieldPrefix}.targetWeeklyHours debe ser un número entre 0 y 168.`,
      { field: `${fieldPrefix}.targetWeeklyHours` }
    );
  }

  if (
    employment.historicalIncomes !== undefined &&
    employment.historicalIncomes !== null &&
    !Array.isArray(employment.historicalIncomes)
  ) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `${fieldPrefix}.historicalIncomes debe ser un arreglo.`,
      { field: `${fieldPrefix}.historicalIncomes` }
    );
  }

  const historicalIncomes = (employment.historicalIncomes ?? []).map((entry, idx) => {
    if (!isPlainObject(entry)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.historicalIncomes[${idx}] debe ser un objeto válido.`,
        { field: `${fieldPrefix}.historicalIncomes[${idx}]` }
      );
    }
    const date =
      entry.date !== undefined && entry.date !== null
        ? normalizeIsoDateOnly(entry.date, `${fieldPrefix}.historicalIncomes[${idx}].date`)
        : null;
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `${fieldPrefix}.historicalIncomes[${idx}].amount debe ser un número finito mayor o igual a 0.`,
        { field: `${fieldPrefix}.historicalIncomes[${idx}].amount` }
      );
    }
    return { date, amount: round2(amount) };
  });

  return {
    type,
    title,
    targetWeeklyHours: round2(targetWeeklyHours),
    historicalIncomes,
    fixedExpensesBiweekly,
  };
}

export function validateEmployments(employments) {
  if (!Array.isArray(employments) || employments.length === 0) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'employments debe contener al menos una fuente de empleo o actividad.',
      { field: 'employments' }
    );
  }
  return employments.map((emp, idx) => validateEmployment(emp, `employments[${idx}]`));
}

export function validateRecurringCommitments(commitments) {
  if (commitments === undefined || commitments === null) return [];
  if (!Array.isArray(commitments)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'recurringCommitments debe ser un arreglo.',
      { field: 'recurringCommitments' }
    );
  }

  return commitments.map((c, idx) => {
    if (!isPlainObject(c)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `recurringCommitments[${idx}] debe ser un objeto válido.`,
        { field: `recurringCommitments[${idx}]` }
      );
    }
    if (typeof c.name !== 'string' || !c.name.trim()) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `recurringCommitments[${idx}].name es obligatorio.`,
        { field: `recurringCommitments[${idx}].name` }
      );
    }
    const amount = Number(c.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `recurringCommitments[${idx}].amount debe ser un número mayor a 0.`,
        { field: `recurringCommitments[${idx}].amount` }
      );
    }
    if (!RECURRING_EXPENSE_FREQUENCIES.includes(c.frequency)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `recurringCommitments[${idx}].frequency inválida: ${c.frequency}.`,
        { field: `recurringCommitments[${idx}].frequency` }
      );
    }
    const normalizedCommitment = {
      name: c.name.trim(),
      amount: round2(amount),
      frequency: c.frequency,
    };
    if (Number.isInteger(c.dueDayOfMonth) && c.dueDayOfMonth >= 1 && c.dueDayOfMonth <= 31) {
      normalizedCommitment.dueDayOfMonth = c.dueDayOfMonth;
    }
    if (Number.isInteger(c.dueMonth) && c.dueMonth >= 1 && c.dueMonth <= 12) {
      normalizedCommitment.dueMonth = c.dueMonth;
    }
    return normalizedCommitment;
  });
}

export function validatePreferences(preferences) {
  if (preferences === undefined || preferences === null) {
    return {
      dislikedIngredients: [],
      preferredMealCategories: [],
    };
  }
  if (!isPlainObject(preferences)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'preferences debe ser un objeto válido.', {
      field: 'preferences',
    });
  }

  if (
    preferences.dislikedIngredients !== undefined &&
    preferences.dislikedIngredients !== null &&
    !Array.isArray(preferences.dislikedIngredients)
  ) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'preferences.dislikedIngredients debe ser un arreglo.',
      { field: 'preferences.dislikedIngredients' }
    );
  }

  const dislikedIngredients = (preferences.dislikedIngredients ?? []).map((item, idx) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `preferences.dislikedIngredients[${idx}] debe ser una cadena no vacía.`,
        { field: `preferences.dislikedIngredients[${idx}]` }
      );
    }
    return item.trim().toLowerCase();
  });

  if (
    preferences.preferredMealCategories !== undefined &&
    preferences.preferredMealCategories !== null &&
    !Array.isArray(preferences.preferredMealCategories)
  ) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'preferences.preferredMealCategories debe ser un arreglo.',
      { field: 'preferences.preferredMealCategories' }
    );
  }

  const preferredMealCategories = (preferences.preferredMealCategories ?? []).map((cat, idx) => {
    const normalizedCat = typeof cat === 'string' ? cat.trim().toLowerCase() : '';
    if (!RECIPE_CATEGORIES.includes(normalizedCat)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `preferences.preferredMealCategories[${idx}] inválida: ${cat}.`,
        { field: `preferences.preferredMealCategories[${idx}]` }
      );
    }
    return normalizedCat;
  });

  return {
    dislikedIngredients,
    preferredMealCategories,
  };
}

export function validatePersonalProfile(profile) {
  if (!isPlainObject(profile)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'PersonalProfile debe ser un objeto válido.');
  }

  const biometrics = validateBiometrics(profile.biometrics);
  const rawEmployments =
    profile.employments !== undefined
      ? profile.employments
      : (profile.employment ? [profile.employment] : []);
  const employments = validateEmployments(rawEmployments);
  const recurringCommitments = validateRecurringCommitments(profile.recurringCommitments);
  const preferences = validatePreferences(profile.preferences);

  const clinicalHistory = Array.isArray(profile.clinicalHistory)
    ? profile.clinicalHistory.map((panel) => evaluateClinicalPanel(panel))
    : [];

  let fixedExpensesBiweekly = employments.reduce(
    (sum, emp) => sum + (emp.fixedExpensesBiweekly ?? 0),
    0
  );
  if (profile.fixedExpensesBiweekly !== undefined && profile.fixedExpensesBiweekly !== null) {
    const parsedExp = Number(profile.fixedExpensesBiweekly);
    if (!Number.isFinite(parsedExp) || parsedExp < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'fixedExpensesBiweekly debe ser un número finito mayor o igual a 0.',
        { field: 'fixedExpensesBiweekly' }
      );
    }
    fixedExpensesBiweekly = round2(parsedExp);
  } else {
    fixedExpensesBiweekly = round2(fixedExpensesBiweekly);
  }

  return {
    id: typeof profile.id === 'string' && profile.id.trim() ? profile.id.trim() : null,
    name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : null,
    biometrics,
    employment: employments[0],
    employments,
    recurringCommitments,
    clinicalHistory,
    preferences,
    fixedExpensesBiweekly,
  };
}

export function normalizePersonalProfile(profile) {
  return validatePersonalProfile(profile);
}

export function calculateAgeYears(birthDate, referenceDateOrClock) {
  const birthIso = normalizeIsoDateOnly(birthDate, 'birthDate');
  const refIso = resolveReferenceDate(referenceDateOrClock);

  const [birthYear, birthMonth, birthDay] = birthIso.split('-').map(Number);
  const [refYear, refMonth, refDay] = refIso.split('-').map(Number);

  let age = refYear - birthYear;
  if (refMonth < birthMonth || (refMonth === birthMonth && refDay < birthDay)) {
    age -= 1;
  }

  if (age < 0) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'La fecha de referencia no puede ser anterior a birthDate.',
      { field: 'referenceDate' }
    );
  }

  return age;
}

export function calculateBmr(biometricsOrProfile, referenceDateOrClock) {
  const rawBiometrics =
    isPlainObject(biometricsOrProfile) && biometricsOrProfile.biometrics
      ? biometricsOrProfile.biometrics
      : biometricsOrProfile;
  const bio = validateBiometrics(rawBiometrics);
  const ageYears = calculateAgeYears(bio.birthDate, referenceDateOrClock);

  const base = 10 * bio.currentWeightKg + 6.25 * bio.heightCm - 5 * ageYears;
  const sexAdjustment = bio.sex === 'male' ? 5 : -161;
  return round2(base + sexAdjustment);
}

function singleEmploymentBiweeklyIncome(employment) {
  if (employment.type === 'fixed') {
    const incomeObj = employment.fixedIncome ?? employment.income;
    const factor = BIWEEKLY_FREQUENCY_FACTORS[incomeObj.frequency] ?? 1;
    return round2(incomeObj.amount * factor);
  }

  if (!Array.isArray(employment.historicalIncomes) || employment.historicalIncomes.length === 0) {
    return 0;
  }

  const total = employment.historicalIncomes.reduce((acc, entry) => acc + entry.amount, 0);
  return round2(total / employment.historicalIncomes.length);
}

export function calculateTotalBiweeklyIncome(employmentsOrProfile) {
  const rawList = Array.isArray(employmentsOrProfile)
    ? employmentsOrProfile
    : (employmentsOrProfile?.employments ?? (employmentsOrProfile?.employment ? [employmentsOrProfile.employment] : []));
  const employments = validateEmployments(rawList);

  const total = employments.reduce((acc, emp) => acc + singleEmploymentBiweeklyIncome(emp), 0);
  return round2(total);
}

export function calculateProjectedBiweeklyIncome(employmentOrProfile) {
  if (Array.isArray(employmentOrProfile)) {
    return calculateTotalBiweeklyIncome(employmentOrProfile);
  }
  if (isPlainObject(employmentOrProfile) && Array.isArray(employmentOrProfile.employments)) {
    return calculateTotalBiweeklyIncome(employmentOrProfile.employments);
  }
  const rawEmployment =
    isPlainObject(employmentOrProfile) && employmentOrProfile.employment
      ? employmentOrProfile.employment
      : employmentOrProfile;
  const employment = validateEmployment(rawEmployment);
  return singleEmploymentBiweeklyIncome(employment);
}

export function calculateBiweeklyCommitments(commitments) {
  const normalized = validateRecurringCommitments(commitments);
  let total = 0;
  for (const c of normalized) {
    if (c.frequency === 'weekly') total += c.amount * 2;
    else if (c.frequency === 'biweekly') total += c.amount;
    else if (c.frequency === 'monthly') total += c.amount / 2;
    else if (c.frequency === 'annual') total += c.amount / 24;
  }
  return round2(total);
}

export function calculateTotalBlockedWeeklyHours(employmentsOrProfile) {
  const rawList = Array.isArray(employmentsOrProfile)
    ? employmentsOrProfile
    : (employmentsOrProfile?.employments ?? (employmentsOrProfile?.employment ? [employmentsOrProfile.employment] : []));
  const employments = validateEmployments(rawList);

  let totalHours = 0;
  for (const emp of employments) {
    if (emp.type === 'fixed' && Array.isArray(emp.workingHoursWindows)) {
      for (const w of emp.workingHoursWindows) {
        totalHours += w.endHour - w.startHour;
      }
    } else if (typeof emp.targetWeeklyHours === 'number') {
      totalHours += emp.targetWeeklyHours;
    }
  }
  return round2(totalHours);
}
