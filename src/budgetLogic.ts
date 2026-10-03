// Pure Budget editing helpers, mirroring app.js's category/line/transaction handlers. Every function
// returns a NEW HouseholdState (never mutates) so callers can pass it straight to the whole-state save.
import type { BudgetCategory, BudgetLine, HouseholdState, InboxDraft, RecurringExpense, Transaction } from "./types";

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

// Tags match case- and whitespace-insensitively, so "Florida Trip" and "florida trip" are one tag - a typo on a later
// entry must not silently split one trip into two groups (the same rule Reports' tag grouping uses).
export function normalizeTag(tag: string | undefined): string {
  return String(tag || "").trim().toLowerCase();
}

// Appends one or more comma-separated tags to a list, skipping any that already match (by normalizeTag) - typing
// "florida trip" when "Florida trip" is already a chip must not add a visually duplicate second chip. The list's
// existing spelling wins.
export function addTagsDeduped(existing: string[] | undefined, value: string): string[] {
  const tags = [...(existing || [])];
  parseTagsInput(value).forEach((tag) => {
    const key = normalizeTag(tag);
    if (!tags.some((current) => normalizeTag(current) === key)) tags.push(tag);
  });
  return tags;
}

export function removeTag(tags: string[] | undefined, tag: string): string[] {
  return (tags || []).filter((current) => current !== tag);
}

// Tags already used on the household's transactions (first spelling seen wins), as quick-add suggestions: the phone
// stand-in for web's "+ Add tag" autocomplete list. Tags already on the current row are left out.
export function tagSuggestions(transactions: Transaction[], exclude: string[] | undefined, limit = 8): string[] {
  const skip = new Set((exclude || []).map(normalizeTag));
  const seen = new Set<string>();
  const labels: string[] = [];
  transactions.forEach((transaction) => (transaction.tags || []).forEach((tag) => {
    const key = normalizeTag(tag);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (!skip.has(key)) labels.push(String(tag).trim());
  }));
  return labels.slice(0, limit);
}

