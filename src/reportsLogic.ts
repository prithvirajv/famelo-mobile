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

export function spentByLineInMonth(transactions: Transaction[], lineId: string, monthKey: string): number {
  return (transactions || [])
    .filter((transaction) => transaction.lineId === lineId && dateKeyToMonthKey(transaction.date) === monthKey)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
}

export type ReportCategoryLine = { name: string; value: number };
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
      .map((line) => ({ name: line.name, value: lineTotal(line.id) }))
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

// Simple income/expense split for a cash-flow view: expenses are positive
// transaction amounts (spend), income is every negative one (a deposit/
// refund) taken as its absolute value - mobile has no separate paycheck
// feed wired into Reports, so this reads purely from transactions.
export function cashFlowByMonth(transactions: Transaction[], monthKeys: string[]): CashFlowMonth[] {
  return monthKeys.map((monthKey) => {
    const monthTransactions = transactions.filter((transaction) => dateKeyToMonthKey(transaction.date) === monthKey);
    const expenses = monthTransactions.filter((transaction) => Number(transaction.amount) > 0).reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const income = monthTransactions.filter((transaction) => Number(transaction.amount) < 0).reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount)), 0);
    return { month: monthKey, income, expenses };
  });
}
