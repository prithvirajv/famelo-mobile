import test from "node:test";
import assert from "node:assert/strict";
import { explainSyncFailure, householdSizeInfo, historyImportFits, bankSyncProblems } from "../src/linkedAccountsLogic.ts";
import { exceedsStateLimit, HOUSEHOLD_STATE_SOFT_LIMIT_BYTES } from "../src/bankStreamLogic.ts";

test("a failed run is explained in plain words", () => {
  assert.match(explainSyncFailure("Could not load the new transactions: Importing 4 transactions would push the household data past the size that can be saved").summary, /too big/);
  assert.match(explainSyncFailure("Auth required").summary, /sign in/);
  assert.match(explainSyncFailure("").summary, /did not report/);
  const problems = bankSyncProblems([{ id: "l", label: "Bank", status: "active", mappings: { a: { accountId: "x" } }, lastRun: { ok: false, error: "Could not load the new transactions: past the size that can be saved" } }], [], "2026-11-24", (k) => k);
  assert.match(problems[0].detail, /did not finish.*too big.*Nothing is lost/);
});

test("the import limits match the server's 4 MB save", () => {
  assert.equal(HOUSEHOLD_STATE_SOFT_LIMIT_BYTES, 3_500_000);
  assert.equal(exceedsStateLimit({ x: "a".repeat(1_100_000) }), false, "a household past the old 1 MB limit is fine");
  assert.equal(historyImportFits(1_100_000, 150), true);
  assert.equal(historyImportFits(3_480_000, 150), false);
});

test("the size meter warns at 75% and 90%", () => {
  assert.equal(householdSizeInfo({ x: "a".repeat(1_000_000) }).level, "ok");
  assert.equal(householdSizeInfo({ x: "a".repeat(2_700_000) }).level, "warn");
  assert.equal(householdSizeInfo({ x: "a".repeat(3_300_000) }).level, "full");
  assert.match(householdSizeInfo({ x: "a".repeat(1_000_000) }).label, /of 3\.5 MB/);
});
