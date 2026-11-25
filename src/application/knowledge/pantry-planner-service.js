import { evaluateRecipeCost } from './recipe-cost-evaluator.js';

export function planWeeklyPantryAndBudget({
  weeklyMenuRecipes,
  currentInventory,
  weeklyGroceryBudget,
}) {
  if (!Array.isArray(weeklyMenuRecipes)) {
    throw new Error('INVALID_WEEKLY_MENU: Array de recetas requerido.');
  }
  if (typeof weeklyGroceryBudget !== 'number' || Number.isNaN(weeklyGroceryBudget) || weeklyGroceryBudget < 0) {
    throw new Error('INVALID_BUDGET: Presupuesto de despensa inválido.');
  }

  // Costeo determinista consolidado
  const costReport = evaluateRecipeCost(weeklyMenuRecipes, currentInventory);

  const budgetSurplus = Number((weeklyGroceryBudget - costReport.estimatedTotalCost).toFixed(2));
  const isWithinBudget = budgetSurplus >= 0;
  const deficit = Number(Math.abs(budgetSurplus).toFixed(2));

  return {
    isWithinBudget,
    weeklyGroceryBudget,
    estimatedTotalCost: costReport.estimatedTotalCost,
    budgetSurplus,
    pantryCoverage: costReport.pantryCoverage,
    ingredientsNeeded: costReport.ingredientsNeeded,
    shoppingList: costReport.shoppingList,
    itemsWithoutPrice: costReport.itemsWithoutPrice,
    budgetAlert: !isWithinBudget
      ? {
          severity: 'HIGH',
          message: `El menú semanal supera el presupuesto de despensa por $${deficit}.`,
          deficit,
        }
      : null,
  };
}
