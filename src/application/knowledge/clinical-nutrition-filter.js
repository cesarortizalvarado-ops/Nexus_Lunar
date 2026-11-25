export function evaluateRecipeClinicalSuitability(recipe, clinicalAlerts = {}) {
  if (!recipe || !recipe.macros) throw new Error('INVALID_RECIPE: Receta con macros requerida.');

  const violations = [];

  // Regla Clínica: Si hay triglicéridos altos (>149 mg/dL), penalizar recetas con carbohidratos muy altos (>60g/porción)
  if (clinicalAlerts.triglyceridesHigh && recipe.macros.carbsGrams > 60) {
    violations.push({
      biomarker: 'triglycerides',
      severity: 'WARNING',
      reason: `Carbohidratos elevados (${recipe.macros.carbsGrams}g) desaconsejados para triglicéridos altos.`,
    });
  }

  // Regla Clínica: Si hay colesterol LDL alto (>99 mg/dL), penalizar recetas altas en grasas (>25g/porción)
  if (clinicalAlerts.ldlHigh && recipe.macros.fatGrams > 25) {
    violations.push({
      biomarker: 'ldlCholesterol',
      severity: 'WARNING',
      reason: `Contenido de grasa (${recipe.macros.fatGrams}g) excede el umbral para manejo de colesterol LDL.`,
    });
  }

  // Regla Clínica: Si hay glucosa en ayunas alta (>99 mg/dL), exigir mínimo de proteína y limitar carbos
  if (clinicalAlerts.glucoseHigh && recipe.macros.carbsGrams > 50) {
    violations.push({
      biomarker: 'fastingGlucose',
      severity: 'WARNING',
      reason: `Carga de carbohidratos (${recipe.macros.carbsGrams}g) no óptima para control glucémico.`,
    });
  }

  return {
    suitable: violations.length === 0,
    recipeId: recipe.id,
    recipeName: recipe.name,
    violations,
  };
}

export function filterRecipesByClinicalContext(recipes, clinicalPanelResult) {
  if (!Array.isArray(recipes)) return [];
  if (!clinicalPanelResult || !clinicalPanelResult.hasAlerts) {
    return recipes.map((r) => ({ recipe: r, suitable: true, violations: [] }));
  }

  const alerts = {};
  for (const ev of clinicalPanelResult.evaluations || []) {
    if (ev.marker === 'triglycerides' && ev.status === 'high') alerts.triglyceridesHigh = true;
    if (ev.marker === 'ldlCholesterol' && ev.status === 'high') alerts.ldlHigh = true;
    if (ev.marker === 'fastingGlucose' && ev.status === 'high') alerts.glucoseHigh = true;
  }

  return recipes.map((recipe) => {
    const evaluation = evaluateRecipeClinicalSuitability(recipe, alerts);
    return {
      recipe,
      suitable: evaluation.suitable,
      violations: evaluation.violations,
    };
  });
}