export function setTransactionTags(state: HouseholdState, index: number, tags: string[]): HouseholdState {
  if (!state.transactions[index]) return state;
  return { ...state, transactions: state.transactions.map((transaction, itemIndex) => itemIndex === index ? { ...transaction, tags } : transaction) };
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

// ---- Splitting a transaction across categories ----------------------------------------------------------------------
// A split transaction has no category of its own: `splits` is [{ lineId, amount }] and its lineId/category names are
// cleared. Every total (Budget spent, Reports, the cash-flow breakdown) reads through the splits instead, so they MUST add
// up to the transaction's amount or the budget silently drifts. Only already-accepted ledger transactions can be split.

export type SplitRow = { lineId: string; amount: number };

// Existing splits, or - to start splitting - the whole amount on its current line plus an empty second row.
export function splitEditorInitialRows(transaction: Transaction): SplitRow[] {
  if (transaction.splits?.length) return transaction.splits.map((split) => ({ lineId: split.lineId, amount: split.amount }));
  return [{ lineId: transaction.lineId || "", amount: Number(transaction.amount || 0) }, { lineId: "", amount: 0 }];
}

// Only rows that have a category count: a row with an amount but no category is dropped on save, so counting its
// amount as "allocated" (as web's editor does) would let a split save that does not add up to the total.
function usableSplitRows(rows: SplitRow[]): SplitRow[] {
  return rows.filter((row) => row.lineId && Number.isFinite(Number(row.amount)));
}

export function splitRemaining(transaction: Transaction, rows: SplitRow[]): number {
  const allocated = usableSplitRows(rows).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return Math.round((Number(transaction.amount || 0) - allocated) * 100) / 100;
}

// Saveable once at least two categories are used and every cent of the amount is allocated.
export function canSaveSplit(transaction: Transaction, rows: SplitRow[]): boolean {
  return usableSplitRows(rows).length >= 2 && Math.abs(splitRemaining(transaction, rows)) < 0.005;
}

export type SplitResult = { ok: true; state: HouseholdState } | { ok: false; error: string };

function replaceTransaction(state: HouseholdState, index: number, update: (transaction: Transaction) => Transaction): HouseholdState {
  return { ...state, transactions: state.transactions.map((transaction, itemIndex) => itemIndex === index ? update(transaction) : transaction) };
}

export function applySplit(state: HouseholdState, index: number, rows: SplitRow[]): SplitResult {
  const transaction = state.transactions[index];
  if (!transaction) return { ok: false, error: "That transaction is no longer in the ledger." };
  const usable = usableSplitRows(rows);
  if (usable.length < 2) return { ok: false, error: "Split across at least two categories." };
  if (!canSaveSplit(transaction, rows)) return { ok: false, error: "The split amounts must add up to the transaction amount." };
  return { ok: true, state: replaceTransaction(state, index, (item) => ({
    ...item, splits: usable.map((row) => ({ lineId: row.lineId, amount: Number(row.amount) })), lineId: "", categoryName: "", subcategoryName: ""
  })) };
}

// Removing a split puts the whole transaction back on the first split's category (with a fresh name snapshot).
export function removeSplit(state: HouseholdState, index: number): HouseholdState {
  const transaction = state.transactions[index];
  if (!transaction?.splits?.length) return state;
  const lineId = transaction.splits[0]?.lineId || "";
  return replaceTransaction(state, index, (item) => {
    const { splits: _removed, ...rest } = item;
    return { ...rest, lineId, ...lineSnapshot(state, lineId) };
  });
}

// ---- Bulk category and sorting for the ledger --------------------------------------------------------------------------

export type BulkLineResult = { state: HouseholdState; applied: number; skippedSplit: number };

// Puts the chosen category on every selected transaction, with a fresh name snapshot. A SPLIT transaction has no single
// category (its splits carry them), so it is skipped and counted rather than given a category that would contradict its
// splits and double-count it in every total (web's bulk apply writes the category over a split's, leaving both set).
export function applyLineToTransactions(state: HouseholdState, indices: number[], lineId: string): BulkLineResult {
  if (!lineId) return { state, applied: 0, skippedSplit: 0 };
  const chosen = new Set(indices);
  const snapshot = lineSnapshot(state, lineId);
  let applied = 0;
  let skippedSplit = 0;
  const transactions = state.transactions.map((transaction, index) => {
    if (!chosen.has(index)) return transaction;
    if (transaction.splits?.length) { skippedSplit += 1; return transaction; }
    applied += 1;
    return { ...transaction, lineId, ...snapshot };
  });
  return { state: applied ? { ...state, transactions } : state, applied, skippedSplit };
}

export type LedgerSortField = "date" | "amount" | "payee" | "category" | "account";
export type LedgerEntry = { item: Transaction; index: number };

// Sorts ledger rows by date, amount, payee, category name or account name (either direction); ties keep their order so
// re-sorting never shuffles equal rows. `index` is each transaction's position in the real list, kept for editing.
export function sortLedgerEntries(entries: LedgerEntry[], field: LedgerSortField, direction: "asc" | "desc", labels: { category: (transaction: Transaction) => string; account: (transaction: Transaction) => string }): LedgerEntry[] {
  const sign = direction === "asc" ? 1 : -1;
  const value = (entry: LedgerEntry): string | number => {
    if (field === "amount") return Number(entry.item.amount || 0);
    if (field === "date") return entry.item.date || "";
    if (field === "category") return labels.category(entry.item).toLowerCase();
    if (field === "account") return labels.account(entry.item).toLowerCase();
    return String(entry.item.payee || "").toLowerCase();
  };
  return entries.map((entry, position) => ({ entry, position })).sort((a, b) => {
    const left = value(a.entry);
    const right = value(b.entry);
    if (left < right) return -sign;
    if (left > right) return sign;
    return a.position - b.position;
  }).map((wrapped) => wrapped.entry);
}


// ---- Recurring bills that post themselves -------------------------------------------------------------------------------
// A recurring expense (rent, a subscription) is a rule: payee, amount, category, repeat (weekly / every 2 weeks / monthly) and
// an optional end date. Each elapsed period surfaces as a Bank stream DRAFT for review - not straight into the ledger, since the
// amount can vary month to month (a utility bill) - and only becomes a real transaction once accepted. `postedDates` records which
// periods were already surfaced (accepted or dismissed), so reopening the screen never re-adds the same period.

function localKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function keyToDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export type RecurringRepeat = RecurringExpense["recurrence"];

// Every date a recurring bill should have come due by referenceDateKey, including its first date. An end date stops it from
// that date on without touching anything before it. A monthly bill on the 31st lands on each shorter month's last day.
export function recurringExpenseOccurrenceDates(recurring: Pick<RecurringExpense, "anchorDate" | "endDate" | "recurrence">, referenceDateKey: string): string[] {
  if (!recurring?.anchorDate || referenceDateKey < recurring.anchorDate) return [];
  const effectiveReference = recurring.endDate && referenceDateKey > recurring.endDate ? recurring.endDate : referenceDateKey;
  if (effectiveReference < recurring.anchorDate) return [];
  const anchor = keyToDate(recurring.anchorDate);
  const reference = keyToDate(effectiveReference);
  const dates: string[] = [];
  if (recurring.recurrence === "weekly" || recurring.recurrence === "biweekly") {
    const stepDays = recurring.recurrence === "weekly" ? 7 : 14;
    for (let cursor = anchor; cursor <= reference; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + stepDays)) dates.push(localKey(cursor));
    return dates;
  }
  if (recurring.recurrence === "monthly") {
    let monthsElapsed = 0;
    for (let cursor = anchor; cursor <= reference;) {
      dates.push(localKey(cursor));
      monthsElapsed += 1;
      const lastDayOfNext = new Date(anchor.getFullYear(), anchor.getMonth() + monthsElapsed + 1, 0).getDate();
      cursor = new Date(anchor.getFullYear(), anchor.getMonth() + monthsElapsed, Math.min(anchor.getDate(), lastDayOfNext));
    }
    return dates;
  }
  return [recurring.anchorDate];
}

