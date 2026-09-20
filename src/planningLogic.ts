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

function weekDayDatesFrom(weekStart: Date): Array<{ day: string; date: Date }> {
  return WEEK_DAYS.map((day, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return { day, date };
  });
}

export function firstWeekDayDates(monthValue: HouseholdState["budget"]["month"]): Array<{ day: string; date: Date }> {
  const parts = monthValue.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? new Date().getMonth() + 1;
  const firstDay = new Date(year, month - 1, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const firstMonday = new Date(firstDay);
  firstMonday.setDate(firstDay.getDate() - mondayOffset);
  return weekDayDatesFrom(firstMonday);
}

export type MealWeek = { number: number; label: string; start: Date };

// label is always the real Monday-Sunday span (never clamped to the month),
// even though a week's number/position is still driven by which calendar
// month it falls in - a boundary week genuinely spans two months (e.g.
// Jul 27-Aug 2 for August's "Week 1"), and showing a clamped 1-2 day stub
// instead ("Aug 1-Aug 2") reads as a broken/random date range rather than a
// real week. Mirrors the same grid this feeds (a week's out-of-month days
// are just dimmed, not hidden), so an unclamped label matches what's
// actually rendered underneath it.
export function mealWeeksForMonth(monthValue: HouseholdState["budget"]["month"]): MealWeek[] {
  const parts = monthValue.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? new Date().getMonth() + 1;
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const firstMonday = new Date(firstDay);
  firstMonday.setDate(firstDay.getDate() - mondayOffset);
  const weeks: MealWeek[] = [];
  let number = 1;
  for (let cursor = new Date(firstMonday); cursor <= lastDay; number += 1, cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)) {
    const end = new Date(cursor);
    end.setDate(end.getDate() + 6);
    const startLabel = cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    weeks.push({ number, label: `${startLabel}–${endLabel}`, start: new Date(cursor) });
  }
  return weeks;
}

// Which week (per mealWeeksForMonth) contains "today" - falls back to week 1
// when today isn't inside monthValue at all (viewing a past/future month).
// Without this, a mobile client opening the Meals screen on any day past the
// first week of the month would show/plan into an empty, wrong week every
// time - the exact bug this fixes on web.
export function currentMealWeekNumber(monthValue: HouseholdState["budget"]["month"], today: Date = new Date()): number {
  const weeks = mealWeeksForMonth(monthValue);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const match = weeks.find((week) => {
    const end = new Date(week.start);
    end.setDate(end.getDate() + 6);
    return startOfToday >= week.start && startOfToday <= end;
  });
  return match ? match.number : 1;
}

export function weekDayDatesForWeek(monthValue: HouseholdState["budget"]["month"], weekNumber: number): Array<{ day: string; date: Date }> {
  const weeks = mealWeeksForMonth(monthValue);
  const week = weeks.find((item) => item.number === weekNumber) || weeks[0];
  return week ? weekDayDatesFrom(week.start) : firstWeekDayDates(monthValue);
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
