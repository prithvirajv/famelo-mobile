import assert from "node:assert/strict";
import test from "node:test";
import { flowSegments, resolveFlowSelection, transactionAmountForLines, transactionHasLine, transactionsForLines,
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
  assert.deepEqual(result[0].lines, [{ id: "fuel", name: "Fuel", value: 100 }]);
});

test("reportCategoriesForScope omits zero-spend subcategories from the drilldown", () => {
  const categories = [{ name: "Food", color: "#111", lines: [{ id: "groceries", name: "Groceries", planned: 100 }, { id: "restaurants", name: "Restaurants", planned: 50 }] }];
  const transactions = [{ date: "2026-05-10", payee: "A", lineId: "groceries", amount: 30 }];
  const result = reportCategoriesForScope(categories, transactions, ["2026-05"]);
  assert.deepEqual(result[0].lines, [{ id: "groceries", name: "Groceries", value: 30 }]);
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

test("cashFlowByMonth takes income from the supplied paycheck income and expenses as the NET of the month's transactions", () => {
  const transactions = [
    { date: "2026-05-01", payee: "Store", lineId: "l1", amount: 100 },
    { date: "2026-05-02", payee: "Refund", lineId: "l1", amount: -40 },
    { date: "2026-06-01", payee: "Other month", lineId: "l1", amount: 999 }
  ];
  const result = cashFlowByMonth(transactions, ["2026-05", "2026-06", "2026-07"], (month) => (month === "2026-05" ? 2500 : 0));
  assert.deepEqual(result, [
    { month: "2026-05", income: 2500, expenses: 60 },
    { month: "2026-06", income: 0, expenses: 999 },
    { month: "2026-07", income: 0, expenses: 0 }
  ]);
});

const cat = (name, value, lines) => ({ name, color: "#000", value, percent: 50, lines });
const PALETTE = ["#p0", "#p1", "#p2"];

test("flowSegments orders categories largest first with palette colors, keeps only positive spend, and appends Savings when income exceeds spend", () => {
  const categories = [
    cat("Food", 300, [{ id: "g", name: "Groceries", value: 200 }, { id: "r", name: "Restaurants", value: 100 }, { id: "z", name: "Zero", value: 0 }]),
    cat("Home", 900, [{ id: "rent", name: "Rent", value: 900 }]),
    cat("Empty", 0, []),
    cat("Refunds", -50, [{ id: "x", name: "Refund", value: -50 }])
  ];
  const segments = flowSegments(categories, 2000, 1200, PALETTE);
  assert.deepEqual(segments.map((s) => [s.label, s.value, s.color]), [["Home", 900, "#p0"], ["Food", 300, "#p1"], ["Savings", 800, "#13936d"]]);
  assert.deepEqual(segments[1].lineIds, ["g", "r", "z"]);
  assert.deepEqual(segments[1].children, [{ label: "Groceries", value: 200, lineId: "g" }, { label: "Restaurants", value: 100, lineId: "r" }]);
  assert.deepEqual(segments[2].lineIds, []);
  assert.deepEqual(segments[2].children, []);
});

test("flowSegments omits Savings once spend meets or exceeds income, and cycles the palette", () => {
  const many = ["A", "B", "C", "D"].map((name, i) => cat(name, 100 - i, [{ id: name, name, value: 100 - i }]));
  assert.deepEqual(flowSegments(many, 300, 394, PALETTE).map((s) => s.color), ["#p0", "#p1", "#p2", "#p0"]);
  assert.equal(flowSegments(many, 394, 394, PALETTE).some((s) => s.label === "Savings"), false);
  assert.equal(flowSegments(many, 0, 394, PALETTE).some((s) => s.label === "Savings"), false);
});

test("resolveFlowSelection finds a category by its joined line ids and a subcategory by its own id, else null", () => {
  const segments = flowSegments([cat("Food", 300, [{ id: "g", name: "Groceries", value: 200 }, { id: "r", name: "Restaurants", value: 100 }]), cat("Solo", 50, [{ id: "s", name: "Solo line", value: 50 }])], 1000, 350, PALETTE);
  assert.deepEqual(resolveFlowSelection(segments, "g,r"), { label: "Food", value: 300, lineIds: ["g", "r"] });
  assert.deepEqual(resolveFlowSelection(segments, "g"), { label: "Groceries", value: 200, lineIds: ["g"] });
  assert.deepEqual(resolveFlowSelection(segments, "s"), { label: "Solo", value: 50, lineIds: ["s"] }, "a one-line category matches as a category first");
  assert.equal(resolveFlowSelection(segments, "nope"), null);
  assert.equal(resolveFlowSelection(segments, ""), null);
});

test("transactionAmountForLines counts only the matching splits' share, so a drill-down adds up to its segment", () => {
  const plain = { date: "2026-05-02", payee: "P", lineId: "g", amount: 30 };
  const split = { date: "2026-05-03", payee: "S", lineId: "", amount: 100, splits: [{ lineId: "g", amount: 60 }, { lineId: "r", amount: 40 }] };
  assert.equal(transactionAmountForLines(plain, ["g"]), 30);
  assert.equal(transactionAmountForLines(plain, ["r"]), 0);
  assert.equal(transactionAmountForLines(split, ["g"]), 60);
  assert.equal(transactionAmountForLines(split, ["g", "r"]), 100);
  assert.equal(transactionHasLine(split, ["r"]), true);
  assert.equal(transactionHasLine(plain, ["r"]), false);
});

test("transactionsForLines keeps only the scope's months and the selected lines, newest first", () => {
  const transactions = [
    { date: "2026-05-02", payee: "Old", lineId: "g", amount: 1 },
    { date: "2026-05-20", payee: "New", lineId: "g", amount: 2 },
    { date: "2026-04-30", payee: "Out of scope", lineId: "g", amount: 3 },
    { date: "2026-05-10", payee: "Other line", lineId: "r", amount: 4 },
    { date: "2026-05-15", payee: "Split", lineId: "", amount: 5, splits: [{ lineId: "g", amount: 5 }] }
  ];
  assert.deepEqual(transactionsForLines(transactions, ["g"], ["2026-05"]).map((t) => t.payee), ["New", "Split", "Old"]);
});

test("spentByLineInMonth credits each split its own line, counts a plain transaction on its line, and is month-scoped", () => {
  const transactions = [
    { date: "2026-07-03", payee: "Run", lineId: "", amount: 120, splits: [{ lineId: "food", amount: 80 }, { lineId: "house", amount: 40 }] },
    { date: "2026-07-04", payee: "Plain", lineId: "food", amount: 10 },
    { date: "2026-08-01", payee: "Next month", lineId: "food", amount: 999, splits: undefined }
  ];
  assert.equal(spentByLineInMonth(transactions, "food", "2026-07"), 90);
  assert.equal(spentByLineInMonth(transactions, "house", "2026-07"), 40);
  assert.equal(spentByLineInMonth(transactions, "other", "2026-07"), 0);
  assert.equal(spentByLineInMonth(transactions, "food", "2026-08"), 999);
});
