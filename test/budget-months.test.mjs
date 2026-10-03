import assert from "node:assert/strict";
import test from "node:test";
import { formatMonthLabel, shiftMonthKey, cloneBudgetCategories, rememberBudgetSnapshot, availablePreviousBudgets, switchBudgetMonth, copyBudgetFromMonth, toggleRollover, applyRecurringBill, ensureRecurringBudgetBills, enableRecurringBill, disableRecurringBill, updateRecurringBill, nextRecurringBudgetDueDate, recurringBudgetSetAside } from "../src/planningLogic.ts";

const line = (id, planned, extra = {}) => ({ id, name: id, planned, dueDay: null, ...extra });
const state = (overrides = {}) => ({
  household: { name: "H", country: "US", currency: "USD", activity: [] },
  budget: { month: "2026-07", income: 3000, categories: [{ name: "Home", color: "#1", lines: [line("rent", 1000), line("fun", 200, { rolloverEnabled: true })] }] },
  budgetHistory: [], transactions: [], ...overrides
});
const noSpend = () => 0;

test("month labels and shifting roll across year boundaries", () => {
  assert.equal(formatMonthLabel("2026-07"), "July 2026");
  assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
  assert.equal(shiftMonthKey("2026-07", 0), "2026-07");
});

test("rememberBudgetSnapshot freezes the viewed month by value and replaces an earlier snapshot of the same month", () => {
  const first = rememberBudgetSnapshot(state());
  assert.deepEqual(first.budgetHistory.map((h) => [h.month, h.income]), [["2026-07", 3000]]);
  first.budget.categories[0].lines[0].planned = 5;
  assert.equal(first.budgetHistory[0].categories[0].lines[0].planned, 1000, "the snapshot is a copy");
  const edited = { ...first, budget: { ...first.budget, income: 3500 } };
  const second = rememberBudgetSnapshot(edited);
  assert.equal(second.budgetHistory.length, 1);
  assert.equal(second.budgetHistory[0].income, 3500);
  assert.equal(cloneBudgetCategories([]).length, 0);
});

test("switching to a brand-new month carries planned amounts forward from the month just left, snapshots it, and resets income", () => {
  const next = switchBudgetMonth(state(), "2026-08", noSpend);
  assert.equal(next.budget.month, "2026-08");
  assert.equal(next.budget.monthPreferenceSet, true);
  assert.equal(next.budget.income, 0);
  // "fun" has rollover on and nothing was spent, so its whole 200 comes along as well: 200 carried + 200 leftover
  assert.deepEqual(next.budget.categories[0].lines.map((l) => [l.id, l.planned, l.rolloverAmount]), [["rent", 1000, 0], ["fun", 400, 200]]);
  assert.deepEqual(next.budgetHistory.map((h) => h.month), ["2026-07"]);
});

test("a line with rollover on adds last month's unspent money the first time a new month opens, and never goes negative", () => {
  const spent = (lineId, month) => (lineId === "fun" && month === "2026-07" ? 150 : lineId === "rent" ? 1200 : 0);
  const next = switchBudgetMonth(state(), "2026-08", spent);
  const fun = next.budget.categories[0].lines.find((l) => l.id === "fun");
  assert.deepEqual([fun.planned, fun.rolloverAmount], [250, 50]);
  const overspent = switchBudgetMonth(state(), "2026-08", () => 999);
  assert.deepEqual(overspent.budget.categories[0].lines.find((l) => l.id === "fun").rolloverAmount, 0);
  assert.equal(overspent.budget.categories[0].lines.find((l) => l.id === "fun").planned, 200);
  const rent = next.budget.categories[0].lines.find((l) => l.id === "rent");
  assert.deepEqual([rent.planned, rent.rolloverAmount], [1000, 0], "rollover is opt-in per line");
});

