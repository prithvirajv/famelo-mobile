import assert from "node:assert/strict";
import test from "node:test";
import { addCategory, addLine, updateLine, budgetDeletionImpact, deleteBudgetLines, makeTransaction, transactionAssignmentLabel, parseTagsInput, categoryColor } from "../src/budgetLogic.ts";
import { budgetIncomeFromPaychecks } from "../src/paychecksLogic.ts";

function baseState() {
  return {
    budget: { month: "2026-07", income: 0, categories: [
      { name: "Home", color: "#13936d", lines: [{ id: "rent", name: "Rent", planned: 1000, dueDay: 1 }, { id: "power", name: "Power", planned: 100, dueDay: null }] },
      { name: "Food", color: "#3569d4", lines: [{ id: "groceries", name: "Groceries", planned: 400, dueDay: null }] }
    ] },
    transactions: [
      { date: "2026-07-02", payee: "Landlord", lineId: "rent", amount: 1000, categoryName: "Home", subcategoryName: "Rent" },
      { date: "2026-07-03", payee: "Store", lineId: "groceries", amount: 50 }
    ],
    paychecks: [{ id: "p1", date: "2026-07-01", name: "Pay", amount: 500, recurrence: "once", assignedLineIds: ["rent"] }],
    recurringExpenses: [{ id: "r1", payee: "Landlord", amount: 1000, lineId: "rent", recurrence: "monthly", anchorDate: "2026-07-01", postedDates: [] }],
    goals: { debts: [{ id: "d1", name: "Loan", balance: 1, rate: 1, minimum: 1, lineId: "rent" }] },
    transactionInboxDrafts: [{ id: "x", lineId: "rent", payee: "Draft", amount: 5, date: "2026-07-04" }]
  };
}

test("addCategory adds a category with a starter line and rejects blank or duplicate (case-insensitive) names", () => {
  const next = addCategory(baseState(), "  Fun ");
  assert.equal(next.budget.categories.length, 3);
  assert.equal(next.budget.categories[2].name, "Fun");
  assert.equal(next.budget.categories[2].lines[0].name, "New subcategory");
  assert.equal(next.budget.categories[2].color, categoryColor(2));
  assert.equal(addCategory(baseState(), "   "), null);
  assert.equal(addCategory(baseState(), "food"), null);
});

test("addLine and updateLine only touch the targeted category/line and never mutate the input state", () => {
  const state = baseState();
  const added = addLine(state, 1);
  assert.equal(added.budget.categories[1].lines.length, 2);
  assert.equal(state.budget.categories[1].lines.length, 1);
  const updated = updateLine(state, "power", { name: "Electric", planned: 120, dueDay: 15 });
  assert.deepEqual(updated.budget.categories[0].lines[1], { id: "power", name: "Electric", planned: 120, dueDay: 15 });
  assert.equal(updated.budget.categories[0].lines[0].name, "Rent");
});

test("budgetDeletionImpact counts everything linked to the lines, including planned money", () => {
  const impact = budgetDeletionImpact(baseState(), ["rent"]);
  assert.deepEqual({ ...impact }, { transactionCount: 1, recurringExpenseCount: 1, debtCount: 1, draftCount: 1, paycheckCount: 1, plannedAmount: 1000, total: 6 });
  assert.equal(budgetDeletionImpact(baseState(), ["power"]).total, 1);
  const empty = baseState(); empty.budget.categories[0].lines[1].planned = 0;
  assert.equal(budgetDeletionImpact(empty, ["power"]).total, 0);
});

test("deleteBudgetLines with a target reassigns every linked record and folds the planned amount into the target", () => {
  const next = deleteBudgetLines(baseState(), ["rent"], "power");
  assert.equal(next.budget.categories[0].lines.length, 1);
  assert.equal(next.budget.categories[0].lines[0].planned, 1100);
  assert.equal(next.transactions[0].lineId, "power");
  assert.equal(next.transactions[0].subcategoryName, "Power");
  assert.equal(next.recurringExpenses[0].lineId, "power");
  assert.equal(next.goals.debts[0].lineId, "power");
  assert.equal(next.transactionInboxDrafts[0].lineId, "power");
  assert.deepEqual(next.paychecks[0].assignedLineIds, ["power"]);
});

test("deleteBudgetLines with no target leaves transactions unassigned but keeps a name snapshot of the deleted line", () => {
  const state = baseState();
  state.transactions[0] = { date: "2026-07-02", payee: "Landlord", lineId: "rent", amount: 1000 };
  const next = deleteBudgetLines(state, ["rent"], "");
  assert.equal(next.transactions[0].lineId, "rent");
  assert.equal(next.transactions[0].categoryName, "Home");
  assert.equal(next.transactions[0].subcategoryName, "Rent");
  assert.equal(transactionAssignmentLabel(next, next.transactions[0]), "Home - Rent");
});

test("deleting the last line of a category removes the category, and deleting a whole category removes all its lines", () => {
  assert.deepEqual(deleteBudgetLines(baseState(), ["groceries"], "").budget.categories.map((c) => c.name), ["Home"]);
  const whole = deleteBudgetLines(baseState(), ["rent", "power"], "groceries", 0);
  assert.deepEqual(whole.budget.categories.map((c) => c.name), ["Food"]);
  assert.equal(whole.budget.categories[0].lines[0].planned, 1500);
});

test("makeTransaction stamps a line snapshot, defaults the memo, and parseTagsInput trims and drops blanks", () => {
  const txn = makeTransaction(baseState(), { date: "2026-07-05", payee: "Cafe", amount: 12.5, lineId: "groceries", tags: parseTagsInput(" trip, ,fun ") });
  assert.equal(txn.memo, "Manual entry");
  assert.equal(txn.categoryName, "Food");
  assert.equal(txn.subcategoryName, "Groceries");
  assert.deepEqual(txn.tags, ["trip", "fun"]);
  assert.equal(makeTransaction(baseState(), { date: "d", payee: "p", amount: 1, lineId: "gone" }).categoryName, "Deleted category");
});

test("budgetIncomeFromPaychecks sums one-time income in the month plus materialized occurrences in the month", () => {
  const state = {
    budget: { month: "2026-07" },
    paychecks: [
      { id: "a", date: "2026-07-10", name: "Bonus", amount: 300, recurrence: "bonus", assignedLineIds: [] },
      { id: "b", date: "2026-06-10", name: "Old", amount: 999, recurrence: "once", assignedLineIds: [] },
      { id: "c", date: "2026-01-01", name: "Salary", amount: 1, recurrence: "monthly", assignedLineIds: [] }
    ],
    paycheckOccurrences: [
      { id: "o1", seriesId: "c", date: "2026-07-01", amount: 2000 },
      { id: "o2", seriesId: "c", date: "2026-08-01", amount: 2000 }
    ]
  };
  assert.equal(budgetIncomeFromPaychecks(state), 2300);
});
