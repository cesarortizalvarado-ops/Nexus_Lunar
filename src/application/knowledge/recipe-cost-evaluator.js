import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { normalizeRecipe } from '../../domain/knowledge/recipe-contract.js';
import { assertCompatibleUnit, normalizeUnit } from '../../domain/inventory/units.js';

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}

function buildInventoryMap(currentInventory = []) {
  if (currentInventory !== null && currentInventory !== undefined && !Array.isArray(currentInventory)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'currentInventory debe ser un arreglo de ítems de inventario.',
      { field: 'currentInventory' }
    );
  }

  const map = new Map();
  for (let index = 0; index < (currentInventory ?? []).length; index += 1) {
    const item = currentInventory[index];
    if (!item || typeof item !== 'object') continue;

    const rawId = item.itemId ?? item.id;
    if (typeof rawId !== 'string' || !rawId.trim()) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `currentInventory[${index}].itemId es obligatorio.`,
        { field: `currentInventory[${index}].itemId` }
      );
    }
    const itemId = rawId.trim();

    const rawAvailable = item.availableQuantity ?? item.quantity ?? 0;
    const availableQuantity = Number(rawAvailable);
    if (!Number.isFinite(availableQuantity) || availableQuantity < 0) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `currentInventory[${index}].availableQuantity debe ser un número finito mayor o igual a 0.`,
        { field: `currentInventory[${index}].availableQuantity` }
      );
    }

    const rawUnit = item.unit !== undefined && item.unit !== null ? normalizeUnit(item.unit) : null;

    const rawCost = item.unitCost ?? item.unitPrice ?? item.price ?? null;
    let unitCost = null;
    if (rawCost !== null && rawCost !== undefined) {
      const parsedCost = Number(rawCost);
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        throw new NexusError(
          ERROR_CODES.VALIDATION_ERROR,
          `currentInventory[${index}].unitCost debe ser un número finito mayor o igual a 0.`,
          { field: `currentInventory[${index}].unitCost` }
        );
      }
      unitCost = parsedCost;
    }

    const existing = map.get(itemId);
    if (existing) {
      if (existing.unit && rawUnit) {
        assertCompatibleUnit(existing.unit, rawUnit);
      }
      existing.availableQuantity = round6(existing.availableQuantity + availableQuantity);
      if (existing.unit === null && rawUnit !== null) existing.unit = rawUnit;
      if (unitCost !== null) existing.unitCost = unitCost;
    } else {
      map.set(itemId, {
        itemId,
        itemName: typeof (item.itemName ?? item.name) === 'string' ? (item.itemName ?? item.name).trim() : null,
        availableQuantity: round6(availableQuantity),
        unit: rawUnit,
        unitCost,
      });
    }
  }

  return map;
}

export function evaluateRecipeCost(recipes = [], currentInventory = []) {
  if (!Array.isArray(recipes)) {
    throw new NexusError(
      ERROR_CODES.VALIDATION_ERROR,
      'recipes debe ser un arreglo de recetas.',
      { field: 'recipes' }
    );
  }

  const normalizedRecipes = recipes.map((recipe) => normalizeRecipe(recipe));
  const inventoryMap = buildInventoryMap(currentInventory);

  const consolidatedMap = new Map();
  for (const recipe of normalizedRecipes) {
    for (const ingredient of recipe.ingredients) {
      const existing = consolidatedMap.get(ingredient.itemId);
      if (existing) {
        assertCompatibleUnit(existing.unit, ingredient.unit);
        existing.requiredQuantity = round6(existing.requiredQuantity + ingredient.requiredQuantity);
      } else {
        consolidatedMap.set(ingredient.itemId, {
          itemId: ingredient.itemId,
          itemName: ingredient.itemName,
          requiredQuantity: round6(ingredient.requiredQuantity),
          unit: ingredient.unit,
        });
      }
    }
  }

  const ingredientsNeeded = [...consolidatedMap.values()].sort((a, b) =>
    a.itemId.localeCompare(b.itemId)
  );

  const coverageItems = [];
  const shoppingList = [];
  const itemsWithoutPrice = [];

  let fullyCoveredCount = 0;
  let partiallyCoveredCount = 0;
  let uncoveredCount = 0;
  let ratioAccumulator = 0;
  let estimatedTotalCostRaw = 0;

  for (const needed of ingredientsNeeded) {
    const stock = inventoryMap.get(needed.itemId) ?? null;
    if (stock?.unit) {
      assertCompatibleUnit(needed.unit, stock.unit);
    }

    const availableQuantity = stock ? stock.availableQuantity : 0;
    const coveredQuantity = round6(Math.min(needed.requiredQuantity, availableQuantity));
    const missingQuantity = round6(Math.max(0, needed.requiredQuantity - availableQuantity));
    const coverageRatio =
      needed.requiredQuantity > 0 ? coveredQuantity / needed.requiredQuantity : 1;
    const fullyCovered = missingQuantity === 0;

    ratioAccumulator += coverageRatio;

    if (fullyCovered) {
      fullyCoveredCount += 1;
    } else if (coveredQuantity > 0) {
      partiallyCoveredCount += 1;
    } else {
      uncoveredCount += 1;
    }

    coverageItems.push({
      itemId: needed.itemId,
      itemName: needed.itemName,
      requiredQuantity: needed.requiredQuantity,
      availableQuantity,
      coveredQuantity,
      missingQuantity,
      unit: needed.unit,
      coveragePercentage: round2(coverageRatio * 100),
      fullyCovered,
    });

    if (missingQuantity > 0) {
      const unitCost = stock?.unitCost ?? null;
      const estimatedCost = unitCost !== null ? round2(missingQuantity * unitCost) : null;
      if (estimatedCost !== null) {
        estimatedTotalCostRaw += estimatedCost;
      } else {
        itemsWithoutPrice.push(needed.itemId);
      }

      shoppingList.push({
        itemId: needed.itemId,
        itemName: needed.itemName,
        quantityToBuy: missingQuantity,
        unit: needed.unit,
        unitCost,
        estimatedCost,
      });
    }
  }

  const totalIngredientsCount = ingredientsNeeded.length;
  const coveragePercentage =
    totalIngredientsCount > 0 ? round2((ratioAccumulator / totalIngredientsCount) * 100) : 100;

  return {
    recipesEvaluatedCount: normalizedRecipes.length,
    ingredientsNeeded,
    pantryCoverage: {
      coveragePercentage,
      totalIngredientsCount,
      fullyCoveredCount,
      partiallyCoveredCount,
      uncoveredCount,
      items: coverageItems,
    },
    shoppingList,
    estimatedTotalCost: round2(estimatedTotalCostRaw),
    itemsWithoutPrice,
  };
}

export class RecipeCostEvaluator {
  constructor(firstArg = [], secondArg = undefined) {
    if (
      firstArg &&
      typeof firstArg === 'object' &&
      !Array.isArray(firstArg) &&
      ('recipes' in firstArg || 'currentInventory' in firstArg)
    ) {
      this.defaultRecipes = firstArg.recipes ?? [];
      this.defaultInventory = firstArg.currentInventory ?? [];
    } else if (Array.isArray(firstArg) && Array.isArray(secondArg)) {
      this.defaultRecipes = firstArg;
      this.defaultInventory = secondArg;
    } else if (Array.isArray(firstArg)) {
      this.defaultRecipes = [];
      this.defaultInventory = firstArg;
    } else {
      this.defaultRecipes = [];
      this.defaultInventory = [];
    }
  }

  evaluate(recipes = this.defaultRecipes, currentInventory = this.defaultInventory) {
    return evaluateRecipeCost(recipes, currentInventory);
  }
}
