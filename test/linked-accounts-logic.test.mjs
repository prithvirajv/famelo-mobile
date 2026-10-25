import assert from "node:assert/strict";
import test from "node:test";
import {
  selectNewLinkedTransactions, rememberLinkedImportedIds, knownLinkedIds, pendingDraftEffect, reconcileOpeningBalance, reconcileMappedBalances,
  mergeBrokeragePositions, linkNeedsAutoSync, linkedStatusText, simplefinSummary, LINKED_IMPORTED_ID_LIMIT
} from "../src/linkedAccountsLogic.ts";
import { buildBankStreamDrafts, acceptDraft } from "../src/bankStreamLogic.ts";

test("only mapped, never-imported rows come through, and an id repeated within one sync is taken once", () => {
  const mappings = { A1: { accountId: "chk" }, A2: {} };
  const txns = [
    { externalId: "sf:A1:1", remoteAccountId: "A1", amount: 5 }, { externalId: "sf:A1:2", remoteAccountId: "A1", amount: 6 },
    { externalId: "sf:A2:9", remoteAccountId: "A2", amount: 7 }, { externalId: "sf:A1:1", remoteAccountId: "A1", amount: 5 }
  ];
  const result = selectNewLinkedTransactions(txns, mappings, ["sf:A1:2"]);
  assert.deepEqual(result.fresh.map((t) => [t.externalId, t.accountId]), [["sf:A1:1", "chk"]]);
  assert.deepEqual([result.unmapped, result.alreadyImported], [1, 2]);
});

