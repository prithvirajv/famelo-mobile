import type { NoteItem, HouseholdState, PlannedMeal, Recipe } from "./types";

export function applyChecklistToggle(checklist: NoteItem[], itemId: string, done: boolean): NoteItem[] {
  const next = checklist.map((item) => (item.id === itemId ? { ...item, done } : { ...item }));
  const target = next.find((item) => item.id === itemId);
  if (!target) return next;
  const children = next.filter((item) => item.parentId === itemId);
  children.forEach((child) => { child.done = done; });
  if (target.parentId) {
    const parent = next.find((item) => item.id === target.parentId);
    if (parent) {
      const siblings = next.filter((item) => item.parentId === target.parentId);
      parent.done = siblings.length > 0 && siblings.every((item) => item.done);
    }
  }
  return next;
}

const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function firstWeekDayDates(monthValue: HouseholdState["budget"]["month"]): Array<{ day: string; date: Date }> {
  const parts = monthValue.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? new Date().getMonth() + 1;
  const firstDay = new Date(year, month - 1, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const firstMonday = new Date(firstDay);
  firstMonday.setDate(firstDay.getDate() - mondayOffset);
  return WEEK_DAYS.map((day, index) => {
    const date = new Date(firstMonday);
    date.setDate(firstMonday.getDate() + index);
    return { day, date };
  });
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function groceryListFor(plannedMeals: PlannedMeal[], recipes: Recipe[]): string[] {
  return [...new Set(plannedMeals.flatMap((planned) => recipes.find((recipe) => recipe.id === planned.recipeId)?.ingredients || []))];
}

// Recipes don't carry per-ingredient prices, so this is a rough per-item
// average rather than exact pricing — but it scales with what's actually
// planned instead of a fixed guess regardless of the meal plan. Matches the
// same per-item constant used by the web app for consistency.
const GROCERY_ITEM_ESTIMATE = 7;

export function groceryEstimateAmount(plannedMeals: PlannedMeal[], recipes: Recipe[]): number {
  return groceryListFor(plannedMeals, recipes).length * GROCERY_ITEM_ESTIMATE;
}
