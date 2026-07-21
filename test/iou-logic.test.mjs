import assert from "node:assert/strict";
import test from "node:test";
import {
  uniqueId, isValidEmail, splitAmountEvenly, splitBillByPercentages,
  computeBillSplitAmounts, netBalancesByPerson, settleUpPersonIous, friendsWithoutEmailFromIous
} from "../src/iouLogic.ts";

test("uniqueId slugifies the seed and appends a random suffix", () => {
  const id = uniqueId("New Friend!");
  assert.ok(id.startsWith("new-friend-"));
  assert.ok(id.length > "new-friend-".length);
});

test("isValidEmail accepts a well-formed address and rejects malformed ones", () => {
  assert.equal(isValidEmail("friend@example.com"), true);
  assert.equal(isValidEmail("friendexample.com"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(undefined), false);
});

test("splitAmountEvenly divides evenly and hands leftover cents to the first shares", () => {
  assert.deepEqual(splitAmountEvenly(90, 3), [30, 30, 30]);
  const shares = splitAmountEvenly(100, 3);
  assert.deepEqual(shares, [33.34, 33.33, 33.33]);
  assert.equal(shares.reduce((sum, share) => sum + share, 0), 100);
});

test("splitBillByPercentages uses largest-remainder rounding instead of naive independent rounding", () => {
  const shares = splitBillByPercentages(10, [33.33, 33.33, 33.34]);
  assert.deepEqual(shares, [3.33, 3.33, 3.34]);
  assert.equal(shares.reduce((sum, share) => sum + share, 0), 10);
});

test("splitBillByPercentages returns null when percentages don't sum to ~100", () => {
  assert.equal(splitBillByPercentages(100, [40, 40]), null);
  assert.equal(splitBillByPercentages(100, [60, 60]), null);
});

test("computeBillSplitAmounts (equal): payerAmount always reconciles to the cent", () => {
  const result = computeBillSplitAmounts("equal", 100, [{}, {}]);
  assert.ok(result.ok);
  if (!result.ok) return;
  const total = result.friendAmounts.reduce((sum, amount) => sum + amount, 0) + result.payerAmount;
  assert.equal(Math.round(total * 100) / 100, 100);
});

test("computeBillSplitAmounts (percentage): friend percentages convert to dollars, payer gets the rest", () => {
  const result = computeBillSplitAmounts("percentage", 100, [{ percent: 40 }, { percent: 30 }]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.friendAmounts, [40, 30]);
  assert.equal(result.payerAmount, 30);
});

test("computeBillSplitAmounts (exact): passes through typed amounts, absorbing rounding fuzz into payerAmount", () => {
  const result = computeBillSplitAmounts("exact", 622.36, [{ amount: 150 }, { amount: 100 }]);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.friendAmounts, [150, 100]);
  assert.equal(result.payerAmount, 372.36);
});

test("computeBillSplitAmounts (exact): rejects a split that adds up to more than the total", () => {
  const result = computeBillSplitAmounts("exact", 100, [{ amount: 60 }, { amount: 60 }]);
  assert.equal(result.ok, false);
});

test("netBalancesByPerson nets an i_owe record against an owed_to_me record for the same person", () => {
  const ious = [
    { id: "a", person: "Sam", amount: 20, direction: "i_owe", reason: "", date: "", accountId: "", settled: false, settledDate: "" },
    { id: "b", person: "Sam", amount: 32, direction: "owed_to_me", reason: "", date: "", accountId: "", settled: false, settledDate: "" }
  ];
  const groups = netBalancesByPerson(ious);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].net, 12);
  assert.equal(groups[0].direction, "owed_to_me");
  assert.equal(groups[0].records.length, 2);
});

test("netBalancesByPerson excludes settled records from the net entirely", () => {
  const ious = [
    { id: "a", person: "Jordan", amount: 20, direction: "owed_to_me", reason: "", date: "", accountId: "", settled: true, settledDate: "2026-01-01" },
    { id: "b", person: "Jordan", amount: 15, direction: "owed_to_me", reason: "", date: "", accountId: "", settled: false, settledDate: "" }
  ];
  const groups = netBalancesByPerson(ious);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].net, 15);
});

test("settleUpPersonIous splits the last touched record when the amount doesn't land on a whole-record boundary", () => {
  const ious = [{ id: "a", person: "Sam", amount: 20, direction: "owed_to_me", reason: "", date: "2026-07-01", accountId: "checking", settled: false, settledDate: "" }];
  const result = settleUpPersonIous(ious, "Sam", 12, "2026-07-15", () => "a-remainder");
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.ious.length, 2);
  const settledPortion = result.ious.find((iou) => iou.id === "a");
  const remainder = result.ious.find((iou) => iou.id === "a-remainder");
  assert.ok(settledPortion && remainder);
  if (!settledPortion || !remainder) return;
  assert.equal(settledPortion.amount, 12);
  assert.equal(settledPortion.settled, true);
  assert.equal(remainder.amount, 8);
  assert.equal(remainder.settled, false);
  assert.equal(settledPortion.amount + remainder.amount, 20);
});

test("settleUpPersonIous rejects an amount exceeding the net balance and leaves ious untouched", () => {
  const ious = [{ id: "a", person: "Sam", amount: 20, direction: "owed_to_me", reason: "", date: "2026-07-01", accountId: "", settled: false, settledDate: "" }];
  const result = settleUpPersonIous(ious, "Sam", 25, "2026-07-15");
  assert.equal(result.ok, false);
  assert.equal(ious[0].settled, false);
});

test("settleUpPersonIous only touches records in the person's net direction, leaving offsetting records alone", () => {
  const ious = [
    { id: "a", person: "Sam", amount: 32, direction: "owed_to_me", reason: "", date: "2026-07-01", accountId: "", settled: false, settledDate: "" },
    { id: "b", person: "Sam", amount: 20, direction: "i_owe", reason: "", date: "2026-07-01", accountId: "", settled: false, settledDate: "" }
  ];
  const result = settleUpPersonIous(ious, "Sam", 12, "2026-07-15", () => "remainder");
  assert.ok(result.ok);
  if (!result.ok) return;
  const untouched = result.ious.find((iou) => iou.id === "b");
  assert.ok(untouched);
  assert.equal(untouched?.settled, false);
});

test("friendsWithoutEmailFromIous returns distinct names not already known, skipping ones already tracked", () => {
  const ious = [
    { id: "a", person: "Sam", amount: 10, direction: "owed_to_me", reason: "", date: "", accountId: "", settled: false, settledDate: "" },
    { id: "b", person: "Priya", amount: 5, direction: "owed_to_me", reason: "", date: "", accountId: "", settled: false, settledDate: "" },
    { id: "c", person: "sam", amount: 3, direction: "owed_to_me", reason: "", date: "", accountId: "", settled: false, settledDate: "" }
  ];
  const names = friendsWithoutEmailFromIous(ious, new Set(["priya"]));
  assert.deepEqual(names, ["Sam"]);
});
