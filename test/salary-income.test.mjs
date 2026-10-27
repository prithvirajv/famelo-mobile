import assert from "node:assert/strict";
import test from "node:test";
import { detectSalaryDeposits, applyDetectedSalaries, keepDetectedSalary, undoDetectedSalary, detectedSalaryNotices, salaryAlreadyRecorded } from "../src/salaryLogic.ts";
import { budgetPlanSuggestions, applyPlanSuggestion } from "../src/homeLogic.ts";

const TODAY = "2026-10-26";
const dep = (payee, amount, date, extra = {}) => ({ externalId: `sf:a:${payee}-${date}`, accountId: "chk", payee, amount: -amount, date, lineId: "", ...extra });
const paydays = ["2026-08-14", "2026-08-28", "2026-09-11", "2026-09-25", "2026-10-09", "2026-10-23"];
const baseState = (overrides = {}) => ({
  household: { name: "H", country: "US", currency: "USD", activity: [] },
  budget: { month: "2026-10", income: 0, categories: [{ name: "Food", color: "", lines: [{ id: "groceries", name: "Groceries", planned: 360 }, { id: "dining", name: "Dining", planned: 200 }] }] },
  accounts: [{ id: "chk", name: "Checking", type: "checking", openingBalance: 100 }],
  transactions: [], transactionInboxDrafts: [], transactionInboxDone: [], paychecks: [], paycheckOccurrences: [],
  ...overrides
});
const ids = () => { let n = 0; return (prefix) => `${prefix}-${++n}`; };

test("a steady payer on a regular cadence is detected; transfers, P2P, short series and stale series are not", () => {
  const rows = paydays.map((date) => dep(`ACME PAYROLL #${date.replace(/-/g, "")}`, 2500, date));
  const [salary] = detectSalaryDeposits(rows, TODAY);
  assert.deepEqual([salary.name, salary.recurrence, salary.amount, salary.anchorDate, salary.count], ["ACME PAYROLL", "biweekly", 2500, "2026-09-11", 6]);
  assert.equal(detectSalaryDeposits(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((date) => dep("Employer Direct Dep", 4000, date)), TODAY)[0].recurrence, "monthly");
  assert.deepEqual(detectSalaryDeposits(rows.slice(0, 2), TODAY), []);
  assert.deepEqual(detectSalaryDeposits(rows.map((row) => ({ ...row, payee: "Zelle payment from Sam" })), TODAY), []);
  assert.deepEqual(detectSalaryDeposits(rows.map((row) => ({ ...row, externalId: "" })), TODAY), []);
  assert.deepEqual(detectSalaryDeposits(rows.slice(0, 3), TODAY), []);
  assert.deepEqual(detectSalaryDeposits(["2026-08-01", "2026-08-16", "2026-09-01", "2026-09-16", "2026-10-01", "2026-10-16"].map((date) => dep("Twice Monthly Co", 1800, date)), TODAY), []);
});

