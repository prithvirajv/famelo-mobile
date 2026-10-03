import type { BudgetCategory, BudgetHistoryEntry, BudgetLine, NoteItem, HouseholdState, PlannedMeal, Recipe, RecurringBudgetBill } from "./types";

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
  // A stored due date can also sit more than one interval AHEAD of the selected month (e.g. someone picked the wrong year).
  // Pull it back to the nearest occurrence on or after the selected month, so "months to save" reflects the bill actually
  // coming up next rather than some far-future repeat (web does the same).
  let earlier = addMonthsToDateKey(cursor, -interval);
  while (earlier && dateKeyToMonthKey(earlier).localeCompare(selectedMonth) >= 0) {
    cursor = earlier;
    earlier = addMonthsToDateKey(cursor, -interval);
  }
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


// ---- Budget months, rollover and recurring bills ----------------------------------------------------------------------
// Ported from web (app.js: switchBudgetMonth, copyBudgetFromMonth, rememberCurrentBudgetSnapshot, recurring budget bills).
// The category/subcategory STRUCTURE is shared by every month - state.budget.categories is the one canonical list - and only
// each line's `planned` amount differs per month, so switching months or copying a budget only ever rewrites `planned`
// (keyed by the line's stable id), never the list of lines. Each month left behind is frozen into budgetHistory.

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(year ?? 1970, (month ?? 1) - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

export function cloneBudgetCategories(categories: BudgetCategory[]): BudgetCategory[] {
  return categories.map((category) => ({ ...category, lines: category.lines.map((line) => ({ ...line, ...(line.recurringBill ? { recurringBill: { ...line.recurringBill } } : {}) })) }));
}

// Freezes the month being viewed into budgetHistory (replacing that month's earlier snapshot).
export function rememberBudgetSnapshot(state: HouseholdState): HouseholdState {
  const snapshot: BudgetHistoryEntry = { month: state.budget.month, income: state.budget.income, categories: cloneBudgetCategories(state.budget.categories) };
  const history = state.budgetHistory || [];
  const exists = history.some((entry) => entry.month === snapshot.month);
  return { ...state, budgetHistory: exists ? history.map((entry) => entry.month === snapshot.month ? snapshot : entry) : [...history, snapshot] };
}

// Earlier months that have a saved budget, newest first - what "copy from a previous month" can offer.
export function availablePreviousBudgets(state: HouseholdState): BudgetHistoryEntry[] {
  return (state.budgetHistory || [])
    .filter((entry) => entry.month < state.budget.month && Array.isArray(entry.categories) && entry.categories.length > 0)
    .sort((a, b) => b.month.localeCompare(a.month));
}

function plannedByLineId(snapshot: BudgetHistoryEntry | undefined): Map<string, number> {
  const planned = new Map<string, number>();
  (snapshot?.categories || []).forEach((category) => category.lines.forEach((line) => planned.set(line.id, Number(line.planned || 0))));
  return planned;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

// Moves the whole budget to another month: the month being left is frozen first. The new month's planned amounts come from its
// own saved snapshot if it has one, otherwise carry forward from the nearest earlier month (a line missing there starts at 0).
// Rollover only applies the FIRST time a new month is opened (no snapshot yet and the carry-forward source is the month just
// left): a line with rolloverEnabled adds last month's unspent money (planned - spent, never negative) to its planned amount and
// remembers it in rolloverAmount. Revisiting a month must not add the same leftover in again, so it never re-applies.
// `spentInMonth` is injected because spend totals live in another logic file.
export function switchBudgetMonth(state: HouseholdState, newMonth: string, spentInMonth: (lineId: string, monthKey: string) => number): HouseholdState {
  if (!newMonth || newMonth === state.budget.month) return state;
  const previousMonth = state.budget.month;
  const remembered = rememberBudgetSnapshot(state);
  const existing = (remembered.budgetHistory || []).find((entry) => entry.month === newMonth);
  const switched: HouseholdState = { ...remembered, budget: { ...remembered.budget, month: newMonth, monthPreferenceSet: true } };
  const source = existing || availablePreviousBudgets(switched)[0];
  const carried = plannedByLineId(source);
  const isFreshMonth = !existing && source?.month === previousMonth;
  const categories = remembered.budget.categories.map((category) => ({
    ...category,
    lines: category.lines.map((line) => {
      const carriedPlanned = carried.get(line.id) ?? 0;
      if (!isFreshMonth || !line.rolloverEnabled) return { ...line, planned: carriedPlanned, rolloverAmount: 0 };
      const previousPlanned = Number((source?.categories || []).flatMap((item) => item.lines).find((item) => item.id === line.id)?.planned || 0);
      const leftover = Math.max(0, roundCents(previousPlanned - spentInMonth(line.id, previousMonth)));
      return { ...line, planned: carriedPlanned + leftover, rolloverAmount: leftover };
    })
  }));
  return { ...switched, budget: { ...switched.budget, categories, income: existing ? Number(existing.income || 0) : 0 } };
}

// Replaces the viewed month's planned amounts with another saved month's (lines missing from it keep their current amount).
export function copyBudgetFromMonth(state: HouseholdState, month: string): HouseholdState {
  const source = (state.budgetHistory || []).find((entry) => entry.month === month);
  if (!source) return state;
  const planned = plannedByLineId(source);
  const categories = state.budget.categories.map((category) => ({ ...category, lines: category.lines.map((line) => ({ ...line, planned: planned.has(line.id) ? (planned.get(line.id) as number) : Number(line.planned || 0) })) }));
  return {
    ...state, budget: { ...state.budget, categories, income: Number(source.income || state.budget.income || 0) },
    household: { ...state.household, activity: [`Copied budget from ${formatMonthLabel(source.month)} into ${formatMonthLabel(state.budget.month)}`, ...(state.household.activity || [])] }
  };
}

export function toggleRollover(state: HouseholdState, lineId: string): HouseholdState {
  return mapLine(state, lineId, (line) => ({ ...line, rolloverEnabled: !line.rolloverEnabled }));
}

function mapLine(state: HouseholdState, lineId: string, update: (line: BudgetLine) => BudgetLine): HouseholdState {
  return { ...state, budget: { ...state.budget, categories: state.budget.categories.map((category) => ({ ...category, lines: category.lines.map((line) => line.id === lineId ? update(line) : line) })) } };
}

const validDateKey = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

// A recurring bill (HOA, insurance, property tax) sets money aside every month toward its next due date: planned becomes the
// amount due divided by the months remaining until then, and dueDay is shown only in the month the bill actually falls due.
export function applyRecurringBill(line: BudgetLine, monthKey: string): BudgetLine {
  if (!line.recurringBill?.enabled) return line;
  const summary = recurringBudgetSetAside(line.recurringBill, monthKey);
  const dueDate = summary.nextDueDate || line.recurringBill.dueDate || `${monthKey}-01`;
  return {
    ...line,
    recurringBill: { ...line.recurringBill, amount: summary.amountDue, frequency: summary.frequency as RecurringBudgetBill["frequency"], dueDate },
    planned: summary.monthlyAmount,
    dueDay: summary.nextDueDate?.startsWith(`${monthKey}-`) ? Number(summary.nextDueDate.slice(-2)) : null
  };
}

// Repairs and re-derives every recurring bill (web does this on every render). Only the real current month and later are
// recomputed: a month that has already happened is closed history, and re-deriving its planned amount from today's due date
// would retroactively invent a savings target for a month that had passed (or one before the bill even existed).
export function ensureRecurringBudgetBills(state: HouseholdState, currentMonthKey: string): HouseholdState {
  const isPastMonth = state.budget.month < currentMonthKey;
  let changed = false;
  const categories = state.budget.categories.map((category) => ({
    ...category,
    lines: category.lines.map((line) => {
      if (!line.recurringBill?.enabled) return line;
      let bill = line.recurringBill;
      if (!validDateKey(bill.dueDate)) bill = { ...bill, dueDate: line.dueDay ? `${state.budget.month}-${String(line.dueDay).padStart(2, "0")}` : `${state.budget.month}-01` };
      if (!["monthly", "quarterly", "yearly"].includes(bill.frequency)) bill = { ...bill, frequency: "yearly" };
      if (!Number.isFinite(Number(bill.amount))) bill = { ...bill, amount: Number(line.planned || 0) };
      const repaired = bill === line.recurringBill ? line : { ...line, recurringBill: bill };
      const next = isPastMonth ? repaired : applyRecurringBill(repaired, state.budget.month);
      if (JSON.stringify(next) !== JSON.stringify(line)) changed = true;
      return next;
    })
  }));
  return changed ? { ...state, budget: { ...state.budget, categories } } : state;
}

// Turns a line into a recurring bill: yearly by default, due on its due day this month (or the 1st), amount = what is planned.
export function enableRecurringBill(state: HouseholdState, lineId: string): HouseholdState {
  return mapLine(state, lineId, (line) => applyRecurringBill({
    ...line, recurringBill: { enabled: true, amount: Number(line.planned || 0), frequency: "yearly", dueDate: line.dueDay ? `${state.budget.month}-${String(line.dueDay).padStart(2, "0")}` : `${state.budget.month}-01` }
  }, state.budget.month));
}

export function disableRecurringBill(state: HouseholdState, lineId: string): HouseholdState {
  return mapLine(state, lineId, (line) => { const { recurringBill: _removed, ...rest } = line; return rest; });
}

export function updateRecurringBill(state: HouseholdState, lineId: string, patch: Partial<Pick<RecurringBudgetBill, "amount" | "frequency" | "dueDate">>): HouseholdState {
  return mapLine(state, lineId, (line) => line.recurringBill ? applyRecurringBill({ ...line, recurringBill: { ...line.recurringBill, ...patch } }, state.budget.month) : line);
}
