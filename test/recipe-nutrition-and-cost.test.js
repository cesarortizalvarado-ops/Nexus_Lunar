import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECIPE_CATEGORIES,
  normalizeRecipe,
  validateRecipe,
} from '../src/domain/knowledge/recipe-contract.js';
import {
  RecipeCostEvaluator,
  evaluateRecipeCost,
} from '../src/application/knowledge/recipe-cost-evaluator.js';
import { findDailyMealPlanCandidates } from '../src/application/knowledge/recipe-nutrition-service.js';
import { ERROR_CODES } from '../src/shared/errors.js';

const SAMPLE_RECIPES = [
  {
    id: 'rec-oats',
    name: 'Avena proteica con plátano',
    category: 'breakfast',
    prepTimeMinutes: 10,
    servings: 1,
    caloriesPerServing: 450,
    macros: { proteinGrams: 28, carbsGrams: 60, fatGrams: 10 },
    ingredients: [
      { itemId: 'ing-oats', itemName: 'Avena', requiredQuantity: 80, unit: 'g' },
      { itemId: 'ing-milk', itemName: 'Leche', requiredQuantity: 250, unit: 'ml' },
      { itemId: 'ing-banana', itemName: 'Plátano', requiredQuantity: 1, unit: 'pz' },
    ],
  },
  {
    id: 'rec-eggs',
    name: 'Huevos revueltos con espinaca',
    category: 'breakfast',
    prepTimeMinutes: 12,
    servings: 1,
    caloriesPerServing: 380,
    macros: { proteinGrams: 24, carbsGrams: 12, fatGrams: 24 },
    ingredients: [
      { itemId: 'ing-egg', itemName: 'Huevo', requiredQuantity: 3, unit: 'pz' },
      { itemId: 'ing-spinach', itemName: 'Espinaca', requiredQuantity: 60, unit: 'g' },
    ],
  },
  {
    id: 'rec-chicken-rice',
    name: 'Pechuga de pollo con arroz integral',
    category: 'lunch',
    prepTimeMinutes: 25,
    servings: 1,
    caloriesPerServing: 720,
    macros: { proteinGrams: 55, carbsGrams: 75, fatGrams: 18 },
    ingredients: [
      { itemId: 'ing-chicken', itemName: 'Pechuga de pollo', requiredQuantity: 200, unit: 'g' },
      { itemId: 'ing-rice', itemName: 'Arroz integral', requiredQuantity: 120, unit: 'g' },
    ],
  },
  {
    id: 'rec-tuna-salad',
    name: 'Ensalada de atún con garbanzo',
    category: 'dinner',
    prepTimeMinutes: 15,
    servings: 1,
    caloriesPerServing: 560,
    macros: { proteinGrams: 42, carbsGrams: 48, fatGrams: 16 },
    ingredients: [
      { itemId: 'ing-tuna', itemName: 'Atún', requiredQuantity: 140, unit: 'g' },
      { itemId: 'ing-spinach', itemName: 'Espinaca', requiredQuantity: 80, unit: 'g' },
    ],
  },
  {
    id: 'rec-yogurt',
    name: 'Yogurt griego con nuez',
    category: 'snack',
    prepTimeMinutes: 5,
    servings: 1,
    caloriesPerServing: 250,
    macros: { proteinGrams: 18, carbsGrams: 16, fatGrams: 12 },
    ingredients: [
      { itemId: 'ing-yogurt', itemName: 'Yogurt griego', requiredQuantity: 150, unit: 'g' },
    ],
  },
];

test('recipe-contract — valida y normaliza recetas válidas y rechaza entradas inválidas', () => {
  assert.deepEqual(RECIPE_CATEGORIES, ['breakfast', 'lunch', 'dinner', 'snack']);

  const normalized = normalizeRecipe({
    id: ' rec-01 ',
    name: ' Licuado verde ',
    category: 'BREAKFAST',
    prepTimeMinutes: 5,
    servings: 1,
    caloriesPerServing: 310,
    macros: { proteinGrams: 20, carbsGrams: 35, fatGrams: 8 },
    ingredients: [
      { itemId: 'ing-milk', itemName: 'Leche', requiredQuantity: 250, unit: ' ML ' },
    ],
  });

  assert.equal(normalized.id, 'rec-01');
  assert.equal(normalized.name, 'Licuado verde');
  assert.equal(normalized.category, 'breakfast');
  assert.equal(normalized.ingredients[0].unit, 'ml');

  // Categoría inválida
  assert.throws(
    () => validateRecipe({ ...SAMPLE_RECIPES[0], category: 'brunch' }),
    (err) => err?.code === ERROR_CODES.VALIDATION_ERROR
  );

  // Calorías no positivas
  assert.throws(
    () => validateRecipe({ ...SAMPLE_RECIPES[0], caloriesPerServing: 0 }),
    (err) => err?.code === ERROR_CODES.VALIDATION_ERROR
  );

  // Cantidad de ingrediente no positiva
  assert.throws(
    () =>
      validateRecipe({
        ...SAMPLE_RECIPES[0],
        ingredients: [{ itemId: 'ing-oats', itemName: 'Avena', requiredQuantity: -10, unit: 'g' }],
      }),
    (err) => err?.code === ERROR_CODES.VALIDATION_ERROR
  );

  // Sin ingredientes
  assert.throws(
    () => validateRecipe({ ...SAMPLE_RECIPES[0], ingredients: [] }),
    (err) => err?.code === ERROR_CODES.VALIDATION_ERROR
  );
});