test("a detected salary becomes a paycheck and its deposits are folded in without moving the account total; Undo restores everything", () => {
  const rows = paydays.map((date) => dep(`ACME PAYROLL #${date.replace(/-/g, "")}`, 2500, date));
  const state = baseState({
    transactions: rows.slice(0, 5).map((row) => ({ ...row, memo: "Accepted bank stream item" })),
    transactionInboxDrafts: [{ id: "d6", payee: rows[5].payee, amount: rows[5].amount, date: rows[5].date, accountId: "chk", externalId: rows[5].externalId, lineId: "" }]
  });
  const result = applyDetectedSalaries(state, TODAY, ids(), "2026-10-26T10:00:00Z");
  assert.equal(result.changed, true);
  assert.equal(result.added, 1);
  const paycheck = result.state.paychecks[0];
  assert.deepEqual([paycheck.name, paycheck.amount, paycheck.recurrence, paycheck.date, paycheck.depositAccountId], ["ACME PAYROLL (from your deposits)", 2500, "biweekly", "2026-09-11", ""]);
  assert.equal(result.state.transactions.length, 0, "uncategorized bank deposit rows are taken out of the ledger");
  assert.equal(result.state.transactionInboxDrafts.length, 0, "the waiting deposit is skipped");
  assert.equal(result.state.accounts[0].openingBalance, 100 + 5 * 2500, "five deposits left the ledger, so the opening balance carries them and the total stays the bank's");
  assert.equal(detectedSalaryNotices(result.state).length, 1);
  assert.equal(state.transactions.length, 5, "input not mutated");
  assert.equal(applyDetectedSalaries(result.state, TODAY, ids()).changed, false, "a second pass finds nothing new");

  const undone = undoDetectedSalary(result.state, paycheck.id, TODAY);
  assert.equal(undone.paychecks.length, 0);
  assert.equal(undone.transactions.length, 5);
  assert.equal(undone.transactionInboxDrafts.length, 1);
  assert.equal(undone.transactionInboxDone.length, 0);
  assert.equal(undone.accounts[0].openingBalance, 100);
  assert.equal(applyDetectedSalaries(undone, TODAY, ids()).changed, false, "an undone salary is not detected again");
  assert.equal(detectedSalaryNotices(keepDetectedSalary(result.state, paycheck.id)).length, 0);
});

test("categorized deposits stay, a hand-entered paycheck is authoritative, and a raise is followed after two matching deposits", () => {
  const rows = paydays.map((date) => dep(`ACME PAYROLL ${date.replace(/-/g, "")}`, 2500, date));
  const categorized = baseState({ transactions: rows.map((row, i) => ({ ...row, lineId: i === 0 ? "groceries" : "" })) });
  const folded = applyDetectedSalaries(categorized, TODAY, ids());
  assert.equal(folded.state.transactions.length, 1, "a deposit the household categorized is left alone");
  const detection = detectSalaryDeposits(rows, TODAY)[0];
  assert.equal(salaryAlreadyRecorded(detection, [{ amount: 2490, recurrence: "biweekly" }]), true);
  assert.equal(applyDetectedSalaries(baseState({ transactions: rows, paychecks: [{ id: "p", name: "Mine", amount: 2500, recurrence: "biweekly", date: "2026-01-02", assignedLineIds: [] }] }), TODAY, ids()).changed, false);

  let state = applyDetectedSalaries(baseState({ transactions: rows }), TODAY, ids()).state;
  const raise = (date, id) => ({ id, payee: "ACME PAYROLL 20261106", amount: -2600, date, accountId: "chk", externalId: `sf:a:r-${id}`, lineId: "" });
  state = applyDetectedSalaries({ ...state, transactionInboxDrafts: [raise("2026-11-06", "r1")] }, "2026-11-07", ids()).state;
  assert.equal(state.paychecks[0].amount, 2500, "one different deposit is not yet a raise");
  state = applyDetectedSalaries({ ...state, transactionInboxDrafts: [raise("2026-11-20", "r2")] }, "2026-11-21", ids()).state;
  assert.equal(state.paychecks[0].amount, 2600, "the second matching deposit confirms it");
});

test("home plan suggestions list lines far off last month's plan and one tap plans the actual amount", () => {
  const spent = { "groceries:2026-09": 480, "dining:2026-09": 190 };
  const spentInMonth = (lineId, monthKey) => spent[`${lineId}:${monthKey}`] || 0;
  const state = baseState();
  const suggestions = budgetPlanSuggestions(state, "2026-10", spentInMonth);
  assert.deepEqual(suggestions.map((s) => [s.lineId, s.planned, s.actual, s.suggested]), [["groceries", 360, 480, 480]]);
  assert.deepEqual(budgetPlanSuggestions(state, "2026-11", spentInMonth), [], "only for the month being viewed");
  const applied = applyPlanSuggestion(state, "groceries", 480);
  assert.equal(applied.budget.categories[0].lines[0].planned, 480);
  assert.deepEqual(budgetPlanSuggestions(applied, "2026-10", spentInMonth), [], "handled lines are not suggested again");
});
