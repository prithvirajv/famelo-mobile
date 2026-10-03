// Pure Budget editing helpers, mirroring app.js's category/line/transaction handlers. Every function
// returns a NEW HouseholdState (never mutates) so callers can pass it straight to the whole-state save.
import type { BudgetCategory, BudgetLine, HouseholdState, Transaction } from "./types";

export const CATEGORY_COLOR_PALETTE = ["#13936d", "#3569d4", "#d99a24", "#e05252", "#8a5cf6", "#0891b2", "#c2410c", "#be185d"];

export function categoryColor(index: number): string {
  return CATEGORY_COLOR_PALETTE[index % CATEGORY_COLOR_PALETTE.length] as string;
}

export function uniqueBudgetId(seed: string): string {
  const slug = String(seed || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

export type FlatBudgetLine = BudgetLine & { category: string };

export function allBudgetLines(state: Pick<HouseholdState, "budget">): FlatBudgetLine[] {
  return state.budget.categories.flatMap((category) => category.lines.map((line) => ({ ...line, category: category.name })));
}

// Snapshot of a line's names stamped onto a transaction so its history survives the line being
// renamed or deleted later (web's lineSnapshot).
export function lineSnapshot(state: Pick<HouseholdState, "budget">, lineId: string): { categoryName: string; subcategoryName: string } {
  const line = allBudgetLines(state).find((item) => item.id === lineId);
  return { categoryName: line?.category || "Deleted category", subcategoryName: line?.name || lineId || "Deleted subcategory" };
}

export function transactionAssignmentLabel(state: Pick<HouseholdState, "budget">, transaction: Transaction): string {
  if (transaction.splits?.length) return `Split (${transaction.splits.length} categories)`;
  const liveLine = allBudgetLines(state).find((line) => line.id === transaction.lineId);
  const category = liveLine?.category || transaction.categoryName || "Deleted category";
  const subcategory = liveLine?.name || transaction.subcategoryName || transaction.lineId || "Deleted subcategory";
  return `${category} - ${subcategory}`;
}

export function makeTransaction(state: Pick<HouseholdState, "budget">, input: { date: string; payee: string; amount: number; lineId: string; memo?: string; accountId?: string; tags?: string[] }): Transaction {
  return {
    date: input.date, payee: input.payee, amount: input.amount, lineId: input.lineId,
    memo: input.memo ?? "Manual entry", accountId: input.accountId || "", orderNumber: "", tags: input.tags || [],
    ...lineSnapshot(state, input.lineId)
  };
}

export function parseTagsInput(value: string): string[] {
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function addCategory(state: HouseholdState, name: string): HouseholdState | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (state.budget.categories.some((category) => category.name.toLowerCase() === trimmed.toLowerCase())) return null;
  const category: BudgetCategory = {
    name: trimmed, color: categoryColor(state.budget.categories.length),
    lines: [{ id: uniqueBudgetId(trimmed), name: "New subcategory", planned: 0, dueDay: null }]
  };
  return { ...state, budget: { ...state.budget, categories: [...state.budget.categories, category] } };
}

export function addLine(state: HouseholdState, categoryIndex: number): HouseholdState {
  const category = state.budget.categories[categoryIndex];
  if (!category) return state;
  const line: BudgetLine = { id: uniqueBudgetId(category.name), name: "New subcategory", planned: 0, dueDay: null };
  return updateCategories(state, (categories) => categories.map((item, index) => index === categoryIndex ? { ...item, lines: [...item.lines, line] } : item));
}

export function updateLine(state: HouseholdState, lineId: string, patch: { name?: string; planned?: number; dueDay?: number | null }): HouseholdState {
  return updateCategories(state, (categories) => categories.map((category) => ({
    ...category,
    lines: category.lines.map((line) => line.id === lineId ? { ...line, ...patch } : line)
  })));
}

function updateCategories(state: HouseholdState, update: (categories: BudgetCategory[]) => BudgetCategory[]): HouseholdState {
  return { ...state, budget: { ...state.budget, categories: update(state.budget.categories) } };
}

export type BudgetDeletionImpact = {
  transactionCount: number; recurringExpenseCount: number; debtCount: number; draftCount: number; paycheckCount: number; plannedAmount: number; total: number;
};

// Everything that would be orphaned (or silently left pointing at a dead line) by deleting these
// lines - web's budgetDeletionImpact. A delete with nothing linked goes straight through.
export function budgetDeletionImpact(state: HouseholdState, lineIds: string[]): BudgetDeletionImpact {
  const ids = new Set(lineIds);
  const plannedAmount = allBudgetLines(state).filter((line) => ids.has(line.id)).reduce((sum, line) => sum + Number(line.planned || 0), 0);
  const transactionCount = state.transactions.filter((item) => ids.has(item.lineId)).length;
  const recurringExpenseCount = (state.recurringExpenses || []).filter((item) => ids.has(item.lineId)).length;
  const debtCount = (state.goals?.debts || []).filter((item) => item.lineId && ids.has(item.lineId)).length;
  const draftCount = (state.transactionInboxDrafts || []).filter((item) => ids.has(item.lineId)).length;
  const paycheckCount = (state.paychecks || []).filter((item) => (item.assignedLineIds || []).some((id) => ids.has(id))).length;
  const total = transactionCount + recurringExpenseCount + debtCount + draftCount + paycheckCount + (plannedAmount > 0 ? 1 : 0);
  return { transactionCount, recurringExpenseCount, debtCount, draftCount, paycheckCount, plannedAmount, total };
}

// Removes the given lines (and any category left with no lines). With a targetLineId, everything
// linked to them is reassigned there and their planned amount is folded into the target's planned
// amount; without one, linked transactions keep a name snapshot of the deleted line instead - both
// exactly as web's confirm-delete handler does.
export function deleteBudgetLines(state: HouseholdState, lineIds: string[], targetLineId: string, deleteWholeCategoryIndex?: number): HouseholdState {
  const ids = new Set(lineIds);
  const impact = budgetDeletionImpact(state, lineIds);
  const flat = allBudgetLines(state);
  const target = targetLineId ? flat.find((line) => line.id === targetLineId) : undefined;
  let transactions = state.transactions;
  let recurringExpenses = state.recurringExpenses;
  let debts = state.goals?.debts;
  let drafts = state.transactionInboxDrafts;
  let paychecks = state.paychecks;
  if (target) {
    transactions = state.transactions.map((item) => ids.has(item.lineId) ? { ...item, lineId: target.id, categoryName: target.category, subcategoryName: target.name } : item);
    recurringExpenses = (state.recurringExpenses || []).map((item) => ids.has(item.lineId) ? { ...item, lineId: target.id } : item);
    debts = debts?.map((item) => item.lineId && ids.has(item.lineId) ? { ...item, lineId: target.id } : item);
    drafts = drafts?.map((item) => ids.has(item.lineId) ? { ...item, lineId: target.id } : item);
    paychecks = (state.paychecks || []).map((item) => {
      if (!(item.assignedLineIds || []).some((id) => ids.has(id))) return item;
      const kept = item.assignedLineIds.filter((id) => !ids.has(id));
      return { ...item, assignedLineIds: kept.includes(target.id) ? kept : [...kept, target.id] };
    });
  } else {
    transactions = state.transactions.map((item) => {
      if (!ids.has(item.lineId)) return item;
      const line = flat.find((candidate) => candidate.id === item.lineId);
      return line ? { ...item, categoryName: line.category, subcategoryName: line.name } : item;
    });
  }
  const categories = state.budget.categories
    .filter((_, index) => deleteWholeCategoryIndex === undefined || index !== deleteWholeCategoryIndex)
    .flatMap((category) => {
      const lines = category.lines
        .filter((line) => !ids.has(line.id))
        .map((line) => target && impact.plannedAmount > 0 && line.id === target.id ? { ...line, planned: Number(line.planned || 0) + impact.plannedAmount } : line);
      // A category only disappears when this delete emptied it - a category that was already empty is left alone.
      return lines.length === 0 && category.lines.length > 0 ? [] : [{ ...category, lines }];
    });
  return {
    ...state,
    transactions,
    recurringExpenses: recurringExpenses ?? state.recurringExpenses,
    paychecks,
    ...(drafts ? { transactionInboxDrafts: drafts } : {}),
    goals: state.goals && debts ? { ...state.goals, debts } : state.goals,
    budget: { ...state.budget, categories }
  };
}
