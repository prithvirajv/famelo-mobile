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

const recurringBudgetFrequencyMonths = {
  monthly: 1,
  quarterly: 3,
  yearly: 12
};

function dateKeyToMonthKey(value: string): string {
  return String(value || "").slice(0, 7);
}

function dateFromDateKey(value: string): Date | null {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKeyFromParts(year: number, monthIndex: number, day: number): string {
  const firstOfTargetMonth = new Date(year, monthIndex, 1);
  const targetYear = firstOfTargetMonth.getFullYear();
  const targetMonthIndex = firstOfTargetMonth.getMonth();
  const lastDay = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
  const clampedDay = Math.min(Math.max(1, Number(day || 1)), lastDay);
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

function addMonthsToDateKey(value: string, months: number): string {
  const date = dateFromDateKey(value);
  if (!date) return "";
  return dateKeyFromParts(date.getFullYear(), date.getMonth() + months, date.getDate());
}

export function nextRecurringBudgetDueDate(bill: { frequency?: string; dueDate?: string }, selectedMonth: string): string {
  if (!bill?.dueDate || !selectedMonth) return "";
  const frequency = bill.frequency === "monthly" || bill.frequency === "quarterly" || bill.frequency === "yearly" ? bill.frequency : "yearly";
  const interval = recurringBudgetFrequencyMonths[frequency];
  let cursor = /^\d{4}-\d{2}-\d{2}$/.test(bill.dueDate) ? bill.dueDate : `${selectedMonth}-01`;
  while (dateKeyToMonthKey(cursor).localeCompare(selectedMonth) < 0) cursor = addMonthsToDateKey(cursor, interval);
  return cursor;
}

export function recurringBudgetSetAside(bill: { amount?: number; frequency?: string; dueDate?: string }, selectedMonth: string) {
  const frequency = bill.frequency === "monthly" || bill.frequency === "quarterly" || bill.frequency === "yearly" ? bill.frequency : "yearly";
  const amountDue = Math.max(0, Number(bill.amount || 0));
  const nextDueDate = nextRecurringBudgetDueDate({ ...bill, frequency }, selectedMonth);
  const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
  const [dueYear, dueMonthNumber] = dateKeyToMonthKey(nextDueDate).split("-").map(Number);
  const monthsRemaining = selectedYear && selectedMonthNumber && dueYear && dueMonthNumber
    ? Math.max(1, (dueYear - selectedYear) * 12 + (dueMonthNumber - selectedMonthNumber) + 1)
    : 1;
  return {
    amountDue,
    frequency,
    nextDueDate,
    monthsRemaining,
    monthlyAmount: Number((amountDue / monthsRemaining).toFixed(2))
  };
}
