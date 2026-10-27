import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBankStreamDrafts, updateDraft, clearHistorySuggestions, draftsNeedingAi, applyAiSuggestions, autoAcceptDecision, autoAcceptSafeDrafts, importSummary, matchesRecordedPaycheck, acceptDraft, adoptPostedRefunds, refundMatch
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
  // The unsure AI guess goes in without its category (nothing is counted against a line it may have got wrong); the duplicate and the
  // row with no account stay for review.
  assert.equal(result.added, 2);
  assert.equal(result.uncategorized, 1);
  assert.deepEqual(result.state.transactions.map((t) => [t.payee, t.lineId, t.accountId]), [["SAMPLE UNSURE", "", "chk"], ["SAMPLE GROCER", "groceries", "chk"], ["SAMPLE REPEAT", "dining", "chk"]]);
  assert.equal(result.state.transactions[0].memo, "Needs a category");
  assert.equal(result.state.transactions[1].subcategoryName, "Groceries");
  assert.deepEqual(result.state.transactionInboxDrafts.map((d) => d.id).sort(), ["dup", "uncat"]);
  assert.ok(result.state.transactionInboxDone.includes("safe"));
  assert.deepEqual(result.reasons, { "possible duplicate": 1, "no account": 1 });
  assert.equal(state.transactions.length, 1, "input not mutated");
  assert.equal(result.state.household.activity[0], "Assigned SAMPLE UNSURE to no category");
  // A row whose AI call failed is kept for the next pass rather than posted without a category.
  const failed = autoAcceptSafeDrafts(state, ["guess"], true, new Set(["guess"]));
  assert.deepEqual([failed.added, failed.reasons], [0, { "AI did not answer": 1 }]);
});

