import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCaloriesBurned,
  validateExercise,
  STANDARD_EXERCISES,
} from '../src/domain/knowledge/exercise-library-contract.js';

import {
  evaluateRecipeClinicalSuitability,
  filterRecipesByClinicalContext,
} from '../src/application/knowledge/clinical-nutrition-filter.js';

import { planWeeklyPantryAndBudget } from '../src/application/knowledge/pantry-planner-service.js';

test('EXERCISE: Cálculo determinista de gasto calórico según peso y METs', () => {
  const walk = STANDARD_EXERCISES.find((e) => e.id === 'ex-walk-brisk');
  assert.ok(walk);
  assert.doesNotThrow(() => validateExercise(walk));

  // Para 80 kg y 30 min de caminata rápida (METs 3.8):
  // (3.8 * 3.5 * 80 / 200) * 30 = 5.32 * 30 = 159.6 -> 160 kcal
  const kcalWalk = calculateCaloriesBurned(walk.mets, 80, 30);
  assert.equal(kcalWalk, 160);

  // Para 80 kg y 40 min de pesas (METs 5.0):
  // (5.0 * 3.5 * 80 / 200) * 40 = 7.0 * 40 = 280 kcal
  const kcalWeights = calculateCaloriesBurned(5.0, 80, 40);
  assert.equal(kcalWeights, 280);
});

test('CLINICAL NUTRITION: Filtrado determinista de recetas ante triglicéridos elevados', () => {
  const highCarbRecipe = {
    id: 'rec-pasta',
    name: 'Pasta con salsa dulce',
    macros: { proteinGrams: 15, carbsGrams: 75, fatGrams: 8 },
  };
  const lowCarbRecipe = {
    id: 'rec-omelette',
    name: 'Omelette con espinacas y pechuga',
    macros: { proteinGrams: 30, carbsGrams: 10, fatGrams: 12 },
  };

  const evalHighCarb = evaluateRecipeClinicalSuitability(highCarbRecipe, { triglyceridesHigh: true });
  assert.equal(evalHighCarb.suitable, false);
  assert.equal(evalHighCarb.violations.length, 1);
  assert.equal(evalHighCarb.violations[0].biomarker, 'triglycerides');

  const evalLowCarb = evaluateRecipeClinicalSuitability(lowCarbRecipe, { triglyceridesHigh: true });
  assert.equal(evalLowCarb.suitable, true);
  assert.equal(evalLowCarb.violations.length, 0);

  // Filtrado de lista
  const filtered = filterRecipesByClinicalContext([highCarbRecipe, lowCarbRecipe], {
    hasAlerts: true,
    evaluations: [{ marker: 'triglycerides', status: 'high' }],
  });
  assert.equal(filtered[0].suitable, false);
  assert.equal(filtered[1].suitable, true);
});

test('PANTRY & BUDGET: Consolidación de menú semanal vs inventario y alerta de presupuesto', () => {
  const mockRecipes = [
    {
      id: 'rec-1',
      name: 'Pollo con verduras',
      ingredients: [
        { itemId: 'item-chicken', itemName: 'Pechuga de pollo', requiredQuantity: 500, unit: 'g' },
        { itemId: 'item-broccoli', itemName: 'Brócoli', requiredQuantity: 200, unit: 'g' },
      ],
    },
  ];

  const currentInventory = [
    { itemId: 'item-chicken', availableQuantity: 200, unit: 'g', unitCost: 0.15 }, // faltan 300g -> $45
    { itemId: 'item-broccoli', availableQuantity: 0, unit: 'g', unitCost: 0.05 }, // faltan 200g -> $10
  ]; // Total estimado: $55

  // Caso 1: Dentro de presupuesto ($100 disponible)
  const reportOk = planWeeklyPantryAndBudget({
    weeklyMenuRecipes: mockRecipes,
    currentInventory,
    weeklyGroceryBudget: 100,
  });
  assert.equal(reportOk.isWithinBudget, true);
  assert.equal(reportOk.estimatedTotalCost, 55);
  assert.equal(reportOk.budgetSurplus, 45);
  assert.equal(reportOk.budgetAlert, null);

  // Caso 2: Excede presupuesto ($40 disponible)
  const reportExceeded = planWeeklyPantryAndBudget({
    weeklyMenuRecipes: mockRecipes,
    currentInventory,
    weeklyGroceryBudget: 40,
  });
  assert.equal(reportExceeded.isWithinBudget, false);
  assert.equal(reportExceeded.budgetSurplus, -15);
  assert.ok(reportExceeded.budgetAlert);
  assert.equal(reportExceeded.budgetAlert.deficit, 15);
});
