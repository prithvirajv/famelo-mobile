import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBankStreamDrafts, updateDraft, clearHistorySuggestions, draftsNeedingAi, applyAiSuggestions, autoAcceptDecision, autoAcceptSafeDrafts, importSummary
} from "../src/bankStreamLogic.ts";

const line = (id, name) => ({ id, name, planned: 100 });
const baseState = (overrides = {}) => ({
  household: { name: "H", country: "US", currency: "USD", activity: [] },
  budget: { month: "2026-10", income: 0, categories: [{ name: "Food", color: "", lines: [line("groceries", "Groceries"), line("dining", "Dining")] }] },
  accounts: [{ id: "chk", name: "Checking", type: "checking", balance: 0 }],
  transactions: [], transactionInboxDrafts: [], transactionInboxDone: [],
  ...overrides
});
const draft = (overrides = {}) => ({ id: "d1", payee: "SAMPLE SHOP", amount: 10, date: "2026-10-02", lineId: "", accountId: "", ...overrides });
const ctx = { accountsExist: true, possibleDuplicate: false, refundMatch: null, transferMatch: null, accountClosedForDate: false };

test("imported drafts record where their category came from, and a manual pick or clearing resets it", () => {
  const history = [{ date: "2026-09-01", payee: "SAMPLE KNOWN", amount: 5, lineId: "groceries", categoryName: "Food", subcategoryName: "Groceries", accountId: "chk" }];
  const result = buildBankStreamDrafts({
    rows: [{ date: "2026-10-02", payee: "SAMPLE KNOWN", amount: 7 }, { date: "2026-10-02", payee: "SAMPLE NEW", amount: 9 }], fileName: "f.csv", idPrefix: "csv", transactions: history,
    existingDrafts: [], accounts: [], rules: {}, createId: (p) => `${p}-${Math.random()}`
  });
  const bySource = Object.fromEntries(result.drafts.map((d) => [d.payee, d.lineSource]));
  assert.deepEqual(bySource, { "SAMPLE KNOWN": "history", "SAMPLE NEW": "" });
  const state = baseState({ transactionInboxDrafts: [draft({ lineId: "dining", lineSource: "ai-low", historyMatch: true })] });
  const manual = updateDraft(state, "d1", { lineId: "groceries" });
  assert.equal(manual.ok && manual.state.transactionInboxDrafts[0].lineSource, "manual");
  const cleared = updateDraft(state, "d1", { lineId: "" });
  assert.equal(cleared.ok && cleared.state.transactionInboxDrafts[0].lineSource, "");
  assert.equal(clearHistorySuggestions(state).state.transactionInboxDrafts[0].lineSource, "");
});

test("draftsNeedingAi picks rows missing a category, or an account when an open one exists, among the given ids only", () => {
  const state = baseState({ transactionInboxDrafts: [draft({ id: "a" }), draft({ id: "b", lineId: "groceries", accountId: "chk" }), draft({ id: "c", lineId: "groceries" }), draft({ id: "d" })] });
  assert.deepEqual(draftsNeedingAi(state, ["a", "b", "c"]).map((d) => d.id), ["a", "c"]);
  const noAccounts = baseState({ accounts: [{ id: "x", name: "Old", type: "checking", balance: 0, closedAt: "2026-01-01" }], transactionInboxDrafts: [draft({ id: "c", lineId: "groceries" })] });
  assert.deepEqual(draftsNeedingAi(noAccounts, ["c"]), []);
});

test("applyAiSuggestions fills only empty fields, tags confidence, and never overwrites a rule, history or manual choice", () => {
  const state = baseState({ transactionInboxDrafts: [draft({ id: "a" }), draft({ id: "b", lineId: "dining", lineSource: "rule" }), draft({ id: "c" }), draft({ id: "d" })] });
  const { state: next, filled } = applyAiSuggestions(state, [
    { id: "a", lineId: "groceries", accountId: "chk", confidence: "high" },
    { id: "b", lineId: "groceries", accountId: null, confidence: "high" },
    { id: "c", lineId: "dining", accountId: null, confidence: "low" },
    { id: "gone", lineId: "dining", accountId: null, confidence: "high" }
  ]);
  const byId = Object.fromEntries(next.transactionInboxDrafts.map((d) => [d.id, d]));
  assert.deepEqual([byId.a.lineId, byId.a.lineSource, byId.a.accountId], ["groceries", "ai-high", "chk"]);
  assert.deepEqual([byId.b.lineId, byId.b.lineSource], ["dining", "rule"]);
  assert.deepEqual([byId.c.lineId, byId.c.lineSource], ["dining", "ai-low"]);
  assert.equal(byId.d.lineId, "");
  assert.equal(filled, 2);
  assert.equal(applyAiSuggestions(state, []).state, state);
  assert.equal(state.transactionInboxDrafts[0].lineId, "", "input not mutated");
});

