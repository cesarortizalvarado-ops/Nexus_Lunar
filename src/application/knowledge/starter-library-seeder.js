import { validateRecipe } from '../../domain/knowledge/recipe-contract.js';
import {
  STARTER_LIBRARY_NAME,
  STARTER_PANTRY_PRODUCTS,
  STARTER_RECIPES,
} from '../../domain/knowledge/starter-catalog-data.js';

export function createStarterLibrarySeeder({
  productService,
  libraryService,
  knowledgeDocumentService,
}) {
  if (!productService || !libraryService || !knowledgeDocumentService) {
    throw new Error('STARTER_SEEDER_DEPS_REQUIRED: Se requieren productService, libraryService y knowledgeDocumentService.');
  }

  function seedStarterLibraries() {
    const existingProducts = productService.listProducts({}) || [];
    const productsByName = new Map(
      existingProducts.map((p) => [String(p.name || '').trim().toLowerCase(), p])
    );

    const productMap = new Map();
    let productsCreated = 0;
    let productsExisting = 0;

    for (const item of STARTER_PANTRY_PRODUCTS) {
      const keyName = item.name.trim().toLowerCase();
      let prod = productsByName.get(keyName);
      if (prod) {
        productsExisting += 1;
      } else {
        prod = productService.createProduct({
          name: item.name,
          unit: item.unit,
          reference_price: item.unitCostMxn,
          currency: 'MXN',
          category: 'despensa',
          description: 'Ingrediente base del catálogo inicial Nexus Lunar (MX)',
        });
        productsByName.set(keyName, prod);
        productsCreated += 1;
      }
      productMap.set(item.key, {
        id: prod.id,
        name: prod.name,
        unit: prod.unit,
      });
    }

    const existingLibraries = libraryService.listLibraries({}) || [];
    let library = existingLibraries.find(
      (lib) => String(lib.name || '').trim().toLowerCase() === STARTER_LIBRARY_NAME.toLowerCase()
    );
    if (!library) {
      library = libraryService.createLibrary({
        name: STARTER_LIBRARY_NAME,
        description: 'Biblioteca semilla con 15 recetas saludables y costos en MXN.',
        category: 'nutrition',
      });
    }

    const existingDocs = knowledgeDocumentService.searchDocuments({
      library_id: library.id,
      status: null,
      limit: 500,
    }) || [];

    const existingTitles = new Set(
      existingDocs.map((d) => String(d.title || '').trim().toLowerCase())
    );
    const existingRecipeIds = new Set(
      existingDocs
        .map((d) => d.metadata?.recipe?.id)
        .filter(Boolean)
    );

    let recipesCreated = 0;
    let recipesExisting = 0;

    for (const recipeDef of STARTER_RECIPES) {
      const resolvedIngredients = recipeDef.ingredients.map((ing) => {
        const prod = productMap.get(ing.productKey);
        if (!prod) {
          throw new Error(`STARTER_PRODUCT_MISSING: Clave de producto no encontrada (${ing.productKey}).`);
        }
        return {
          itemId: prod.id,
          itemName: prod.name,
          requiredQuantity: ing.requiredQuantity,
          unit: ing.unit,
        };
      });

      const resolvedRecipe = validateRecipe({
        id: recipeDef.id,
        name: recipeDef.name,
        category: recipeDef.category,
        prepTimeMinutes: recipeDef.prepTimeMinutes,
        servings: recipeDef.servings,
        caloriesPerServing: recipeDef.caloriesPerServing,
        macros: recipeDef.macros,
        ingredients: resolvedIngredients,
      });

      const alreadyExists =
        existingRecipeIds.has(resolvedRecipe.id) ||
        existingTitles.has(resolvedRecipe.name.toLowerCase());

      if (alreadyExists) {
        recipesExisting += 1;
        continue;
      }

      knowledgeDocumentService.createDocument({
        library_id: library.id,
        title: resolvedRecipe.name,
        description: `Receta ${resolvedRecipe.category} · ${resolvedRecipe.caloriesPerServing} kcal`,
        document_type: 'JSON',
        content: JSON.stringify(resolvedRecipe),
        metadata: {
          recipe: resolvedRecipe,
          starter: true,
        },
      });

      existingRecipeIds.add(resolvedRecipe.id);
      existingTitles.add(resolvedRecipe.name.toLowerCase());
      recipesCreated += 1;
    }

    return {
      libraryId: library.id,
      productsCreated,
      productsExisting,
      recipesCreated,
      recipesExisting,
      totalStarterRecipes: STARTER_RECIPES.length,
    };
  }

  return {
    seedStarterLibraries,
  };
}
