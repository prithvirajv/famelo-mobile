import assert from "node:assert/strict";
import test from "node:test";
import { paycheckOccurrencesInRange, paycheckAllOccurrenceDatesInRange, ensurePaycheckOccurrencesGenerated } from "../src/paychecksLogic.ts";

test("paycheckOccurrencesInRange: a monthly paycheck counts exactly one landing per month", () => {
  const paycheck = { id: "p1", name: "Pay", assignedLineIds: [], date: "2026-04-11", recurrence: "monthly" };
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-05-01", "2026-05-31"), 1);
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-04-01", "2026-04-10"), 0);
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-03-01", "2026-03-31"), 0);
});

test("paycheckOccurrencesInRange: a biweekly paycheck can land twice within one month", () => {
  const paycheck = { id: "p1", name: "Pay", assignedLineIds: [], date: "2026-07-01", recurrence: "biweekly" };
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-07-01", "2026-07-31"), 3);
});

test("paycheckOccurrencesInRange: a one-time paycheck only counts in the month it lands", () => {
  const paycheck = { id: "p1", name: "Pay", assignedLineIds: [], date: "2026-06-15", recurrence: "once" };
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-06-01", "2026-06-30"), 1);
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-07-01", "2026-07-31"), 0);
});

test("paycheckAllOccurrenceDatesInRange: a biweekly paycheck lists every individual pay date within the month", () => {
  const paycheck = { id: "p1", name: "Pay", assignedLineIds: [], date: "2026-07-10", recurrence: "biweekly" };
  assert.deepEqual(paycheckAllOccurrenceDatesInRange(paycheck, "2026-07-01", "2026-07-31"), ["2026-07-10", "2026-07-24"]);
});

test("paycheckAllOccurrenceDatesInRange: a monthly paycheck lists exactly one date per month", () => {
  const paycheck = { id: "p1", name: "Pay", assignedLineIds: [], date: "2026-04-11", recurrence: "monthly" };
  assert.deepEqual(paycheckAllOccurrenceDatesInRange(paycheck, "2026-05-01", "2026-05-31"), ["2026-05-11"]);
  assert.deepEqual(paycheckAllOccurrenceDatesInRange(paycheck, "2026-03-01", "2026-03-31"), []);
});

test("paycheckAllOccurrenceDatesInRange: a one-time paycheck only lists its own date when inside the range", () => {
  const paycheck = { id: "p1", name: "Pay", assignedLineIds: [], date: "2026-06-15", recurrence: "once" };
  assert.deepEqual(paycheckAllOccurrenceDatesInRange(paycheck, "2026-06-01", "2026-06-30"), ["2026-06-15"]);
  assert.deepEqual(paycheckAllOccurrenceDatesInRange(paycheck, "2026-07-01", "2026-07-31"), []);
});

test("paycheckOccurrencesInRange: an endDate stops future occurrences without changing past ones", () => {
  const paycheck = { id: "p1", name: "Pay", assignedLineIds: [], date: "2026-07-10", recurrence: "biweekly", endDate: "2026-09-30" };
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-07-01", "2026-07-31"), 2);
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-09-01", "2026-09-30"), 2);
  assert.equal(paycheckOccurrencesInRange(paycheck, "2026-10-01", "2026-10-31"), 0);
});

test("paycheckAllOccurrenceDatesInRange: an endDate excludes dates after it but keeps earlier ones", () => {
  const paycheck = { id: "p1", name: "Pay", assignedLineIds: [], date: "2026-07-10", recurrence: "biweekly", endDate: "2026-07-15" };
  assert.deepEqual(paycheckAllOccurrenceDatesInRange(paycheck, "2026-07-01", "2026-07-31"), ["2026-07-10"]);
  assert.deepEqual(paycheckAllOccurrenceDatesInRange(paycheck, "2026-08-01", "2026-08-31"), []);
});

function idSequence(prefix) {
  let count = 0;
  return () => `${prefix}-${count++}`;
}

test("ensurePaycheckOccurrencesGenerated: a one-time paycheck never gets occurrence rows", () => {
  const paychecks = [{ id: "p1", name: "Bonus", assignedLineIds: [], date: "2026-07-15", recurrence: "once", amount: 500 }];
  const result = ensurePaycheckOccurrencesGenerated(paychecks, [], idSequence("occ"), new Date(2026, 6, 1));
  assert.deepEqual(result.paycheckOccurrences, []);
});

test("ensurePaycheckOccurrencesGenerated: materializes occurrences for a recurring paycheck up to the 12-month cap", () => {
  const paychecks = [{ id: "p1", name: "Salary", assignedLineIds: [], date: "2026-01-01", recurrence: "monthly", amount: 2000, depositAccountId: "checking" }];
  const result = ensurePaycheckOccurrencesGenerated(paychecks, [], idSequence("occ"), new Date(2026, 0, 15));
  // From 2026-01-01 through the 12-month cap (2027-01-15), monthly = 13 occurrences.
  assert.equal(result.paycheckOccurrences.length, 13);
  assert.equal(result.paycheckOccurrences[0].seriesId, "p1");
  assert.equal(result.paycheckOccurrences[0].amount, 2000);
  assert.equal(result.paycheckOccurrences[0].depositAccountId, "checking");
  assert.equal(result.paychecks[0].generatedThroughDate, "2027-01-15");
});

