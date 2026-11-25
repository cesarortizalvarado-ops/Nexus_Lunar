import { evaluateClinicalPanel } from '../../domain/personal/clinical-reference-library.js';
import { calculateBmr, validatePersonalProfile } from '../../domain/personal/personal-profile-contract.js';
import { extractGoalResourceImpact } from '../../domain/personal/goal-resource-contract.js';
import { STANDARD_EXERCISES, calculateCaloriesBurned } from '../../domain/knowledge/exercise-library-contract.js';
import { evaluateGoalFeasibility } from '../personal/goal-feasibility-evaluator.js';
import { filterRecipesByClinicalContext } from '../knowledge/clinical-nutrition-filter.js';
import { findDailyMealPlanCandidates } from '../knowledge/recipe-nutrition-service.js';
import { planWeeklyPantryAndBudget } from '../knowledge/pantry-planner-service.js';

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function findFreeTimeSlot(occupiedBlocks, durationHours, preferredStartHour = 6, minHour = 5, maxHour = 23) {
  const step = 0.25; // Resolución determinista de 15 minutos
  const isSlotFree = (start, end) => {
    if (start < minHour || end > maxHour) return false;
    return !occupiedBlocks.some((b) => intervalsOverlap(start, end, b.startHour, b.endHour));
  };

  if (typeof preferredStartHour === 'number' && isSlotFree(preferredStartHour, preferredStartHour + durationHours)) {
    return { startHour: preferredStartHour, endHour: Number((preferredStartHour + durationHours).toFixed(2)) };
  }

  for (let start = minHour; start + durationHours <= maxHour + 1e-9; start = Number((start + step).toFixed(2))) {
    const end = Number((start + durationHours).toFixed(2));
    if (isSlotFree(start, end)) {
      return { startHour: start, endHour: end };
    }
  }

  return null;
}

function extractRecipesFromMealCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return [];
  if (Array.isArray(candidate.recipes)) return candidate.recipes;
  if (Array.isArray(candidate.meals)) return candidate.meals;
  const list = [];
  for (const key of ['breakfast', 'lunch', 'dinner', 'snack']) {
    if (candidate[key]) list.push(candidate[key]);
  }
  return list;
}

function hasDislikedIngredient(recipe, dislikedIngredients = []) {
  if (!Array.isArray(dislikedIngredients) || dislikedIngredients.length === 0) return false;
  const normalizedDisliked = new Set(dislikedIngredients.map((i) => String(i).trim().toLowerCase()));
  return (recipe.ingredients || []).some(
    (ing) =>
      normalizedDisliked.has(String(ing.itemName || '').trim().toLowerCase()) ||
      normalizedDisliked.has(String(ing.itemId || '').trim().toLowerCase())
  );
}

