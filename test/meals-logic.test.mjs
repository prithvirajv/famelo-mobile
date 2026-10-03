import assert from "node:assert/strict";
import test from "node:test";
import {
  parseIngredients, validateRecipe, saveRecipe, deleteRecipe, recipesFilteredSorted, plannedRecipeIds, mealInSlot, planMealSlot, clearMealSlot,
  mealNutritionTotals, groceryAisleFor, groceryListByAisle
} from "../src/mealsLogic.ts";

const recipe = (overrides = {}) => ({ id: "r1", name: "Veg curry", ingredients: ["onion", "lentils"], calories: 400, protein: 20, ...overrides });
const meal = (overrides = {}) => ({ month: "2026-07", week: 1, day: "Monday", slot: "Dinner", meal: "Veg curry", recipeId: "r1", servings: 2, ...overrides });

test("parseIngredients splits on commas and drops blanks", () => {
  assert.deepEqual(parseIngredients(" onion , ,tomato,lentils "), ["onion", "tomato", "lentils"]);
  assert.deepEqual(parseIngredients(""), []);
});

test("validateRecipe needs a name and ingredients and rejects a case-insensitive duplicate (except the one being edited)", () => {
  const recipes = [recipe()];
  assert.match(validateRecipe(recipes, { name: " ", ingredients: "a", calories: 1, protein: 1 }, null), /name/);
  assert.match(validateRecipe(recipes, { name: "x", ingredients: " , ", calories: 1, protein: 1 }, null), /ingredient/);
  assert.match(validateRecipe(recipes, { name: "VEG CURRY", ingredients: "a", calories: 1, protein: 1 }, null), /already exists/);
  assert.equal(validateRecipe(recipes, { name: "VEG CURRY", ingredients: "a", calories: 1, protein: 1 }, "r1"), null);
});

test("saveRecipe adds with a fresh id, or edits and renames the planned meals that use it, without mutating inputs", () => {
  const recipes = [recipe()]; const planned = [meal(), meal({ day: "Tuesday", meal: "Pizza", recipeId: "other" })];
  const added = saveRecipe(recipes, planned, { name: " Pasta ", ingredients: "pasta, sauce", calories: "500", protein: "18" }, null, () => "r2");
  assert.deepEqual(added.recipes[1], { id: "r2", name: "Pasta", ingredients: ["pasta", "sauce"], calories: 500, protein: 18 });
  assert.equal(recipes.length, 1);
  const edited = saveRecipe(recipes, planned, { name: "Green curry", ingredients: "basil", calories: 300, protein: 10 }, "r1", () => "unused");
  assert.equal(edited.recipes[0].name, "Green curry");
  assert.deepEqual(edited.plannedWeek.map((item) => item.meal), ["Green curry", "Pizza"]);
  assert.equal(planned[0].meal, "Veg curry");
});

test("deleteRecipe keeps planned meals' names but drops the link", () => {
  const result = deleteRecipe([recipe(), recipe({ id: "r2", name: "B" })], [meal(), meal({ recipeId: "r2", meal: "B", day: "Friday" })], "r1");
  assert.deepEqual(result.recipes.map((item) => item.id), ["r2"]);
  assert.deepEqual(result.plannedWeek.map((item) => [item.meal, item.recipeId]), [["Veg curry", ""], ["B", "r2"]]);
});

test("recipesFilteredSorted searches names and ingredients, filters by planned, and sorts", () => {
  const recipes = [recipe({ id: "a", name: "Zucchini bake", protein: 5, calories: 900 }), recipe({ id: "b", name: "Apple pie", ingredients: ["apple"], protein: 30, calories: 300 })];
  const planned = new Set(["a"]);
  assert.deepEqual(recipesFilteredSorted(recipes, planned, "", "all", "name").map((r) => r.id), ["b", "a"]);
  assert.deepEqual(recipesFilteredSorted(recipes, planned, "", "all", "protein").map((r) => r.id), ["b", "a"]);
  assert.deepEqual(recipesFilteredSorted(recipes, planned, "", "all", "calories").map((r) => r.id), ["a", "b"]);
  assert.deepEqual(recipesFilteredSorted(recipes, planned, "APPLE", "all", "name").map((r) => r.id), ["b"], "matches an ingredient too");
  assert.deepEqual(recipesFilteredSorted(recipes, planned, "", "planned", "name").map((r) => r.id), ["a"]);
  assert.deepEqual(recipesFilteredSorted(recipes, planned, "", "unplanned", "name").map((r) => r.id), ["b"]);
  assert.deepEqual([...plannedRecipeIds([meal(), meal({ recipeId: "" })])], ["r1"]);
});

test("a planned meal with no slot counts as Dinner, and planning a slot replaces that slot's meal only", () => {
  const legacy = { day: "Monday", meal: "Old", servings: 3 };
  assert.equal(mealInSlot([legacy], "Monday", "Dinner")?.meal, "Old");
  assert.equal(mealInSlot([legacy], "Monday", "Lunch"), undefined);
  const base = { month: "2026-07", week: 1, day: "Monday", slot: "Dinner", mealName: "New", recipeId: "r1", servings: 4 };
  const replaced = planMealSlot([legacy, meal({ day: "Tuesday" })], base);
  assert.equal(replaced.length, 2);
  assert.equal(replaced[0].meal, "New");
  assert.equal(replaced[1].day, "Tuesday");
  assert.equal(planMealSlot(replaced, { ...base, slot: "Lunch" }).length, 3);
  assert.equal(planMealSlot([], { ...base, servings: 0 })[0].servings, 3, "bad servings fall back to 3");
  assert.equal(planMealSlot([meal({ week: 2 })], base).length, 2, "the same slot in another week is separate");
});

test("clearMealSlot removes only that week's slot", () => {
  const plannedWeek = [meal(), meal({ week: 2 }), meal({ slot: "Lunch" })];
  const cleared = clearMealSlot(plannedWeek, "2026-07", 1, "Monday", "Dinner");
  assert.deepEqual(cleared.map((item) => [item.week, item.slot]), [[2, "Dinner"], [1, "Lunch"]]);
  assert.equal(clearMealSlot(plannedWeek, "2026-07", 1, "Sunday", "Dinner"), plannedWeek);
});

test("mealNutritionTotals averages per-serving nutrition over seven days and ignores unlinked meals", () => {
  const totals = mealNutritionTotals([meal({ servings: 2 }), meal({ day: "Tuesday", servings: 3 }), meal({ day: "Friday", recipeId: "", servings: 9 })], [recipe({ calories: 700, protein: 35 })]);
  assert.deepEqual(totals, { calories: 500, protein: 25 });
  assert.deepEqual(mealNutritionTotals([], []), { calories: 0, protein: 0 });
});

test("grocery list groups by keyword aisle in a fixed order and counts how many planned meals need each ingredient", () => {
  assert.equal(groceryAisleFor("Cherry Tomato"), "Produce");
  assert.equal(groceryAisleFor("egg"), "Protein");
  assert.equal(groceryAisleFor("mystery"), "Other");
  const recipes = [recipe({ ingredients: ["rice", "onion", "saffron"] }), recipe({ id: "r2", ingredients: ["onion", "milk"] })];
  const groups = groceryListByAisle([meal(), meal({ recipeId: "r2", day: "Friday" }), meal({ recipeId: "r2", day: "Sunday" })], recipes);
  assert.deepEqual(groups.map((group) => group.aisle), ["Produce", "Dairy", "Pantry", "Other"]);
  assert.deepEqual(groups[0].items, [{ ingredient: "onion", count: 3 }]);
});