test("ensurePaycheckOccurrencesGenerated: does not regenerate occurrences already materialized under the current schedule", () => {
  const paychecks = [{
    id: "p1", name: "Salary", assignedLineIds: [], date: "2026-01-01", recurrence: "monthly", amount: 2000,
    generatedThroughDate: "2027-01-15", generatedRecurrence: "monthly", generatedAnchorDate: "2026-01-01", generatedEndDate: ""
  }];
  const existing = [{ id: "occ-existing", seriesId: "p1", date: "2026-02-01", amount: 2000 }];
  const result = ensurePaycheckOccurrencesGenerated(paychecks, existing, idSequence("occ"), new Date(2026, 0, 15));
  assert.deepEqual(result.paycheckOccurrences, existing, "already fully generated through the cap, nothing new should be added");
});

test("ensurePaycheckOccurrencesGenerated: throws out and regenerates occurrences when the recurrence changed since they were generated", () => {
  const paychecks = [{
    id: "p1", name: "Salary", assignedLineIds: [], date: "2026-01-01", recurrence: "biweekly", amount: 1000,
    generatedThroughDate: "2026-06-01", generatedRecurrence: "monthly", generatedAnchorDate: "2026-01-01", generatedEndDate: ""
  }];
  const staleOccurrence = { id: "occ-stale", seriesId: "p1", date: "2026-02-01", amount: 2000 };
  const result = ensurePaycheckOccurrencesGenerated(paychecks, [staleOccurrence], idSequence("occ"), new Date(2026, 0, 15));
  assert.ok(!result.paycheckOccurrences.some((occurrence) => occurrence.id === "occ-stale"), "the stale monthly-schedule occurrence must be discarded");
  assert.equal(result.paychecks[0].generatedRecurrence, "biweekly");
  assert.ok(result.paycheckOccurrences.length > 0, "occurrences should be regenerated under the new biweekly schedule");
});

test("ensurePaycheckOccurrencesGenerated: drops occurrences dated after a newly-set (or lowered) end date", () => {
  const paychecks = [{
    id: "p1", name: "Salary", assignedLineIds: [], date: "2026-01-01", recurrence: "monthly", amount: 2000, endDate: "2026-03-01",
    generatedThroughDate: "2027-01-15", generatedRecurrence: "monthly", generatedAnchorDate: "2026-01-01", generatedEndDate: ""
  }];
  const existing = [
    { id: "occ-1", seriesId: "p1", date: "2026-02-01", amount: 2000 },
    { id: "occ-2", seriesId: "p1", date: "2026-06-01", amount: 2000 }
  ];
  const result = ensurePaycheckOccurrencesGenerated(paychecks, existing, idSequence("occ"), new Date(2026, 0, 15));
  assert.ok(!result.paycheckOccurrences.some((occurrence) => occurrence.date > "2026-03-01"), "no occurrence should survive past the end date");
});

test("ensurePaycheckOccurrencesGenerated: assigns a real id to a legacy paycheck that never had one, so its occurrences join back correctly", () => {
  const paychecks = [{ name: "Legacy salary", assignedLineIds: [], date: "2026-01-01", recurrence: "monthly", amount: 2000 }];
  const result = ensurePaycheckOccurrencesGenerated(paychecks, [], idSequence("occ"), new Date(2026, 0, 15));
  assert.ok(result.paychecks[0].id, "a real id must be assigned");
  assert.ok(result.paycheckOccurrences.every((occurrence) => occurrence.seriesId === result.paychecks[0].id));
});

import { paycheckIncomeForMonth } from "../src/paychecksLogic.ts";

test("paycheckIncomeForMonth sums one-time income and materialized occurrences for just that month", () => {
  const state = {
    paychecks: [
      { id: "a", date: "2026-07-10", name: "Bonus", amount: 300, recurrence: "bonus", assignedLineIds: [] },
      { id: "c", date: "2026-01-01", name: "Salary", amount: 1, recurrence: "monthly", assignedLineIds: [] }
    ],
    paycheckOccurrences: [
      { id: "o1", seriesId: "c", date: "2026-07-01", amount: 2000 },
      { id: "o2", seriesId: "c", date: "2026-08-01", amount: 2100 }
    ]
  };
  assert.equal(paycheckIncomeForMonth(state, "2026-07"), 2300);
  assert.equal(paycheckIncomeForMonth(state, "2026-08"), 2100);
  assert.equal(paycheckIncomeForMonth(state, "2026-09"), 0);
});

import { validatePaycheckPatch, updatePaycheck, setOccurrenceDate, assignBillToPaycheck, removeAssignedLine, paycheckAssignedAmount, paycheckMonthlyIncome, paycheckActiveInMonth } from "../src/paychecksLogic.ts";

const pay = (overrides = {}) => ({ id: "p1", name: "Salary", date: "2026-07-01", amount: 1000, recurrence: "monthly", assignedLineIds: [], ...overrides });
const occ = (id, amount, extra = {}) => ({ id, seriesId: "p1", date: "2026-07-01", amount, depositAccountId: "", ...extra });