export function generateWeeklyPlanDraft({
  weekStartDate,
  userProfile,
  activeGoals = [],
  fixedCommitments = [],
  clinicalPanel = null,
  libraries = {},
  currentInventory = [],
  weeklyGroceryBudget = 0,
  exerciseScheduleRequests = [],
  preferences = {},
}) {
  if (!weekStartDate || Number.isNaN(Date.parse(weekStartDate))) {
    throw new Error('INVALID_WEEK_START_DATE: Fecha ISO válida requerida.');
  }
  validatePersonalProfile(userProfile);

  const sleepStartHour = preferences.sleepStartHour ?? 23;
  const sleepEndHour = preferences.sleepEndHour ?? 6;
  const baseActivityMultiplier = preferences.baseActivityMultiplier ?? 1.2;
  const mealCalorieTolerance = preferences.mealCalorieTolerance ?? 0.08;

  // 1. Evaluaciones deterministas base (Bloque 1)
  const feasibilityReport = evaluateGoalFeasibility(activeGoals, {}, userProfile);
  const clinicalReport = clinicalPanel ? evaluateClinicalPanel(clinicalPanel) : { evaluations: [], hasAlerts: false };
  const bmr = calculateBmr(userProfile.biometrics, weekStartDate);
  const weightKg = userProfile.biometrics.currentWeightKg;

  const weeklyDeficitTarget =
    feasibilityReport.totals?.weeklyDeficitCalories ??
    feasibilityReport.totals?.weeklyCaloricDeficitTarget ??
    feasibilityReport.totals?.weeklyCaloricDeficit ??
    0;
  const dailyDeficitTarget = Math.round(weeklyDeficitTarget / 7);

  // 2. Preparar bibliotecas y filtrar recetas por clínica y preferencias (Bloque 2)
  const exerciseCatalog =
    Array.isArray(libraries.exercises) && libraries.exercises.length > 0
      ? libraries.exercises
      : STANDARD_EXERCISES;

  const rawRecipes = Array.isArray(libraries.recipes) ? libraries.recipes : [];
  const disliked = userProfile.preferences?.dislikedIngredients || [];
  const clinicallyEvaluatedRecipes = filterRecipesByClinicalContext(rawRecipes, clinicalReport);
  const eligibleRecipes = clinicallyEvaluatedRecipes
    .filter((item) => item.suitable && !hasDislikedIngredient(item.recipe, disliked))
    .map((item) => item.recipe);

  // 3. Inicializar los 7 días (0=Domingo .. 6=Sábado) con Hard Constraints
  const hardConflicts = [];
  const unscheduledItems = [];
  const employments = userProfile.employments || (userProfile.employment ? [userProfile.employment] : []);

  const dailySchedules = Array.from({ length: 7 }, (_, dayOfWeek) => {
    const blocks = [];

    // Ventanas de sueño (Hard)
    if (sleepEndHour > 0) {
      blocks.push({
        id: `d${dayOfWeek}-sleep-am`,
        title: 'Descanso nocturno',
        category: 'sleep',
        dayOfWeek,
        startHour: 0,
        endHour: sleepEndHour,
        hard: true,
      });
    }
    if (sleepStartHour < 24) {
      blocks.push({
        id: `d${dayOfWeek}-sleep-pm`,
        title: 'Descanso nocturno',
        category: 'sleep',
        dayOfWeek,
        startHour: sleepStartHour,
        endHour: 24,
        hard: true,
      });
    }

    // Horarios laborales fijos (Hard)
    employments.forEach((emp, empIdx) => {
      if (emp.type === 'fixed' && Array.isArray(emp.workingHoursWindows)) {
        emp.workingHoursWindows
          .filter((w) => w.dayOfWeek === dayOfWeek)
          .forEach((w, winIdx) => {
            const newBlock = {
              id: `d${dayOfWeek}-work-${empIdx}-${winIdx}`,
              title: emp.title || 'Trabajo fijo',
              category: 'work_fixed',
              dayOfWeek,
              startHour: w.startHour,
              endHour: w.endHour,
              hard: true,
            };
            const overlapping = blocks.find((b) =>
              intervalsOverlap(b.startHour, b.endHour, newBlock.startHour, newBlock.endHour)
            );
            if (overlapping) {
              hardConflicts.push({
                type: 'HARD_OVERLAP',
                dayOfWeek,
                blockA: overlapping.id,
                blockB: newBlock.id,
                message: `Solapamiento entre ${overlapping.title} y ${newBlock.title} en el día ${dayOfWeek}.`,
              });
            }
            blocks.push(newBlock);
          });
      }
    });

    // Compromisos externos fijos (Hard)
    fixedCommitments
      .filter((c) => c.dayOfWeek === dayOfWeek)
      .forEach((c, idx) => {
        const newBlock = {
          id: c.id || `d${dayOfWeek}-commitment-${idx}`,
          title: c.title,
          category: 'commitment',
          dayOfWeek,
          startHour: c.startHour,
          endHour: c.endHour,
          hard: true,
        };
        const overlapping = blocks.find((b) =>
          intervalsOverlap(b.startHour, b.endHour, newBlock.startHour, newBlock.endHour)
        );
        if (overlapping) {
          hardConflicts.push({
            type: 'HARD_OVERLAP',
            dayOfWeek,
            blockA: overlapping.id,
            blockB: newBlock.id,
            message: `Compromiso "${newBlock.title}" se solapa con "${overlapping.title}" en el día ${dayOfWeek}.`,
          });
        }
        blocks.push(newBlock);
      });

    return {
      dayOfWeek,
      blocks,
      nutrition: null,
      exerciseCaloriesBurned: 0,
    };
  });

  // 4. Asignación determinista de bloques de ejercicio
  for (const req of exerciseScheduleRequests) {
    const exercise = exerciseCatalog.find((e) => e.id === req.exerciseId);
    if (!exercise) {
      unscheduledItems.push({
        type: 'exercise',
        itemId: req.exerciseId,
        reason: 'UNKNOWN_EXERCISE',
      });
      continue;
    }

    const durationMinutes = req.durationMinutes || exercise.defaultDurationMinutes || 30;
    const durationHours = Number((durationMinutes / 60).toFixed(2));
    const days = Array.isArray(req.daysOfWeek) ? req.daysOfWeek : [];

    for (const dayOfWeek of days) {
      const daySchedule = dailySchedules[dayOfWeek];
      if (!daySchedule) continue;

      const slot = findFreeTimeSlot(daySchedule.blocks, durationHours, req.preferredStartHour, sleepEndHour, sleepStartHour);
      if (!slot) {
        unscheduledItems.push({
          type: 'exercise',
          itemId: exercise.id,
          title: exercise.name,
          dayOfWeek,
          durationMinutes,
          reason: 'NO_FREE_TIME_SLOT',
        });
        continue;
      }

      const kcalBurned = calculateCaloriesBurned(exercise.mets, weightKg, durationMinutes);
      daySchedule.blocks.push({
        id: `d${dayOfWeek}-ex-${exercise.id}-${slot.startHour}`,
        title: exercise.name,
        category: 'exercise',
        dayOfWeek,
        startHour: slot.startHour,
        endHour: slot.endHour,
        hard: false,
        metadata: { exerciseId: exercise.id, durationMinutes, caloriesBurned: kcalBurned },
      });
      daySchedule.exerciseCaloriesBurned += kcalBurned;
    }
  }

  // 5. Cálculo calórico diario y selección de menú compatible con clínica
  const weeklyMenuRecipes = [];
  for (const daySchedule of dailySchedules) {
    const maintenanceCalories = Math.round(bmr * baseActivityMultiplier);
    const dailyTargetCalories = Math.max(1200, maintenanceCalories + daySchedule.exerciseCaloriesBurned - dailyDeficitTarget);

    let selectedCandidate = null;
    if (eligibleRecipes.length > 0) {
      const candidates = findDailyMealPlanCandidates(eligibleRecipes, dailyTargetCalories, mealCalorieTolerance);
      if (Array.isArray(candidates) && candidates.length > 0) {
        // Rotación determinista por día entre los mejores candidatos válidos
        const candidateIdx = daySchedule.dayOfWeek % Math.min(candidates.length, 3);
        selectedCandidate = candidates[candidateIdx];
        const dayRecipes = extractRecipesFromMealCandidate(selectedCandidate);
        weeklyMenuRecipes.push(...dayRecipes);
      }
    }

    daySchedule.nutrition = {
      bmr,
      maintenanceCalories,
      exerciseCaloriesBurned: daySchedule.exerciseCaloriesBurned,
      dailyDeficitTarget,
      targetCalories: dailyTargetCalories,
      mealPlan: selectedCandidate,
      hasValidMealPlan: Boolean(selectedCandidate),
    };
  }

  // 6. Distribución determinista de horas freelance y metas basadas en tiempo
  const flexibleDemands = [];

  employments.forEach((emp, idx) => {
    if (emp.type === 'freelance' && typeof emp.targetWeeklyHours === 'number' && emp.targetWeeklyHours > 0) {
      flexibleDemands.push({
        id: `freelance-${idx}`,
        title: emp.title || `Proyecto Freelance ${idx + 1}`,
        category: 'work_freelance',
        remainingHours: emp.targetWeeklyHours,
        sessionHours: 2,
      });
    }
  });

  activeGoals.forEach((goal) => {
    const impact = extractGoalResourceImpact(goal);
    if (impact?.time?.weeklyHoursRequired > 0) {
      flexibleDemands.push({
        id: `goal-${goal.id}`,
        title: goal.title || goal.name || goal.id,
        category: 'goal_task',
        remainingHours: impact.time.weeklyHoursRequired,
        sessionHours: 1,
      });
    }
  });

  for (const demand of flexibleDemands) {
    let sessionCount = 0;
    for (let dayOfWeek = 0; dayOfWeek < 7 && demand.remainingHours > 0; dayOfWeek++) {
      const daySchedule = dailySchedules[dayOfWeek];
      const blockDuration = Math.min(demand.sessionHours, demand.remainingHours);
      const slot = findFreeTimeSlot(daySchedule.blocks, blockDuration, null, sleepEndHour, sleepStartHour);
      if (slot) {
        sessionCount++;
        daySchedule.blocks.push({
          id: `d${dayOfWeek}-${demand.id}-s${sessionCount}`,
          title: demand.title,
          category: demand.category,
          dayOfWeek,
          startHour: slot.startHour,
          endHour: slot.endHour,
          hard: false,
        });
        demand.remainingHours = Number((demand.remainingHours - blockDuration).toFixed(2));
      }
    }

    if (demand.remainingHours > 0) {
      unscheduledItems.push({
        type: demand.category,
        itemId: demand.id,
        title: demand.title,
        unscheduledHours: demand.remainingHours,
        reason: 'INSUFFICIENT_WEEKLY_FREE_SLOTS',
      });
    }
  }

  // Ordenar cronológicamente los bloques de cada día
  for (const daySchedule of dailySchedules) {
    daySchedule.blocks.sort((a, b) => a.startHour - b.startHour);
  }

  // 7. Preparación dominical: despensa, lista de compras y presupuesto
  const pantryReport = planWeeklyPantryAndBudget({
    weeklyMenuRecipes,
    currentInventory,
    weeklyGroceryBudget,
  });

  return {
    status: 'draft',
    weekStartDate,
    feasibilityReport,
    clinicalReport,
    dailySchedules,
    sundayPrep: {
      pantryReport,
      recurringCommitmentsChecklist: (userProfile.recurringCommitments || []).map((c) => ({
        name: c.name,
        amount: c.amount,
        frequency: c.frequency,
        status: 'pending_verification',
      })),
    },
    hardConflicts,
    unscheduledItems,
  };
}