// Surfaces every elapsed, not-yet-surfaced period of every recurring bill as a Bank stream draft (newest on top). Safe to run
// as often as you like: postedDates rules out anything already surfaced. Returns the SAME state object when nothing is new.
export function ensureRecurringExpensesPosted(state: HouseholdState, todayKey: string, createId: (prefix: string) => string): HouseholdState {
  const newDrafts: InboxDraft[] = [];
  const recurringExpenses = (state.recurringExpenses || []).map((recurring) => {
    const posted = recurring.postedDates || [];
    const due = recurringExpenseOccurrenceDates(recurring, todayKey).filter((date) => !posted.includes(date));
    if (!due.length) return recurring;
    due.forEach((date) => newDrafts.unshift({ id: createId("recurring-bank-stream"), payee: recurring.payee, amount: Number(recurring.amount || 0), lineId: recurring.lineId, accountId: recurring.accountId || "", date, recurringId: recurring.id }));
    return { ...recurring, postedDates: [...posted, ...due] };
  });
  if (!newDrafts.length) return state;
  return { ...state, recurringExpenses, transactionInboxDrafts: [...newDrafts, ...(state.transactionInboxDrafts || [])] };
}

export type RecurringInput = { payee: string; amount: number; lineId: string; accountId?: string; recurrence: RecurringRepeat; anchorDate: string; endDate?: string };

export function addRecurringExpense(state: HouseholdState, input: RecurringInput, createId: (prefix: string) => string): HouseholdState {
  const recurring: RecurringExpense = {
    id: createId("recurring-expense"), payee: input.payee, amount: input.amount, lineId: input.lineId, accountId: input.accountId || "",
    recurrence: input.recurrence, anchorDate: input.anchorDate, endDate: input.endDate || "", postedDates: []
  };
  return { ...state, recurringExpenses: [recurring, ...(state.recurringExpenses || [])] };
}

// Edits a recurring bill. Setting or lowering an end date also drops any still-unreviewed draft it had already surfaced past
// that date - they would otherwise sit in Bank stream forever (paycheck occurrences get the same cleanup).
export function updateRecurringExpense(state: HouseholdState, id: string, patch: Partial<Omit<RecurringExpense, "id" | "postedDates">>): HouseholdState {
  const recurringExpenses = (state.recurringExpenses || []).map((recurring) => recurring.id === id ? { ...recurring, ...patch } : recurring);
  const updated = recurringExpenses.find((recurring) => recurring.id === id);
  const drafts = updated?.endDate
    ? (state.transactionInboxDrafts || []).filter((draft) => draft.recurringId !== id || (draft.date || "") <= (updated.endDate as string))
    : state.transactionInboxDrafts;
  return { ...state, recurringExpenses, ...(drafts ? { transactionInboxDrafts: drafts } : {}) };
}

export function deleteRecurringExpense(state: HouseholdState, id: string): HouseholdState {
  return { ...state, recurringExpenses: (state.recurringExpenses || []).filter((recurring) => recurring.id !== id) };
}

export const RECURRING_REPEAT_LABELS: Record<RecurringRepeat, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly" };