test("autoAcceptDecision only passes confident, ordinary rows", () => {
  const ok = draft({ lineId: "groceries", accountId: "chk", lineSource: "ai-high" });
  assert.equal(autoAcceptDecision(ok, ctx).accept, true);
  assert.equal(autoAcceptDecision({ ...ok, lineSource: "history" }, ctx).accept, true);
  assert.equal(autoAcceptDecision({ ...ok, lineSource: "rule" }, ctx).accept, true);
  assert.equal(autoAcceptDecision({ ...ok, lineSource: "ai-low" }, ctx).reason, "low confidence");
  assert.equal(autoAcceptDecision({ ...ok, lineSource: "manual" }, ctx).accept, false);
  assert.equal(autoAcceptDecision({ ...ok, lineSource: "refund" }, ctx).accept, false);
  assert.equal(autoAcceptDecision({ ...ok, lineId: "" }, ctx).reason, "no category");
  assert.equal(autoAcceptDecision({ ...ok, accountId: "" }, ctx).reason, "no account");
  assert.equal(autoAcceptDecision({ ...ok, accountId: "" }, { ...ctx, accountsExist: false }).accept, true);
  for (const [override, reason] of [[{ possibleDuplicate: true }, "possible duplicate"], [{ refundMatch: {} }, "refund"], [{ transferMatch: {} }, "possible transfer"], [{ accountClosedForDate: true }, "account closed"]]) {
    assert.equal(autoAcceptDecision(ok, { ...ctx, ...override }).reason, reason);
  }
  for (const flag of ["isPayment", "isDeposit", "isPending"]) assert.equal(autoAcceptDecision({ ...ok, [flag]: true }, ctx).accept, false);
});

test("autoAcceptSafeDrafts posts safe rows to the ledger with their account and leaves duplicates (of the ledger or of each other) and anything doubtful for review", () => {
  const state = baseState({ transactions: [{ date: "2026-10-02", payee: "SAMPLE REPEAT", amount: 9, lineId: "dining", categoryName: "Food", subcategoryName: "Dining", accountId: "chk" }], transactionInboxDrafts: [
    draft({ id: "safe", payee: "SAMPLE GROCER", amount: 40.25, lineId: "groceries", accountId: "chk", lineSource: "ai-high" }),
    draft({ id: "guess", payee: "SAMPLE UNSURE", amount: 12, lineId: "dining", accountId: "chk", lineSource: "ai-low" }),
    draft({ id: "dup", payee: "SAMPLE REPEAT", amount: 9, lineId: "dining", accountId: "chk", lineSource: "ai-high" }),
    draft({ id: "uncat", payee: "SAMPLE OTHER", amount: 3 })
  ] });
  const result = autoAcceptSafeDrafts(state, ["safe", "guess", "dup", "uncat"]);
  assert.equal(result.added, 1);
  assert.deepEqual(result.state.transactions.map((t) => [t.payee, t.lineId, t.accountId, t.subcategoryName]), [["SAMPLE GROCER", "groceries", "chk", "Groceries"], ["SAMPLE REPEAT", "dining", "chk", "Dining"]]);
  assert.equal(result.state.transactions.length, 2, "only the one safe row was added to the existing ledger entry");
  assert.deepEqual(result.state.transactionInboxDrafts.map((d) => d.id).sort(), ["dup", "guess", "uncat"]);
  assert.ok(result.state.transactionInboxDone.includes("safe"));
  assert.deepEqual(result.reasons, { "low confidence": 1, "possible duplicate": 1, "no category": 1 });
  assert.equal(state.transactions.length, 1, "input not mutated");
  assert.equal(result.state.household.activity[0], "Assigned SAMPLE GROCER to Food - Groceries");
});

test("importSummary reads naturally with and without leftovers or an AI failure", () => {
  assert.equal(importSummary("a.csv", 3, 2, 1, 2, { "low confidence": 1, "no category": 1 }), "Imported 3 from a.csv. AI filled in 2 rows. 1 added to the ledger; 2 left in Bank stream to review (1 low confidence, 1 no category).");
  assert.equal(importSummary("a.csv", 1, 0, 1, 0, {}), "Imported 1 from a.csv. 1 added to the ledger.");
  assert.match(importSummary("a.csv", 1, 0, 0, 1, { "no category": 1 }, " AI categorization wasn't available (x) - rows were left for review."), /wasn't available/);
});