test("validatePaycheckPatch rejects blank names, negative amounts and non-calendar dates", () => {
  assert.equal(validatePaycheckPatch({ name: "A", amount: 0, date: "2026-02-28", endDate: "" }), null);
  assert.match(validatePaycheckPatch({ name: " " }), /name/);
  assert.match(validatePaycheckPatch({ amount: -1 }), /Amount/);
  assert.match(validatePaycheckPatch({ amount: NaN }), /Amount/);
  assert.match(validatePaycheckPatch({ date: "2026-02-30" }), /Date/);
  assert.match(validatePaycheckPatch({ endDate: "soon" }), /End date/);
  assert.match(validatePaycheckPatch({ date: "" }), /date/);
});

test("updatePaycheck: a new amount only reaches pay dates still at the old amount, a deposit account reaches all, and inputs are not mutated", () => {
  const data = { paychecks: [pay(), pay({ id: "p2" })], paycheckOccurrences: [occ("o1", 1000), occ("o2", 1500), occ("o3", 1000, { seriesId: "p2" })] };
  const result = updatePaycheck(data, "p1", { amount: 1200, depositAccountId: "acct" });
  assert.deepEqual(result.paycheckOccurrences.map((o) => [o.id, o.amount, o.depositAccountId]), [["o1", 1200, "acct"], ["o2", 1500, "acct"], ["o3", 1000, ""]]);
  assert.equal(result.paychecks[0].amount, 1200);
  assert.equal(data.paychecks[0].amount, 1000);
  assert.equal(data.paycheckOccurrences[0].amount, 1000);
  assert.equal(updatePaycheck(data, "missing", { amount: 5 }), data);
  const renamed = updatePaycheck(data, "p1", { name: " Pay ", recurrence: "weekly", endDate: "2026-12-31", date: "2026-07-03" });
  assert.deepEqual([renamed.paychecks[0].name, renamed.paychecks[0].recurrence, renamed.paychecks[0].endDate, renamed.paychecks[0].date], ["Pay", "weekly", "2026-12-31", "2026-07-03"]);
  assert.equal(updatePaycheck(data, "p1", { endDate: "" }).paychecks[0].endDate, "");
});

test("occurrence dates move individually", () => {
  assert.deepEqual(setOccurrenceDate([occ("o1", 1), occ("o2", 2)], "o2", "2026-07-09").map((o) => o.date), ["2026-07-01", "2026-07-09"]);
});

test("assigning a bill adds the line once and optionally sets its planned amount; removing drops it; the assigned total sums planned amounts", () => {
  const state = { paychecks: [pay()], budget: { month: "2026-07", categories: [{ name: "Home", lines: [{ id: "l1", planned: 10 }, { id: "l2", planned: 20 }] }] } };
  const assigned = assignBillToPaycheck(state, "p1", "l1", 150.48);
  assert.deepEqual(assigned.paychecks[0].assignedLineIds, ["l1"]);
  assert.equal(assigned.budget.categories[0].lines[0].planned, 150.48);
  assert.equal(state.budget.categories[0].lines[0].planned, 10);
  assert.deepEqual(assignBillToPaycheck(assigned, "p1", "l1", null).paychecks[0].assignedLineIds, ["l1"], "no duplicates");
  assert.equal(assignBillToPaycheck(assigned, "p1", "l2", null).budget.categories[0].lines[1].planned, 20, "no amount leaves planned alone");
  assert.deepEqual(removeAssignedLine(assigned.paychecks, "p1", "l1")[0].assignedLineIds, []);
  const both = { ...pay(), assignedLineIds: ["l1", "l2", "gone"] };
  assert.equal(paycheckAssignedAmount(both, [{ id: "l1", planned: 10 }, { id: "l2", planned: 20 }]), 30);
});

test("monthly income comes from pay dates for recurring paychecks and from the date for one-time ones; ended series are inactive", () => {
  const recurring = pay();
  const occurrences = [occ("a", 1000, { date: "2026-07-01" }), occ("b", 900, { date: "2026-08-01" })];
  assert.equal(paycheckMonthlyIncome(recurring, occurrences, "2026-07"), 1000);
  assert.equal(paycheckMonthlyIncome(recurring, occurrences, "2026-09"), 0);
  assert.equal(paycheckMonthlyIncome(pay({ recurrence: "once", date: "2026-07-15", amount: 300 }), [], "2026-07"), 300);
  assert.equal(paycheckMonthlyIncome(pay({ recurrence: "once", date: "2026-07-15", amount: 300 }), [], "2026-08"), 0);
  assert.equal(paycheckActiveInMonth(recurring, "2026-12"), true);
  assert.equal(paycheckActiveInMonth(recurring, "2026-06"), false, "not started yet");
  assert.equal(paycheckActiveInMonth(pay({ endDate: "2026-08-31" }), "2026-09"), false, "ended");
  assert.equal(paycheckActiveInMonth(pay({ recurrence: "bonus", date: "2026-07-15" }), "2026-08"), false);
});
