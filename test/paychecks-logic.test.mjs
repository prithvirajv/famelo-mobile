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