test("imported-id memory appends without repeats, drops the oldest past the cap, and also counts ids already on ledger rows and drafts", () => {
  assert.deepEqual(rememberLinkedImportedIds(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(rememberLinkedImportedIds(undefined, ["x"]), ["x"]);
  const many = Array.from({ length: LINKED_IMPORTED_ID_LIMIT }, (_, i) => `id${i}`);
  const capped = rememberLinkedImportedIds(many, ["new"]);
  assert.deepEqual([capped.length, capped[0], capped[LINKED_IMPORTED_ID_LIMIT - 1]], [LINKED_IMPORTED_ID_LIMIT, "id1", "new"]);
  assert.deepEqual(knownLinkedIds({ linkedImportedIds: ["a"], transactions: [{ externalId: "b" }, {}], transactionInboxDrafts: [{ externalId: "c" }, { externalId: "" }] }).sort(), ["a", "b", "c"]);
});

test("a linked feed's rows land as drafts on the mapped account and keep their externalId through to the ledger", () => {
  const state = {
    household: { name: "H", country: "US", currency: "USD", activity: [] },
    budget: { month: "2026-10", income: 0, categories: [{ name: "Food", color: "", lines: [{ id: "groceries", name: "Groceries", planned: 100 }] }] },
    accounts: [{ id: "chk", name: "Checking", type: "checking", openingBalance: 0 }, { id: "other", name: "Other", type: "checking", openingBalance: 0 }],
    transactions: [], transactionInboxDrafts: [], transactionInboxDone: []
  };
  const built = buildBankStreamDrafts({ rows: [{ date: "2026-10-02", payee: "SAMPLE GROCER", amount: 40.25, externalId: "sf:A1:1" }], fileName: "Other bank statement.csv", idPrefix: "linked-import", transactions: [], existingDrafts: [], accounts: state.accounts, createId: (p) => `${p}-1`, forcedAccountId: "chk" });
  assert.deepEqual([built.drafts[0].accountId, built.drafts[0].externalId, built.matchedAccount?.id], ["chk", "sf:A1:1", "chk"]);
  const accepted = acceptDraft({ ...state, transactionInboxDrafts: [{ ...built.drafts[0], lineId: "groceries" }] }, "linked-import-1");
  assert.equal(accepted.ok && accepted.state.transactions[0].externalId, "sf:A1:1");
});

test("reconciling makes the derived balance match the bank for assets and cards, counting Bank stream rows", () => {
  const checking = { id: "chk", type: "checking", openingBalance: 100 };
  const card = { id: "card", type: "credit_card", openingBalance: 0 };
  const drafts = [{ accountId: "chk", amount: 40 }, { accountId: "card", amount: 25 }, { accountId: "other", amount: 999 }];
  assert.equal(pendingDraftEffect(checking, drafts), -40);
  assert.equal(pendingDraftEffect(card, drafts), 25);
  assert.equal(reconcileOpeningBalance(checking, 90 - 40, 1250.5), 1300.5);
  assert.equal(reconcileOpeningBalance(card, 60 + 25, -310), 225, "a card the bank reports at -310 ends up 310 owed");
  assert.equal(reconcileOpeningBalance(checking, 90, Number.NaN), 100);
  const state = { accounts: [checking, card], transactionInboxDrafts: drafts, transactions: [] };
  const balances = { chk: 90, card: 60 };
  const result = reconcileMappedBalances(state, { R1: { accountId: "chk" }, R2: { accountId: "card" } }, [{ remoteId: "R1", balance: 1250.5 }, { remoteId: "R2", balance: -310 }], (_s, id) => balances[id]);
  assert.equal(result.updated, 2);
  assert.deepEqual(result.state.accounts.map((a) => a.openingBalance), [1300.5, 225]);
  // Once the derived balance (plus the 40 waiting in Bank stream) already equals the bank's, nothing is adjusted.
  const unchanged = reconcileMappedBalances(result.state, { R1: { accountId: "chk" } }, [{ remoteId: "R1", balance: 1250.5 }], () => 1290.5);
  assert.equal(unchanged.updated, 0);
  assert.equal(unchanged.state, result.state);
});

test("brokerage positions merge in place: add, update, adopt a hand-entered holding, remove sold, track cash", () => {
  let counter = 0;
  const createId = (seed) => `${seed}-${++counter}`;
  const positions = [
    { remoteAccountId: "BR-1", symbol: "aapl", name: "Apple", units: 10, price: 200, costBasis: 150, currency: "USD", holdingType: "stock" },
    { remoteAccountId: "BR-1", symbol: "VTSAX", name: "Total Market", units: 5, price: 100, costBasis: 90, currency: "USD", holdingType: "fund" }
  ];
  const accounts = [{ remoteId: "BR-1", name: "Sample Brokerage", orgName: "", currency: "USD", balance: null, balanceDate: "" }];
  const handEntered = { id: "mine", name: "Apple", assetClass: "stock", symbol: "AAPL", shares: 1, price: 1, costBasis: 0, groupId: "g1", groupName: "Fidelity", holdingType: "stock", value: 1 };
  const other = { id: "house", name: "House", assetClass: "other", value: 300000 };
  const mappings = { "BR-1": { groupId: "g1", groupName: "Fidelity" } };
  const first = mergeBrokeragePositions([handEntered, other], { linkId: "L1", positions, cash: { "BR-1": 125.5 }, accounts, mappings }, createId);
  assert.deepEqual([first.added, first.updated, first.removed], [1, 1, 0]);
  const aapl = first.assets.find((a) => a.id === "mine");
  assert.deepEqual([aapl.shares, aapl.price, aapl.costBasis, aapl.value, aapl.linkedTo, aapl.groupId], [10, 200, 150, 2000, "L1:BR-1", "g1"]);
  assert.equal(first.assets.find((a) => a.symbol === "VTSAX").holdingType, "fund");
  assert.equal(first.assets.find((a) => a.assetClass === "cash").value, 125.5);
  assert.ok(first.assets.includes(other));
  const second = mergeBrokeragePositions(first.assets, { linkId: "L1", positions: [positions[0]], cash: { "BR-1": 0 }, accounts, mappings }, createId);
  assert.deepEqual([second.added, second.updated, second.removed], [0, 1, 1]);
  assert.equal(second.assets.find((a) => a.assetClass === "cash").value, 0);
  assert.equal(first.assets.length, 4);
  const fresh = mergeBrokeragePositions([], { linkId: "L2", positions: [{ ...positions[0], remoteAccountId: "BR-9" }], cash: {}, accounts: [{ ...accounts[0], remoteId: "BR-9", name: "Roth IRA" }], mappings: { "BR-9": {} } }, createId);
  assert.deepEqual([fresh.assets[0].groupName, fresh.assets[0].groupId], ["Roth IRA", "linked-L2-BR-9"]);
});

test("status text and auto-sync staleness read sensibly", () => {
  const link = { id: "1", provider: "simplefin", label: "Bank", status: "active", lastSyncAt: null, lastError: "", mappings: { A: { accountId: "x" } } };
  assert.equal(linkedStatusText(link, (iso) => iso), "Not synced yet");
  assert.equal(linkedStatusText({ ...link, lastSyncAt: "T", lastError: "boom" }, (iso) => iso), "Last synced T - boom");
  assert.match(linkedStatusText({ ...link, status: "needs_reconnect" }, (iso) => iso), /Needs reconnecting/);
  const now = Date.parse("2026-10-04T12:00:00Z");
  assert.equal(linkNeedsAutoSync(link, now), true);
  assert.equal(linkNeedsAutoSync({ ...link, lastSyncAt: "2026-10-04T10:00:00Z" }, now), false);
  assert.equal(linkNeedsAutoSync({ ...link, lastSyncAt: "2026-10-04T05:00:00Z" }, now), true);
  assert.equal(linkNeedsAutoSync({ ...link, mappings: {} }, now), false, "nothing chosen yet");
  assert.equal(linkNeedsAutoSync({ ...link, status: "needs_reconnect" }, now), false);
  assert.equal(simplefinSummary("Bank", 2, 1, 1, 0, ["careful"]), "Bank: 2 new transactions sent to Bank stream, 1 balance updated; 1 pending skipped until they post. The bank reported: careful");
});

import { applyBalanceToHoldingsGroup } from "../src/linkedAccountsLogic.ts";

test("an investment account's bank balance tops its holdings group up with one adjustment holding, never negative, and its transactions are not counted as skipped", () => {
  let n = 0;
  const createId = (seed) => `${seed}-${++n}`;
  const holdings = [
    { id: "a", name: "QQQM", assetClass: "stock", symbol: "QQQM", shares: 10, price: 100, groupId: "g1", groupName: "Roth IRA", value: 1000 },
    { id: "b", name: "SPMO", assetClass: "stock", symbol: "SPMO", shares: 5, price: 100, groupId: "g1", groupName: "Roth IRA", value: 500 },
    { id: "z", name: "House", assetClass: "other", value: 300000 }
  ];
  const input = { linkId: "L", remoteId: "R", groupId: "g1", groupName: "Roth IRA", balance: 1800 };
  const first = applyBalanceToHoldingsGroup(holdings, input, createId);
  assert.equal(first.adjustment, 300);
  const adjust = first.assets.find((a) => a.linkedTo === "L:R:adjust");
  assert.deepEqual([adjust.name, adjust.groupId, adjust.value, adjust.shares, adjust.price, adjust.symbol], ["Roth IRA balance adjustment", "g1", 300, 1, 300, ""]);
  assert.equal(holdings.length, 3, "input not mutated");
  const second = applyBalanceToHoldingsGroup(first.assets, { ...input, balance: 1700 }, createId);
  assert.equal(second.assets.filter((a) => a.linkedTo === "L:R:adjust").length, 1);
  assert.equal(second.assets.find((a) => a.linkedTo === "L:R:adjust").value, 200);
  assert.equal(second.assets.find((a) => a.linkedTo === "L:R:adjust").id, adjust.id);
  const ahead = applyBalanceToHoldingsGroup(first.assets, { ...input, balance: 1400 }, createId);
  assert.deepEqual([ahead.adjustment, ahead.assets.some((a) => a.linkedTo === "L:R:adjust")], [0, false]);
  assert.equal(applyBalanceToHoldingsGroup(holdings, { ...input, balance: Number.NaN }, createId).adjustment, 0);
  const result = selectNewLinkedTransactions([{ externalId: "sf:R:1", remoteAccountId: "R", amount: 5 }, { externalId: "sf:Q:1", remoteAccountId: "Q", amount: 5 }], { R: { groupId: "g1" } }, []);
  assert.deepEqual([result.fresh.length, result.unmapped], [0, 1], "only the genuinely unmapped account counts as skipped");
});
