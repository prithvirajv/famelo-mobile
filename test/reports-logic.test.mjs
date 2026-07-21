import assert from "node:assert/strict";
import test from "node:test";
import {
  monthKeysInRange, monthKeysForScope, spentByLineInMonth, reportCategoriesForScope,
  budgetVsActualByCategory, groupTransactionsByTag, cashFlowByMonth
} from "../src/reportsLogic.ts";

test("monthKeysInRange returns a single key when start and end fall in the same month", () => {
  assert.deepEqual(monthKeysInRange("2026-03-05", "2026-03-28"), ["2026-03"]);
});

test("monthKeysInRange lists every month touched by a multi-month range, inclusive", () => {
  assert.deepEqual(monthKeysInRange("2026-03-20", "2026-06-02"), ["2026-03", "2026-04", "2026-05", "2026-06"]);
});

test("monthKeysInRange spans a full year and correctly rolls over into the next year", () => {
  assert.deepEqual(monthKeysInRange("2026-01-01", "2026-12-31"), [
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"
  ]);
});

test("monthKeysInRange returns an empty array for a missing or backwards range", () => {
  assert.deepEqual(monthKeysInRange("", "2026-03-01"), []);
  assert.deepEqual(monthKeysInRange("2026-06-01", "2026-01-01"), []);
});

test("monthKeysForScope resolves month/range/year scopes to the right month keys", () => {
  assert.deepEqual(monthKeysForScope({ type: "month", month: "2026-05" }, "2026-07"), ["2026-05"]);
  assert.deepEqual(monthKeysForScope({ type: "range", start: "2026-03-15", end: "2026-05-01" }, "2026-07"), ["2026-03", "2026-04", "2026-05"]);
  assert.deepEqual(monthKeysForScope({ type: "year", year: 2025 }, "2026-07").length, 12);
});

test("spentByLineInMonth sums only the given line's transactions dated within the given month", () => {
  const transactions = [
    { date: "2026-05-03", payee: "A", lineId: "fuel", amount: 40 },
    { date: "2026-05-20", payee: "B", lineId: "fuel", amount: 15 },
    { date: "2026-06-01", payee: "C", lineId: "fuel", amount: 999 },
    { date: "2026-05-10", payee: "D", lineId: "groceries", amount: 999 }
  ];
  assert.equal(spentByLineInMonth(transactions, "fuel", "2026-05"), 55);
});

test("reportCategoriesForScope sums spend across every month in the scope, not just one", () => {
  const categories = [{ name: "Transportation", color: "#111", lines: [{ id: "fuel", name: "Fuel", planned: 200 }] }];
  const transactions = [
    { date: "2026-05-10", payee: "A", lineId: "fuel", amount: 40 },
    { date: "2026-06-10", payee: "B", lineId: "fuel", amount: 60 }
  ];
  const result = reportCategoriesForScope(categories, transactions, ["2026-05", "2026-06"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 100);
  assert.deepEqual(result[0].lines, [{ name: "Fuel", value: 100 }]);
});

test("reportCategoriesForScope omits zero-spend subcategories from the drilldown", () => {
  const categories = [{ name: "Food", color: "#111", lines: [{ id: "groceries", name: "Groceries", planned: 100 }, { id: "restaurants", name: "Restaurants", planned: 50 }] }];
  const transactions = [{ date: "2026-05-10", payee: "A", lineId: "groceries", amount: 30 }];
  const result = reportCategoriesForScope(categories, transactions, ["2026-05"]);
  assert.deepEqual(result[0].lines, [{ name: "Groceries", value: 30 }]);
});

test("budgetVsActualByCategory omits rows where both planned and actual are zero", () => {
  const categories = [
    { name: "Food", color: "#111", lines: [{ id: "groceries", name: "Groceries", planned: 100 }] },
    { name: "Empty", color: "#222", lines: [{ id: "unused", name: "Unused", planned: 0 }] }
  ];
  const transactions = [{ date: "2026-05-10", payee: "A", lineId: "groceries", amount: 40 }];
  const rows = budgetVsActualByCategory(categories, transactions, ["2026-05"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "Food");
  assert.equal(rows[0].planned, 100);
  assert.equal(rows[0].actual, 40);
  assert.equal(rows[0].variance, 60);
});

test("groupTransactionsByTag groups across transactions and merges case/whitespace variants", () => {
  const transactions = [
    { date: "2026-05-01", payee: "A", lineId: "l1", amount: 20, tags: ["Florida trip"] },
    { date: "2026-05-02", payee: "B", lineId: "l1", amount: 30, tags: ["florida trip "] },
    { date: "2026-05-03", payee: "C", lineId: "l1", amount: 5, tags: [] }
  ];
  const groups = groupTransactionsByTag(transactions);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].total, 50);
  assert.equal(groups[0].transactions.length, 2);
});

test("cashFlowByMonth splits positive amounts as expenses and negative amounts as income", () => {
  const transactions = [
    { date: "2026-05-01", payee: "Paycheck", lineId: "", amount: -1000 },
    { date: "2026-05-02", payee: "Groceries", lineId: "l1", amount: 60 }
  ];
  const result = cashFlowByMonth(transactions, ["2026-05"]);
  assert.deepEqual(result, [{ month: "2026-05", income: 1000, expenses: 60 }]);
});
