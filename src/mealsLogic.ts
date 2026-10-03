// Pure helpers for the Recipes library and the Meals planner, mirroring web's handlers/helpers in app.js (recipeForm submit,
// delete-recipe, plan/clear/remove meal slot, mealNutritionTotals, groceryListByAisle, recipesFilteredSorted).
// Each returns new data without mutating its input so callers can hand the result to the whole-state save.
// Types only are imported - see the logic-file import rule.
import type { PlannedMeal, Recipe } from "./types";

export type RecipeInput = { name: string; ingredients: string; calories: string | number; protein: string | number };

export function parseIngredients(text: string): string[] {
  return String(text || "").split(",").map((item) => item.trim()).filter(Boolean);
}

// Recipe names are unique case-insensitively (web silently ignores a duplicate; here the caller gets a reason to show).
export function validateRecipe(recipes: Recipe[], input: RecipeInput, editingId: string | null): string | null {
  const name = input.name.trim();
  if (!name) return "Enter a recipe name.";
  if (!parseIngredients(input.ingredients).length) return "Add at least one ingredient, separated by commas.";
  if (recipes.some((recipe) => recipe.id !== editingId && recipe.name.toLowerCase() === name.toLowerCase())) return "A recipe with that name already exists.";
  return null;
}

// Adds a recipe, or (editingId set) updates it and renames any planned meal that uses it, like web.
export function saveRecipe(recipes: Recipe[], plannedWeek: PlannedMeal[], input: RecipeInput, editingId: string | null, createId: () => string): { recipes: Recipe[]; plannedWeek: PlannedMeal[] } {
  const fields = { name: input.name.trim(), ingredients: parseIngredients(input.ingredients), calories: Number(input.calories || 0), protein: Number(input.protein || 0) };
  if (editingId && recipes.some((recipe) => recipe.id === editingId)) {
    return {
      recipes: recipes.map((recipe) => recipe.id === editingId ? { ...recipe, ...fields } : recipe),
      plannedWeek: plannedWeek.map((planned) => planned.recipeId === editingId ? { ...planned, meal: fields.name } : planned)
    };
  }
  return { recipes: [...recipes, { id: createId(), ...fields }], plannedWeek };
}

// Planned meals keep their name but lose the link, as web's delete confirmation promises.
export function deleteRecipe(recipes: Recipe[], plannedWeek: PlannedMeal[], recipeId: string): { recipes: Recipe[]; plannedWeek: PlannedMeal[] } {
  return {
    recipes: recipes.filter((recipe) => recipe.id !== recipeId),
    plannedWeek: plannedWeek.map((planned) => planned.recipeId === recipeId ? { ...planned, recipeId: "" } : planned)
  };
}

export type RecipeSort = "name" | "protein" | "calories";
export type RecipeFilter = "all" | "planned" | "unplanned";

export function recipesFilteredSorted(recipes: Recipe[], plannedRecipeIds: Set<string>, query: string, filter: RecipeFilter, sortBy: RecipeSort): Recipe[] {
  const needle = query.trim().toLowerCase();
  const sorters: Record<RecipeSort, (a: Recipe, b: Recipe) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    protein: (a, b) => Number(b.protein || 0) - Number(a.protein || 0),
    calories: (a, b) => Number(b.calories || 0) - Number(a.calories || 0)
  };
  return recipes
    .filter((recipe) => {
      if (filter === "planned" && !plannedRecipeIds.has(recipe.id)) return false;
      if (filter === "unplanned" && plannedRecipeIds.has(recipe.id)) return false;
      if (!needle) return true;
      return recipe.name.toLowerCase().includes(needle) || recipe.ingredients.some((ingredient) => ingredient.toLowerCase().includes(needle));
    })
    .sort(sorters[sortBy] || sorters.name);
}

export function plannedRecipeIds(weekMeals: PlannedMeal[]): Set<string> {
  return new Set(weekMeals.map((planned) => planned.recipeId).filter((id): id is string => Boolean(id)));
}

// ---- meal plan slots (web allows ONE meal per day+slot; a missing slot means Dinner) ----

export function mealInSlot(weekMeals: PlannedMeal[], day: string, slot: string): PlannedMeal | undefined {
  return weekMeals.find((planned) => planned.day === day && (planned.slot === slot || (!planned.slot && slot === "Dinner")));
}