test("revisiting a month restores its own saved plan and never re-applies rollover (that would add the same leftover again)", () => {
  const spent = (lineId, month) => (lineId === "fun" && month === "2026-07" ? 150 : 0);
  const august = switchBudgetMonth(state(), "2026-08", spent);
  const edited = { ...august, budget: { ...august.budget, income: 4200, categories: august.budget.categories.map((c) => ({ ...c, lines: c.lines.map((l) => (l.id === "rent" ? { ...l, planned: 1100 } : l)) })) } };
  const backToJuly = switchBudgetMonth(edited, "2026-07", spent);
  assert.deepEqual(backToJuly.budget.categories[0].lines.map((l) => [l.id, l.planned, l.rolloverAmount]), [["rent", 1000, 0], ["fun", 200, 0]]);
  assert.equal(backToJuly.budget.income, 3000);
  const augustAgain = switchBudgetMonth(backToJuly, "2026-08", spent);
  assert.deepEqual(augustAgain.budget.categories[0].lines.map((l) => [l.id, l.planned, l.rolloverAmount]), [["rent", 1100, 0], ["fun", 250, 0]], "august's saved plan comes back as it was last left, with no second rollover");
  assert.equal(augustAgain.budget.income, 4200);
});

test("jumping several months carries from the nearest earlier saved month; a line missing from it starts at zero; same month is a no-op", () => {
  const s = state();
  assert.equal(switchBudgetMonth(s, "2026-07", noSpend), s);
  assert.equal(switchBudgetMonth(s, "", noSpend), s);
  const jumped = switchBudgetMonth(s, "2026-10", noSpend);
  // July is still "the month just left" even when jumping several months, so rollover applies exactly as it does on web
  assert.deepEqual(jumped.budget.categories[0].lines.map((l) => [l.id, l.planned, l.rolloverAmount]), [["rent", 1000, 0], ["fun", 400, 200]]);
  const withNewLine = { ...jumped, budget: { ...jumped.budget, categories: [{ ...jumped.budget.categories[0], lines: [...jumped.budget.categories[0].lines, line("new", 50)] }] } };
  const earlier = switchBudgetMonth(withNewLine, "2026-05", noSpend);
  assert.deepEqual(earlier.budget.categories[0].lines.map((l) => l.planned), [0, 0, 0], "nothing earlier than May was ever saved");
});

test("availablePreviousBudgets lists earlier saved months newest first and ignores empty ones", () => {
  const s = state({ budgetHistory: [{ month: "2026-05", income: 1, categories: [{ name: "x", color: "", lines: [line("a", 1)] }] }, { month: "2026-06", income: 2, categories: [{ name: "x", color: "", lines: [line("a", 2)] }] }, { month: "2026-04", income: 3, categories: [] }, { month: "2026-08", income: 4, categories: [{ name: "x", color: "", lines: [] }] }] });
  assert.deepEqual(availablePreviousBudgets(s).map((h) => h.month), ["2026-06", "2026-05"]);
});

test("copyBudgetFromMonth replaces planned amounts and income from a saved month, keeps lines it doesn't know, and logs it", () => {
  const s = state({ budgetHistory: [{ month: "2026-06", income: 2800, categories: [{ name: "Home", color: "#1", lines: [line("rent", 900)] }] }] });
  const next = copyBudgetFromMonth(s, "2026-06");
  assert.deepEqual(next.budget.categories[0].lines.map((l) => [l.id, l.planned]), [["rent", 900], ["fun", 200]]);
  assert.equal(next.budget.income, 2800);
  assert.equal(next.household.activity[0], "Copied budget from June 2026 into July 2026");
  assert.equal(copyBudgetFromMonth(s, "2020-01"), s);
});

test("toggleRollover flips only that line", () => {
  const next = toggleRollover(state(), "rent");
  assert.deepEqual(next.budget.categories[0].lines.map((l) => !!l.rolloverEnabled), [true, true]);
  assert.deepEqual(toggleRollover(next, "fun").budget.categories[0].lines.map((l) => !!l.rolloverEnabled), [true, false]);
});