test("importSummary reads naturally with and without leftovers or an AI failure", () => {
  assert.equal(importSummary("a.csv", 3, 2, 1, 2, { "low confidence": 1, "no category": 1 }), "Imported 3 from a.csv. AI filled in 2 rows. 1 added to the ledger; 2 left in Bank stream to review (1 low confidence, 1 no category).");
  assert.equal(importSummary("a.csv", 1, 0, 1, 0, {}), "Imported 1 from a.csv. 1 added to the ledger.");
  assert.match(importSummary("a.csv", 1, 0, 0, 1, { "no category": 1 }, " AI categorization wasn't available (x) - rows were left for review."), /wasn't available/);
});

test("a linked bank feed also posts deposits, holds back a duplicate of a recorded paycheck, and AI tags are filled in", () => {
  const draft = { lineId: "salary", accountId: "chk", lineSource: "ai-high", isDeposit: true };
  const ctx = { accountsExist: true, possibleDuplicate: false, refundMatch: null, transferMatch: null, accountClosedForDate: false };
  assert.equal(autoAcceptDecision(draft, ctx).reason, "payment or deposit");
  assert.equal(autoAcceptDecision(draft, { ...ctx, bankFeed: true }).accept, true);
  assert.equal(autoAcceptDecision(draft, { ...ctx, bankFeed: true, paycheckMatch: true }).reason, "matches a recorded paycheck");
  const occurrences = [{ depositAccountId: "chk", amount: 2500, date: "2026-03-13" }];
  assert.equal(matchesRecordedPaycheck({ accountId: "chk", amount: -2500, date: "2026-03-14" }, occurrences), true);
  assert.equal(matchesRecordedPaycheck({ accountId: "chk", amount: -2700, date: "2026-03-14" }, occurrences), false);
  assert.equal(matchesRecordedPaycheck({ accountId: "chk", amount: 2500, date: "2026-03-14" }, occurrences), false);
  const state = { drafts: [{ id: "d1", payee: "SAMPLE" }] };
  const applied = applyAiSuggestions({ transactionInboxDrafts: state.drafts, accounts: [], transactions: [] }, [{ id: "d1", lineId: null, accountId: null, confidence: "low", tags: ["subscription", "monthly", "extra"] }]);
  assert.deepEqual(applied.state.transactionInboxDrafts[0].tags, ["subscription", "monthly"]);
});

test("posting a linked row hands its amount back through the opening balance so the synced balance holds", () => {
  const base = {
    household: { name: "H", country: "US", currency: "USD", activity: [] },
    budget: { month: "2026-10", income: 0, categories: [{ name: "Food", color: "", lines: [{ id: "groceries", name: "Groceries", planned: 100 }] }] },
    accounts: [{ id: "chk", name: "Checking", type: "checking", openingBalance: 100 }, { id: "card", name: "Card", type: "credit_card", openingBalance: 100 }],
    transactions: [], transactionInboxDone: []
  };
  const linked = (extra) => ({ ...base, transactionInboxDrafts: [{ id: "d1", payee: "SAMPLE", date: "2026-03-01", lineId: "groceries", accountId: "chk", externalId: "sf:A:1", amount: 40, ...extra }] });
  assert.equal(acceptDraft(linked({}), "d1").state.accounts[0].openingBalance, 140, "money out of checking: balance falls 40, opening gives 40 back");
  assert.equal(acceptDraft(linked({ accountId: "card" }), "d1").state.accounts[1].openingBalance, 60, "a card purchase raises what is owed, so the opening gives it back");
  assert.equal(acceptDraft(linked({ externalId: "" }), "d1").state.accounts[0].openingBalance, 100, "a file import row is a plain addition");
  assert.equal(acceptDraft(linked({ date: "2999-01-01" }), "d1").state.accounts[0].openingBalance, 100, "a future-dated row is not in today's balance yet");
});

test("a card return nets against its purchase: same account and category, posted straight to the ledger with a note", () => {
  const purchase = { date: "2026-10-01", payee: "SAMPLE STORE", amount: 12, lineId: "dining", categoryName: "Food", subcategoryName: "Dining", accountId: "card" };
  const state = baseState({
    accounts: [{ id: "card", name: "Card", type: "credit_card", balance: 0 }, { id: "chk", name: "Checking", type: "checking", balance: 0 }],
    transactions: [purchase],
    transactionInboxDrafts: [draft({ id: "ret", payee: "SAMPLE STORE 12", amount: -12, date: "2026-10-05", accountId: "card", externalId: "sf:c:1" })]
  });
  const adopted = adoptPostedRefunds(state, ["ret"]);
  assert.equal(adopted.adopted, 1);
  assert.equal(adopted.state.transactionInboxDrafts[0].lineId, "dining");
  assert.equal(adopted.state.transactionInboxDrafts[0].lineSource, "refund");
  const posted = autoAcceptSafeDrafts(adopted.state, ["ret"], true);
  assert.equal(posted.added, 1);
  assert.equal(posted.state.transactions[0].amount, -12);
  assert.equal(posted.state.transactions[0].lineId, "dining");
  assert.match(posted.state.transactions[0].memo, /Refund of the 12\.00 purchase on 2026-10-01/);
  // A return whose purchase is still a draft waits for the final pass, and is held if the purchase never posts.
  const waiting = baseState({ transactionInboxDrafts: [
    draft({ id: "buy", payee: "SAMPLE STORE", amount: 12, date: "2026-10-01", lineId: "dining", accountId: "chk", lineSource: "ai-low" }),
    draft({ id: "ret", payee: "SAMPLE STORE", amount: -12, date: "2026-10-05", lineId: "dining", accountId: "chk", lineSource: "refund" })
  ] });
  const early = autoAcceptSafeDrafts(waiting, ["ret"]);
  assert.deepEqual([early.added, early.reasons], [0, {}]);
  assert.deepEqual(autoAcceptSafeDrafts(waiting, ["ret"], true).reasons, { refund: 1 });
});

test("a fuzzy refund match never pairs a credit with a purchase on a different account", () => {
  const purchase = { payee: "SAMPLE STORE", amount: 12, date: "2026-10-01", accountId: "chk" };
  assert.equal(refundMatch({ payee: "SAMPLE STORE", amount: -12, date: "2026-10-05", accountId: "card" }, [purchase]), null);
  assert.equal(refundMatch({ payee: "SAMPLE STORE", amount: -12, date: "2026-10-05", accountId: "chk" }, [purchase]), purchase);
  assert.equal(refundMatch({ payee: "SAMPLE STORE", amount: -12, date: "2026-10-05" }, [purchase]), purchase);
});

test("a bank-feed row with no category at all goes in as Needs a category; a plain file import still holds it", () => {
  const state = baseState({ transactionInboxDrafts: [draft({ id: "blank", payee: "SAMPLE MYSTERY", amount: 8, accountId: "chk", externalId: "sf:1:1", date: "2026-10-02" })] });
  const posted = autoAcceptSafeDrafts(state, ["blank"], true);
  assert.equal(posted.added, 1);
  assert.equal(posted.uncategorized, 1);
  assert.equal(posted.state.transactions[0].lineId, "");
  assert.equal(posted.state.transactions[0].memo, "Needs a category");
  assert.equal(autoAcceptDecision(draft({ accountId: "chk" }), ctx).reason, "no category", "without the bank-feed flag the old rule holds");
  assert.match(importSummary("f", 1, 0, 1, 0, {}, "", false, 1), /1 without a category/);
});
