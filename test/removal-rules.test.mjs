import assert from "node:assert/strict";
import test from "node:test";
import { setRemovalRule, lookupRemovalRule, removeRemovalRule, rememberRemovalReason, rowsSkippedByRemovalRules, autoAcceptDecision, REMOVAL_REASONS, buildBankStreamDrafts, reviewDrafts, depositWorthAsking, planSalaryLearning, learnSalaryFromRemovedDeposit, startPaycheckFromRemovedDeposit } from "../src/bankStreamLogic.ts";

const TODAY = "2026-11-03";
const base = () => ({ household: { name: "H", activity: [] }, transactions: [], paychecks: [], paycheckOccurrences: [], accounts: [{ id: "chk", name: "Checking", type: "checking", openingBalance: 0 }] });

test("a removal rule is kept per payee and direction, matches a differently written payee, and counts repeats", () => {
  let st = setRemovalRule(base(), { payee: "BUSINESS CO*4411 PURCHASE", amount: 40 }, { reason: "Business expense", effect: "hold" }, TODAY);
  assert.deepEqual([st.removalRules[0].direction, st.removalRules[0].effect, st.removalRules[0].count], ["out", "hold", 1]);
  assert.equal(lookupRemovalRule(st.removalRules, { payee: "BUSINESS CO*9087 PURCHASE", amount: 12 }).reason, "Business expense");
  assert.equal(lookupRemovalRule(st.removalRules, { payee: "BUSINESS CO*4411 PURCHASE", amount: -40 }), null);
  st = setRemovalRule(st, { payee: "BUSINESS CO*4411 PURCHASE", amount: 5 }, { reason: "Not mine", effect: "skip" }, TODAY);
  assert.deepEqual([st.removalRules.length, st.removalRules[0].count, st.removalRules[0].effect], [1, 2, "skip"]);
  assert.equal(setRemovalRule(st, { payee: "X CAFE", amount: 3 }, { reason: "anything", effect: "none" }, TODAY), st, "'do nothing special' records nothing");
  assert.equal(removeRemovalRule(st, st.removalRules[0].id).removalRules.length, 0);
});

test("typed reasons are remembered newest first, without repeating the built-in ones", () => {
  let st = rememberRemovalReason(base(), "Reimbursed by work");
  st = rememberRemovalReason(st, "Gift for my sister");
  st = rememberRemovalReason(st, "reimbursed by work");
  st = rememberRemovalReason(st, REMOVAL_REASONS[0].label);
  assert.deepEqual(st.removalReasons, ["reimbursed by work", "Gift for my sister"]);
});

test("a row like one the household removed is never posted on its own, and a refund is not caught by it", () => {
  const rule = { reason: "Business expense", effect: "hold" };
  const ok = { lineId: "groceries", accountId: "chk", lineSource: "history" };
  const ctx = { accountsExist: true, possibleDuplicate: false, accountClosedForDate: false, bankFeed: true, refundMatch: null, transferMatch: null };
  assert.equal(autoAcceptDecision(ok, ctx).accept, true);
  assert.equal(autoAcceptDecision(ok, { ...ctx, removalRule: rule }).reason, "removed before: Business expense");
  assert.equal(autoAcceptDecision({ ...ok, amount: -5 }, { ...ctx, removalRule: rule, refundMatch: { lineId: "groceries" }, refundMatchPosted: true }).accept, true);
});

test("an import or sync leaves out rows a skip rule covers, and a held row shows the rule in review", () => {
  let st = setRemovalRule(base(), { payee: "NOT MINE SHOP", amount: 10 }, { reason: "Not mine", effect: "skip" }, TODAY);
  st = setRemovalRule(st, { payee: "SIDE GIG LLC", amount: 10 }, { reason: "Business expense", effect: "hold" }, TODAY);
  const rows = [{ date: "2026-11-02", payee: "NOT MINE SHOP", amount: 25, externalId: "a" }, { date: "2026-11-02", payee: "SIDE GIG LLC", amount: 14, externalId: "b" }, { date: "2026-11-02", payee: "CAFE", amount: 4, externalId: "c" }];
  assert.deepEqual(rowsSkippedByRemovalRules(rows, st.removalRules).map((r) => r.payee), ["NOT MINE SHOP"]);
  const built = buildBankStreamDrafts({ rows, fileName: "Bank", idPrefix: "linked-import", transactions: [], existingDrafts: [], accounts: st.accounts, rules: {}, createId: (seed) => `${seed}-${Math.random()}`, forcedAccountId: "chk", removalRules: st.removalRules });
  assert.deepEqual(built.drafts.map((d) => d.payee).sort(), ["CAFE", "SIDE GIG LLC"]);
  assert.match(built.message, /Left out 1 row/);
  const review = reviewDrafts({ ...st, transactionInboxDrafts: built.drafts, transactionInboxDone: [], transactionCategorizationRules: {} });
  assert.equal(review.find((d) => d.payee === "SIDE GIG LLC").removalRule.reason, "Business expense");
  assert.equal(review.find((d) => d.payee === "CAFE").removalRule, null);
});

test("'my salary' teaches an existing paycheck (payer and account remembered, income follows on request) or starts a new one at the next payday", () => {
  const row = { accountId: "chk", payee: "ACME CORP DIRECT DEP 123456", amount: -1850, date: "2026-11-03" };
  assert.equal(depositWorthAsking(row, []), true);
  assert.equal(depositWorthAsking({ ...row, payee: "Zelle from Sam" }, []), false);
  assert.equal(depositWorthAsking({ ...row, amount: 50 }, []), false);
  const created = startPaycheckFromRemovedDeposit(base(), row, "biweekly", (seed) => `${seed}-1`);
  const paycheck = created.paychecks[0];
  assert.deepEqual([paycheck.amount, paycheck.recurrence, paycheck.date, paycheck.depositAccountId, paycheck.depositPayeeKeys], [1850, "biweekly", "2026-11-17", "chk", ["acme corp"]]);
  const existing = { ...base(), paychecks: [{ id: "p1", name: "Acme", amount: 1800, recurrence: "biweekly", date: "2026-10-20", assignedLineIds: [] }] };
  assert.equal(planSalaryLearning(existing, row, "p1").differs, true);
  const kept = learnSalaryFromRemovedDeposit(existing, row, "p1", false);
  assert.deepEqual([kept.paychecks[0].amount, kept.paychecks[0].depositAccountId, kept.paychecks[0].depositPayeeKeys], [1800, "chk", ["acme corp"]]);
  assert.equal(learnSalaryFromRemovedDeposit(existing, row, "p1", true).paychecks[0].amount, 1850);
});
