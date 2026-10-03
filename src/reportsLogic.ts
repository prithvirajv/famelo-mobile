import type { BudgetCategory, Transaction } from "./types";

export type ReportScope =
  | { type: "month"; month: string }
  | { type: "range"; start: string; end: string }
  | { type: "year"; year: number };

function compareMonthKeys(left: string, right: string): number {
  return String(left || "").localeCompare(String(right || ""));
}

function dateKeyToMonthKey(value: string | undefined): string {
  return String(value || "").slice(0, 7);
}

function monthEndDateKey(monthKey: string): string {
  const parts = monthKey.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

// Every calendar month key (YYYY-MM) touched by [startDateKey, endDateKey],
// inclusive - a "month", "date range", and "whole year" scope all funnel
// through this one function (same as the web app's monthKeysInRange).
export function monthKeysInRange(startDateKey: string, endDateKey: string): string[] {
  const startMonth = dateKeyToMonthKey(startDateKey);
  const endMonth = dateKeyToMonthKey(endDateKey);
  if (!startMonth || !endMonth || compareMonthKeys(startMonth, endMonth) > 0) return [];
  const keys: string[] = [];
  const parts = startMonth.split("-").map(Number);
  let year = parts[0] ?? 1970;
  let month = parts[1] ?? 1;
  let cursor = `${year}-${String(month).padStart(2, "0")}`;
  while (compareMonthKeys(cursor, endMonth) <= 0) {
    keys.push(cursor);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    cursor = `${year}-${String(month).padStart(2, "0")}`;
  }
  return keys;
}

export function monthKeysForScope(scope: ReportScope, currentMonth: string): string[] {
  if (scope.type === "year") return monthKeysInRange(`${scope.year}-01-01`, `${scope.year}-12-31`);
  if (scope.type === "range") return monthKeysInRange(scope.start, scope.end);
  const month = scope.month || currentMonth;
  return monthKeysInRange(`${month}-01`, monthEndDateKey(month));
}

// A split transaction has no lineId of its own - each split's own amount counts toward its own line instead of the whole
// transaction counting toward one, so a $120 grocery run split into $80 Food + $40 Household credits each category its own
// share. (This used to ignore splits entirely, which would have made a split transaction vanish from every total.)
export function spentByLineInMonth(transactions: Transaction[], lineId: string, monthKey: string): number {
  return (transactions || [])
    .filter((transaction) => dateKeyToMonthKey(transaction.date) === monthKey)
    .reduce((sum, transaction) => {
      if (transaction.splits?.length) return sum + transaction.splits.filter((split) => split.lineId === lineId).reduce((splitSum, split) => splitSum + Number(split.amount || 0), 0);
      return transaction.lineId === lineId ? sum + Number(transaction.amount || 0) : sum;
    }, 0);
}

export type ReportCategoryLine = { id: string; name: string; value: number };
export type ReportCategory = { name: string; color: string; value: number; percent: number; lines: ReportCategoryLine[] };

// Category spend summed across every month in the scope (not just the
// currently-viewed month) - mirrors the same fix already applied on web
// (a Reports card that only ever read the single current month regardless
// of the scope picker was a real, reported bug there). Subcategory totals
// with zero spend are omitted as noise, same convention as web.
export function reportCategoriesForScope(categories: BudgetCategory[], transactions: Transaction[], monthKeys: string[]): ReportCategory[] {
  const lineTotal = (lineId: string) => monthKeys.reduce((sum, monthKey) => sum + spentByLineInMonth(transactions, lineId, monthKey), 0);
  const withLines = categories.map((category) => {
    const lines = category.lines
      .map((line) => ({ id: line.id, name: line.name, value: lineTotal(line.id) }))
      .filter((line) => line.value !== 0);
    const value = category.lines.reduce((sum, line) => sum + lineTotal(line.id), 0);
    return { name: category.name, color: category.color, value, lines };
  });
  const max = Math.max(...withLines.map((category) => category.value), 1);
  return withLines.map((category) => ({ ...category, percent: Math.max(2, Math.round((category.value / max) * 100)) }));
}

export type BudgetVsActualRow = { category: string; month: string; planned: number; actual: number; variance: number; variancePercent: number | null };

// Simplification vs. web: web tracks a per-month budgetHistory snapshot so
// "planned" reflects what was actually planned back in that historical
// month; mobile's Budget screen is read-only/single-month with no history
// concept at all, so "planned" here is the category's current live planned
// total applied uniformly across every month in the scope. "actual" is
// still a real per-month sum of transactions, so month-to-month variance is
// meaningful even though the "planned" side is a constant approximation.
export function budgetVsActualByCategory(categories: BudgetCategory[], transactions: Transaction[], monthKeys: string[]): BudgetVsActualRow[] {
  const rows: BudgetVsActualRow[] = [];
  monthKeys.forEach((monthKey) => {
    categories.forEach((category) => {
      const planned = category.lines.reduce((sum, line) => sum + Number(line.planned || 0), 0);
      const actual = category.lines.reduce((sum, line) => sum + spentByLineInMonth(transactions, line.id, monthKey), 0);
      const variance = planned - actual;
      rows.push({ category: category.name, month: monthKey, planned, actual, variance, variancePercent: planned ? Math.round((variance / planned) * 100) : null });
    });
  });
  return rows.filter((row) => row.planned !== 0 || row.actual !== 0);
}

export type TagGroup = { key: string; label: string; total: number; transactions: Transaction[] };

function normalizeTag(tag: string | undefined): string {
  return String(tag || "").trim().toLowerCase();
}

export function groupTransactionsByTag(transactions: Transaction[]): TagGroup[] {
  const groups = new Map<string, TagGroup>();
  (transactions || []).forEach((transaction) => {
    (transaction.tags || []).forEach((rawTag) => {
      const key = normalizeTag(rawTag);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { key, label: String(rawTag).trim(), total: 0, transactions: [] });
      const group = groups.get(key);
      if (!group) return;
      group.total += Number(transaction.amount || 0);
      group.transactions.push(transaction);
    });
  });
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export type CashFlowMonth = { month: string; income: number; expenses: number };

// Web's definition: a month's income is what the household's paychecks bring in (the caller supplies
// that, since it needs paycheck logic this file can't import), and expenses are the NET of every
// transaction dated in the month - a refund (negative amount) reduces spending rather than counting as
// income. (Mobile used to treat negative transactions as income because it had no paycheck feed.)
export function cashFlowByMonth(transactions: Transaction[], monthKeys: string[], incomeForMonth: (monthKey: string) => number): CashFlowMonth[] {
  return monthKeys.map((monthKey) => {
    const expenses = transactions
      .filter((transaction) => dateKeyToMonthKey(transaction.date) === monthKey)
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    return { month: monthKey, income: incomeForMonth(monthKey), expenses };
  });
}

// ---- Cash flow breakdown (web's Sankey, as a mobile-friendly list) -----------------------------------
// Web draws a two-stage ribbon Sankey (Income -> Category -> Subcategory) as a custom SVG. The numbers
// behind it are what matter and they port exactly; mobile presents them as one proportional bar plus an
// expandable list instead of ribbons that are unreadable at phone width.

export type FlowChild = { label: string; value: number; lineId: string };
export type FlowSegment = { label: string; value: number; color: string; lineIds: string[]; children: FlowChild[] };

// Ordered destinations income flows into: each category with real spend (largest first) plus a trailing
// "Savings" segment for what is left of income after expenses - omitted entirely once spend meets or
// exceeds income. Categories have no id of their own, so a segment's own comma-joined line ids double as
// its drill-down key. Colors cycle through the given palette in order, like web's report themes.
export function flowSegments(categories: ReportCategory[], totalIncome: number, totalExpenses: number, palette: string[], savingsColor = "#13936d"): FlowSegment[] {
  const segments = categories
    .filter((category) => category.value > 0)
    .map((category) => ({
      label: category.name, value: category.value, lineIds: category.lines.map((line) => line.id),
      children: category.lines.filter((line) => line.value > 0).map((line) => ({ label: line.name, value: line.value, lineId: line.id })).sort((a, b) => b.value - a.value)
    }))
    .sort((a, b) => b.value - a.value)
    .map((segment, index) => ({ ...segment, color: palette[index % palette.length] || savingsColor }));
  const savings = totalIncome - totalExpenses;
  if (savings > 0) segments.push({ label: "Savings", value: savings, color: savingsColor, lineIds: [], children: [] });
  return segments;
}

export type FlowSelection = { label: string; value: number; lineIds: string[] };

// A category's key is its comma-joined line ids; a subcategory's key is its single line id (never
// colliding, since a category key always joins at least one id). Categories are matched first.
export function resolveFlowSelection(segments: FlowSegment[], key: string): FlowSelection | null {
  const category = segments.find((segment) => segment.lineIds.length && segment.lineIds.join(",") === key);
  if (category) return { label: category.label, value: category.value, lineIds: category.lineIds };
  for (const segment of segments) {
    const leaf = segment.children.find((child) => child.lineId === key);
    if (leaf) return { label: leaf.label, value: leaf.value, lineIds: [leaf.lineId] };
  }
  return null;
}

export function transactionHasLine(transaction: Transaction, lineIds: string[]): boolean {
  if (transaction.splits?.length) return transaction.splits.some((split) => lineIds.includes(split.lineId));
  return lineIds.includes(transaction.lineId);
}

// What a transaction contributes to a set of lines: its whole amount, or just the matching splits'
// share when it is split across categories - so a drill-down list adds up to the segment it came from.
export function transactionAmountForLines(transaction: Transaction, lineIds: string[]): number {
  if (transaction.splits?.length) return transaction.splits.filter((split) => lineIds.includes(split.lineId)).reduce((sum, split) => sum + Number(split.amount || 0), 0);
  return lineIds.includes(transaction.lineId) ? Number(transaction.amount || 0) : 0;
}

// The transactions behind a selected segment: dated in the scope's months, on those lines, newest first.
export function transactionsForLines(transactions: Transaction[], lineIds: string[], monthKeys: string[]): Transaction[] {
  return transactions
    .filter((transaction) => monthKeys.includes(dateKeyToMonthKey(transaction.date)) && transactionHasLine(transaction, lineIds))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