export type SlotPlan = { month: string; week: number; day: string; slot: string; mealName: string; recipeId: string; servings: number };

// Plans a meal into a slot, replacing whatever is already there (web's Plan/Update button).
export function planMealSlot(plannedWeek: PlannedMeal[], plan: SlotPlan): PlannedMeal[] {
  const entry: PlannedMeal = { month: plan.month, week: plan.week, day: plan.day, slot: plan.slot, meal: plan.mealName, recipeId: plan.recipeId, servings: Math.max(1, Number(plan.servings) || 3) };
  const inWeek = (planned: PlannedMeal) => (!planned.month || planned.month === plan.month) && Number(planned.week || 1) === plan.week;
  const existing = plannedWeek.findIndex((planned) => inWeek(planned) && planned.day === plan.day && (planned.slot === plan.slot || (!planned.slot && plan.slot === "Dinner")));
  if (existing >= 0) return plannedWeek.map((planned, index) => index === existing ? entry : planned);
  return [...plannedWeek, entry];
}

export function clearMealSlot(plannedWeek: PlannedMeal[], month: string, week: number, day: string, slot: string): PlannedMeal[] {
  const inWeek = (planned: PlannedMeal) => (!planned.month || planned.month === month) && Number(planned.week || 1) === week;
  const index = plannedWeek.findIndex((planned) => inWeek(planned) && planned.day === day && (planned.slot === slot || (!planned.slot && slot === "Dinner")));
  return index < 0 ? plannedWeek : plannedWeek.filter((_, itemIndex) => itemIndex !== index);
}

// ---- nutrition and grocery list ----

// Recipe calories/protein are per serving; multiply by the planned servings and average over the 7 days (web's mealNutritionTotals).
export function mealNutritionTotals(weekMeals: PlannedMeal[], recipes: Recipe[]): { calories: number; protein: number } {
  const totals = weekMeals.reduce((acc, planned) => {
    const recipe = recipes.find((item) => item.id === planned.recipeId);
    if (!recipe) return acc;
    const servings = Number(planned.servings || 1);
    return { calories: acc.calories + Number(recipe.calories || 0) * servings, protein: acc.protein + Number(recipe.protein || 0) * servings };
  }, { calories: 0, protein: 0 });
  return { calories: Math.round(totals.calories / 7), protein: Math.round(totals.protein / 7) };
}

const GROCERY_AISLE_KEYWORDS: Array<[RegExp, string]> = [
  [/lettuce|spinach|kale|tomato|onion|garlic|pepper|carrot|potato|broccoli|cucumber|avocado|mushroom|fruit|apple|banana|berr|lemon|lime|herb|cilantro|basil|parsley|produce|vegetable/i, "Produce"],
  [/chicken|beef|pork|turkey|fish|salmon|shrimp|tofu|\begg/i, "Protein"],
  [/milk|cheese|yogurt|butter|cream|dairy/i, "Dairy"],
  [/rice|pasta|flour|sugar|oil|vinegar|sauce|spice|bread|cereal|noodle|bean|lentil|broth|stock/i, "Pantry"]
];
const AISLE_ORDER = ["Produce", "Protein", "Dairy", "Pantry", "Other"];

export function groceryAisleFor(ingredient: string): string {
  const match = GROCERY_AISLE_KEYWORDS.find(([pattern]) => pattern.test(ingredient));
  return match ? match[1] : "Other";
}

// "How many of this week's planned meals need it" stands in for a quantity, exactly as web does.
export function groceryListByAisle(weekMeals: PlannedMeal[], recipes: Recipe[]): Array<{ aisle: string; items: Array<{ ingredient: string; count: number }> }> {
  const counts = new Map<string, number>();
  for (const planned of weekMeals) {
    for (const ingredient of recipes.find((recipe) => recipe.id === planned.recipeId)?.ingredients || []) counts.set(ingredient, (counts.get(ingredient) || 0) + 1);
  }
  const groups = new Map<string, Array<{ ingredient: string; count: number }>>();
  counts.forEach((count, ingredient) => {
    const aisle = groceryAisleFor(ingredient);
    groups.set(aisle, [...(groups.get(aisle) || []), { ingredient, count }]);
  });
  return AISLE_ORDER.filter((aisle) => groups.has(aisle)).map((aisle) => ({ aisle, items: (groups.get(aisle) || []).sort((a, b) => a.ingredient.localeCompare(b.ingredient)) }));
}
