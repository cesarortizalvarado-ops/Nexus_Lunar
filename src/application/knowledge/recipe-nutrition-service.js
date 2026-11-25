import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { normalizeRecipe } from '../../domain/knowledge/recipe-contract.js';

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function round4(value) {
  return Number(Number(value).toFixed(4));
}

function buildCandidate(breakfast, lunch, dinner, snack, targetCalories) {
  const recipes = snack ? [breakfast, lunch, dinner, snack] : [breakfast, lunch, dinner];

  const totalCalories = round2(
    recipes.reduce((sum, r) => sum + r.caloriesPerServing, 0)
  );
  const signedDeviationCalories = round2(totalCalories - targetCalories);
  const deviationCalories = round2(Math.abs(signedDeviationCalories));
  const deviationPercentage = round4(deviationCalories / targetCalories);

  const totalMacros = {
    proteinGrams: round2(recipes.reduce((sum, r) => sum + r.macros.proteinGrams, 0)),
    carbsGrams: round2(recipes.reduce((sum, r) => sum + r.macros.carbsGrams, 0)),
    fatGrams: round2(recipes.reduce((sum, r) => sum + r.macros.fatGrams, 0)),
  };

  const totalPrepTimeMinutes = round2(
    recipes.reduce((sum, r) => sum + r.prepTimeMinutes, 0)
  );

  return {
    meals: {
      breakfast,
      lunch,
      dinner,
      snack: snack ?? null,
    },
    recipes,
    totalCalories,
    targetCalories: round2(targetCalories),
    deviationCalories,
    signedDeviationCalories,
    deviationPercentage,
    totalMacros,
    totalPrepTimeMinutes,
  };
}

export function findDailyMealPlanCandidates(recipes, targetCalories, tolerancePercentage = 0.05) {
  if (!Array.isArray(recipes)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'recipes debe ser un arreglo de recetas.',
      { field: 'recipes' }
    );
  }

  const parsedTarget = Number(targetCalories);
  if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'targetCalories debe ser un número positivo.',
      { field: 'targetCalories' }
    );
  }

  const parsedTolerance = Number(tolerancePercentage);
  if (!Number.isFinite(parsedTolerance) || parsedTolerance < 0 || parsedTolerance > 1) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'tolerancePercentage debe ser un número entre 0 y 1.',
      { field: 'tolerancePercentage' }
    );
  }

  const normalized = recipes.map((r) => normalizeRecipe(r));

  const breakfasts = normalized.filter((r) => r.category === 'breakfast');
  const lunches = normalized.filter((r) => r.category === 'lunch');
  const dinners = normalized.filter((r) => r.category === 'dinner');
  const snacks = normalized.filter((r) => r.category === 'snack');

  if (breakfasts.length === 0 || lunches.length === 0 || dinners.length === 0) {
    return [];
  }

  const minCalories = round2(parsedTarget * (1 - parsedTolerance));
  const maxCalories = round2(parsedTarget * (1 + parsedTolerance));

  const candidates = [];

  for (const breakfast of breakfasts) {
    for (const lunch of lunches) {
      for (const dinner of dinners) {
        const baseCandidate = buildCandidate(breakfast, lunch, dinner, null, parsedTarget);
        if (baseCandidate.totalCalories >= minCalories && baseCandidate.totalCalories <= maxCalories) {
          candidates.push(baseCandidate);
        }

        for (const snack of snacks) {
          const withSnack = buildCandidate(breakfast, lunch, dinner, snack, parsedTarget);
          if (withSnack.totalCalories >= minCalories && withSnack.totalCalories <= maxCalories) {
            candidates.push(withSnack);
          }
        }
      }
    }
  }

  return candidates.sort((a, b) => {
    if (a.deviationCalories !== b.deviationCalories) {
      return a.deviationCalories - b.deviationCalories;
    }
    if (a.recipes.length !== b.recipes.length) {
      return a.recipes.length - b.recipes.length;
    }
    const sigA = a.recipes.map((r) => r.id).join('|');
    const sigB = b.recipes.map((r) => r.id).join('|');
    return sigA.localeCompare(sigB);
  });
}