test('RecipeCostEvaluator — consolida ingredientes, descuenta despensa y calcula lista de compras y costo exacto', () => {
  const menu = [SAMPLE_RECIPES[1], SAMPLE_RECIPES[2], SAMPLE_RECIPES[3]];
  // Ingredientes totales del menú:
  // ing-egg: 3 pz
  // ing-spinach: 60 g + 80 g = 140 g
  // ing-chicken: 200 g
  // ing-rice: 120 g
  // ing-tuna: 140 g

  const currentInventory = [
    { itemId: 'ing-egg', availableQuantity: 6, unit: 'pz', unitCost: 3.5 },        // 100% cubierto
    { itemId: 'ing-spinach', availableQuantity: 40, unit: 'g', unitCost: 0.1 },    // faltan 100 g -> 10.00
    { itemId: 'ing-chicken', availableQuantity: 50, unit: 'g', unitCost: 0.18 },   // faltan 150 g -> 27.00
    { itemId: 'ing-rice', availableQuantity: 120, unit: 'g', unitCost: 0.05 },     // 100% cubierto
    { itemId: 'ing-tuna', availableQuantity: 0, unit: 'g', unitCost: 0.25 },       // faltan 140 g -> 35.00
  ];

  const evaluator = new RecipeCostEvaluator(currentInventory);
  const result = evaluator.evaluate(menu);

  assert.equal(result.recipesEvaluatedCount, 3);
  assert.equal(result.ingredientsNeeded.length, 5);

  const spinachNeed = result.ingredientsNeeded.find((i) => i.itemId === 'ing-spinach');
  assert.equal(spinachNeed.requiredQuantity, 140);

  assert.equal(result.pantryCoverage.totalIngredientsCount, 5);
  assert.equal(result.pantryCoverage.fullyCoveredCount, 2);
  assert.equal(result.pantryCoverage.partiallyCoveredCount, 2);
  assert.equal(result.pantryCoverage.uncoveredCount, 1);

  assert.equal(result.shoppingList.length, 3);
  const byId = new Map(result.shoppingList.map((item) => [item.itemId, item]));
  assert.equal(byId.get('ing-spinach').quantityToBuy, 100);
  assert.equal(byId.get('ing-spinach').estimatedCost, 10);
  assert.equal(byId.get('ing-chicken').quantityToBuy, 150);
  assert.equal(byId.get('ing-chicken').estimatedCost, 27);
  assert.equal(byId.get('ing-tuna').quantityToBuy, 140);
  assert.equal(byId.get('ing-tuna').estimatedCost, 35);

  // Costo total proyectado: 10 + 27 + 35 = 72.00
  assert.equal(result.estimatedTotalCost, 72);
  assert.deepEqual(result.itemsWithoutPrice, []);
});

test('RecipeCostEvaluator — rechaza unidades incompatibles entre receta e inventario (INV-016)', () => {
  assert.throws(
    () =>
      evaluateRecipeCost(
        [SAMPLE_RECIPES[0]],
        [{ itemId: 'ing-milk', availableQuantity: 1, unit: 'l', unitCost: 25 }]
      ),
    (err) => err?.code === ERROR_CODES.INTEGRITY_ERROR
  );
});

test('findDailyMealPlanCandidates — selecciona y ordena planes diarios dentro del margen calórico sin alucinar ingredientes', () => {
  // Combinaciones posibles con SAMPLE_RECIPES:
  // 1) oats (450) + chicken (720) + tuna (560) = 1730 kcal
  // 2) oats (450) + chicken (720) + tuna (560) + yogurt (250) = 1980 kcal
  // 3) eggs (380) + chicken (720) + tuna (560) = 1660 kcal
  // 4) eggs (380) + chicken (720) + tuna (560) + yogurt (250) = 1910 kcal
  //
  // Objetivo: 1950 kcal con ±5% -> rango [1852.5, 2047.5]
  // Deben entrar únicamente:
  // - #1: 1980 kcal (desviación 30)
  // - #2: 1910 kcal (desviación 40)
  const candidates = findDailyMealPlanCandidates(SAMPLE_RECIPES, 1950, 0.05);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].totalCalories, 1980);
  assert.equal(candidates[0].deviationCalories, 30);
  assert.equal(candidates[0].meals.breakfast.id, 'rec-oats');
  assert.equal(candidates[0].meals.lunch.id, 'rec-chicken-rice');
  assert.equal(candidates[0].meals.dinner.id, 'rec-tuna-salad');
  assert.equal(candidates[0].meals.snack.id, 'rec-yogurt');

  assert.equal(candidates[1].totalCalories, 1910);
  assert.equal(candidates[1].deviationCalories, 40);
  assert.equal(candidates[1].meals.breakfast.id, 'rec-eggs');

  // Verificar integridad estricta de ingredientes (cero ingredientes inventados)
  const knownItemIds = new Set(
    SAMPLE_RECIPES.flatMap((r) => r.ingredients.map((i) => i.itemId))
  );
  for (const candidate of candidates) {
    for (const recipe of candidate.recipes) {
      for (const ing of recipe.ingredients) {
        assert.ok(knownItemIds.has(ing.itemId), `Ingrediente desconocido detectado: ${ing.itemId}`);
      }
    }
  }

  // Cuando ninguna combinación cae dentro del margen, devuelve lista vacía
  const emptyCandidates = findDailyMealPlanCandidates(SAMPLE_RECIPES, 3500, 0.05);
  assert.deepEqual(emptyCandidates, []);
});