test("a stored due date more than one interval ahead is pulled back to the nearest occurrence on/after the month", () => {
  assert.equal(nextRecurringBudgetDueDate({ frequency: "yearly", dueDate: "2029-12-15" }, "2026-07"), "2026-12-15");
  assert.equal(nextRecurringBudgetDueDate({ frequency: "quarterly", dueDate: "2027-03-10" }, "2026-07"), "2026-09-10");
  assert.equal(nextRecurringBudgetDueDate({ frequency: "yearly", dueDate: "2026-12-15" }, "2026-07"), "2026-12-15");
  assert.equal(nextRecurringBudgetDueDate({ frequency: "yearly", dueDate: "2025-03-01" }, "2026-07"), "2027-03-01");
});

test("applyRecurringBill spreads the amount over the months left, and shows a due day only in the month it falls due", () => {
  const bill = line("tax", 0, { recurringBill: { enabled: true, amount: 1200, frequency: "yearly", dueDate: "2026-12-15" } });
  const july = applyRecurringBill(bill, "2026-07");
  assert.deepEqual([july.planned, july.dueDay], [200, null]);
  assert.equal(recurringBudgetSetAside(bill.recurringBill, "2026-07").monthsRemaining, 6);
  const december = applyRecurringBill(bill, "2026-12");
  assert.deepEqual([december.planned, december.dueDay], [1200, 15]);
  assert.equal(applyRecurringBill(line("plain", 5), "2026-07").planned, 5);
});

test("ensureRecurringBudgetBills re-derives current/future months, repairs a bad bill, and leaves a past month and unchanged state alone", () => {
  const withBill = state({ budget: { month: "2026-07", income: 0, categories: [{ name: "Home", color: "#1", lines: [line("tax", 7, { recurringBill: { enabled: true, amount: 1200, frequency: "yearly", dueDate: "2026-12-15" } })] }] } });
  const ensured = ensureRecurringBudgetBills(withBill, "2026-07");
  assert.equal(ensured.budget.categories[0].lines[0].planned, 200);
  assert.equal(ensureRecurringBudgetBills(ensured, "2026-07"), ensured, "idempotent: nothing changes the second time");
  const past = ensureRecurringBudgetBills(withBill, "2026-09");
  assert.equal(past.budget.categories[0].lines[0].planned, 7, "a month that already happened is closed history");
  const broken = state({ budget: { month: "2026-07", income: 0, categories: [{ name: "Home", color: "#1", lines: [line("x", 30, { dueDay: 9, recurringBill: { enabled: true, amount: Number.NaN, frequency: "weekly", dueDate: "soon" } })] }] } });
  const fixed = ensureRecurringBudgetBills(broken, "2026-07").budget.categories[0].lines[0];
  assert.deepEqual([fixed.recurringBill.frequency, fixed.recurringBill.dueDate, fixed.recurringBill.amount], ["yearly", "2026-07-09", 30]);
  const noBills = state();
  assert.equal(ensureRecurringBudgetBills(noBills, "2026-07"), noBills);
});

test("enable, update and disable a recurring bill", () => {
  const s = state();
  const enabled = enableRecurringBill({ ...s, budget: { ...s.budget, categories: [{ name: "Home", color: "#1", lines: [line("ins", 600, { dueDay: 20 })] }] } }, "ins");
  const ins = enabled.budget.categories[0].lines[0];
  assert.deepEqual([ins.recurringBill.enabled, ins.recurringBill.amount, ins.recurringBill.frequency, ins.recurringBill.dueDate], [true, 600, "yearly", "2026-07-20"]);
  assert.deepEqual([ins.planned, ins.dueDay], [600, 20]);
  const quarterly = updateRecurringBill(enabled, "ins", { frequency: "quarterly", amount: 300 }).budget.categories[0].lines[0];
  assert.equal(quarterly.recurringBill.frequency, "quarterly");
  assert.equal(quarterly.planned, 300);
  const off = disableRecurringBill(enabled, "ins").budget.categories[0].lines[0];
  assert.equal(off.recurringBill, undefined);
  assert.equal("recurringBill" in off, false);
  assert.equal(off.planned, 600, "turning it off keeps the amount it had been planning");
  assert.equal(updateRecurringBill(s, "rent", { amount: 5 }).budget.categories[0].lines[0].planned, 1000);
});
