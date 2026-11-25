import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { normalizeUnit, validatePositiveQuantity } from '../inventory/units.js';

export const RECIPE_CATEGORIES = Object.freeze(['breakfast', 'lunch', 'dinner', 'snack']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

export function validateRecipeMacros(macros) {
  if (macros === undefined || macros === null) {
    return { proteinGrams: 0, carbsGrams: 0, fatGrams: 0 };
  }
  if (!isPlainObject(macros)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'macros debe ser un objeto válido.', {
      field: 'macros',
    });
  }

  const normalized = {};
  for (const key of ['proteinGrams', 'carbsGrams', 'fatGrams']) {
    const raw = macros[key];
    if (raw === undefined || raw === null) {
      normalized[key] = 0;
      continue;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `macros.${key} debe ser un número finito mayor o igual a 0.`,
        { field: `macros.${key}` }
      );
    }
    normalized[key] = round2(parsed);
  }

  return normalized;
}

export function validateRecipeIngredient(ingredient, index = 0) {
  if (!isPlainObject(ingredient)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `ingredients[${index}] debe ser un objeto válido.`,
      { field: `ingredients[${index}]` }
    );
  }

  if (typeof ingredient.itemId !== 'string' || !ingredient.itemId.trim()) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `ingredients[${index}].itemId es obligatorio.`,
      { field: `ingredients[${index}].itemId` }
    );
  }

  if (typeof ingredient.itemName !== 'string' || !ingredient.itemName.trim()) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `ingredients[${index}].itemName es obligatorio.`,
      { field: `ingredients[${index}].itemName` }
    );
  }

  const requiredQuantity = validatePositiveQuantity(
    ingredient.requiredQuantity,
    `ingredients[${index}].requiredQuantity`
  );
  const unit = normalizeUnit(ingredient.unit);

  return {
    itemId: ingredient.itemId.trim(),
    itemName: ingredient.itemName.trim(),
    requiredQuantity,
    unit,
  };
}

export function validateRecipe(recipe) {
  if (!isPlainObject(recipe)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'La receta debe ser un objeto válido.');
  }

  if (typeof recipe.id !== 'string' || !recipe.id.trim()) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'id es obligatorio en Recipe.', {
      field: 'id',
    });
  }

  if (typeof recipe.name !== 'string' || !recipe.name.trim()) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'name es obligatorio en Recipe.', {
      field: 'name',
    });
  }

  const category = typeof recipe.category === 'string' ? recipe.category.trim().toLowerCase() : '';
  if (!RECIPE_CATEGORIES.includes(category)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      `category inválida en Recipe: ${recipe.category}. Permitidas: ${RECIPE_CATEGORIES.join(', ')}.`,
      { field: 'category' }
    );
  }

  let prepTimeMinutes = 0;
  if (recipe.prepTimeMinutes !== undefined && recipe.prepTimeMinutes !== null) {
    const parsedPrep = Number(recipe.prepTimeMinutes);
    if (!Number.isFinite(parsedPrep) || parsedPrep < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        'prepTimeMinutes debe ser un número finito mayor o igual a 0.',
        { field: 'prepTimeMinutes' }
      );
    }
    prepTimeMinutes = round2(parsedPrep);
  }

  const servings =
    recipe.servings === undefined || recipe.servings === null
      ? 1
      : validatePositiveQuantity(recipe.servings, 'servings');

  const caloriesPerServing = validatePositiveQuantity(
    recipe.caloriesPerServing,
    'caloriesPerServing'
  );

  const macros = validateRecipeMacros(recipe.macros);

  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'ingredients debe ser un arreglo con al menos un ingrediente.',
      { field: 'ingredients' }
    );
  }

  const ingredients = recipe.ingredients.map((ing, idx) => validateRecipeIngredient(ing, idx));

  return {
    id: recipe.id.trim(),
    name: recipe.name.trim(),
    category,
    prepTimeMinutes,
    servings,
    caloriesPerServing: round2(caloriesPerServing),
    macros,
    ingredients,
  };
}

export function normalizeRecipe(recipe) {
  return validateRecipe(recipe);
}
