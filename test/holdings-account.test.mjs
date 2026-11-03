import assert from "node:assert/strict";
import test from "node:test";
import { accountBalance, accountCashBalance, accountNetWorthValue, accountsWithBalances, computeNetWorthAtDate, updateHolding, assetClassLabelForHoldings } from "../src/wealthLogic.ts";
import { reconcileMappedBalances } from "../src/linkedAccountsLogic.ts";

const TODAY = "2026-11-02";
const fund = (id, value) => ({ id, name: id, assetClass: "stock", symbol: "", shares: 1, price: value, costBasis: 0, holdingType: "fund", groupId: "g1", groupName: "College 529" });
const baseState = (overrides = {}) => ({
  accounts: [
    { id: "chk", name: "Checking", type: "checking", openingBalance: 1000, netWorthAssetId: "nw-chk", netWorthLiabilityId: "", createdAt: "2026-01-01" },
    { id: "inv", name: "College 529", type: "investment", openingBalance: 0, netWorthAssetId: "nw-inv", netWorthLiabilityId: "", createdAt: "2026-01-01", holdingsGroupId: "g1" }
  ],
  transactions: [], paychecks: [], paycheckOccurrences: [], transfers: [], ious: [],
  goals: { netWorth: { assets: [{ id: "nw-chk", name: "Checking", value: 1000, assetClass: "cash" }, { id: "nw-inv", name: "College 529", value: 0, assetClass: "cash" }, fund("growth", 420), fund("bond", 164)], liabilities: [] }, debts: [] },
  ...overrides
});
const ctx = (state) => ({ accounts: state.accounts, transactions: state.transactions, paychecks: state.paychecks, paycheckOccurrences: state.paycheckOccurrences, transfers: state.transfers, ious: state.ious, assets: state.goals.netWorth.assets });

test("an account that holds investments is worth its holdings plus its cash, and net worth counts them once", () => {
  const state = baseState({ transfers: [{ id: "t1", date: "2026-11-01", fromAccountId: "chk", toAccountId: "inv", amount: 300, memo: "" }] });
  assert.equal(accountCashBalance("inv", ctx(state), TODAY), 300);
  assert.equal(accountBalance("inv", ctx(state), TODAY), 884);
  assert.equal(accountNetWorthValue("inv", ctx(state), TODAY), 300);
  const listed = accountsWithBalances(state, TODAY).find((account) => account.id === "inv");
  assert.deepEqual([listed.balance, listed.cashBalance], [884, 300]);
  assert.equal(computeNetWorthAtDate(state, TODAY), 700 + 884, "checking after the transfer plus the 529's holdings and cash, nothing twice");
});

test("a bank sync of an account that holds investments matches holdings plus cash to the bank without rewriting the opening balance", () => {
  const state = baseState({ transfers: [{ id: "t1", date: "2026-11-01", fromAccountId: "chk", toAccountId: "inv", amount: 300, memo: "" }] });
  const balanceOf = (st, id) => accountsWithBalances(st, TODAY).find((account) => account.id === id)?.balance || 0;
  const { state: next } = reconcileMappedBalances(state, { A1: { accountId: "inv" } }, [{ remoteId: "A1", name: "529", orgName: "", balance: 1000 }], balanceOf, { linkId: "L1", createId: (seed) => `${seed}-1` });
  assert.equal(accountBalance("inv", ctx(next), TODAY), 1000);
  assert.equal(next.accounts.find((account) => account.id === "inv").openingBalance, 0);
  assert.equal(next.goals.netWorth.assets.filter((item) => item.linkedTo).length, 1);
});

test("a holding switched to Cash keeps its dollar value and drops the symbol, shares, cost and price; a group of only cash is labelled Cash", () => {
  const cash = updateHolding({ ...fund("mm", 250), symbol: "ABC", costBasis: 10, shares: 5, price: 50 }, "holdingType", "cash");
  assert.deepEqual([cash.holdingType, cash.symbol, cash.shares, cash.price, cash.value, cash.costBasis, cash.name], ["cash", "", 1, 250, 250, 0, "College 529 - Cash"]);
  assert.equal(assetClassLabelForHoldings([cash]), "Cash");
  assert.equal(assetClassLabelForHoldings([cash, fund("growth", 100)]), "Mixed");
  assert.equal(updateHolding(cash, "holdingType", "fund").holdingType, "fund");
});

import { startTrackingHoldings, stopTrackingHoldings, addHoldingToAccount, holdingsGroupTotal } from "../src/wealthLogic.ts";

const plainState = (opening = 1200) => ({
  accounts: [{ id: "inv", name: "College 529", type: "investment", openingBalance: opening, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "2026-01-01" }],
  transactions: [], paychecks: [], paycheckOccurrences: [], transfers: [], ious: [],
  goals: { netWorth: { assets: [], liabilities: [] }, debts: [] }
});
const ids = () => { let n = 0; return (seed) => `${seed}-${++n}`; };

test("Track holdings moves the balance into a placeholder holding, gives the account a cash line, and leaves balance and net worth unchanged", () => {
  const state = plainState();
  const next = startTrackingHoldings(state, "inv", TODAY, ids());
  const account = next.accounts[0];
  assert.ok(account.holdingsGroupId);
  assert.equal(account.openingBalance, 0);
  const held = next.goals.netWorth.assets.filter((item) => item.groupId === account.holdingsGroupId);
  assert.deepEqual(held.map((item) => [item.name, item.value]), [["Balance before holdings", 1200]]);
  assert.ok(account.netWorthAssetId && next.goals.netWorth.assets.some((item) => item.id === account.netWorthAssetId && item.assetClass === "cash"));
  assert.equal(accountBalance("inv", ctx(next), TODAY), 1200);
  assert.equal(computeNetWorthAtDate(next, TODAY), 1200);
});

test("Track holdings on an empty account makes a 'New holding', and tracking twice or a card does nothing", () => {
  const next = startTrackingHoldings(plainState(0), "inv", TODAY, ids());
  assert.equal(next.goals.netWorth.assets[0].name, "New holding");
  assert.equal(startTrackingHoldings(next, "inv", TODAY, ids()), next);
  const card = plainState(); card.accounts[0].type = "credit_card";
  assert.equal(startTrackingHoldings(card, "inv", TODAY, ids()), card);
});

test("Stop tracking removes the holdings and hands their value back to the opening balance; a transfer in as cash survives the round trip", () => {
  let state = startTrackingHoldings(plainState(), "inv", TODAY, ids());
  state = { ...state, accounts: [...state.accounts, { id: "chk", name: "Checking", type: "checking", openingBalance: 500, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "2026-01-01" }], transfers: [{ id: "t", date: "2026-11-01", fromAccountId: "chk", toAccountId: "inv", amount: 300, memo: "" }] };
  assert.equal(accountBalance("inv", ctx(state), TODAY), 1500, "holdings plus the cash that came in");
  const stopped = stopTrackingHoldings(state, "inv");
  assert.equal(stopped.accounts.find((account) => account.id === "inv").holdingsGroupId, "");
  assert.equal(stopped.goals.netWorth.assets.some((item) => item.groupId), false);
  assert.equal(accountBalance("inv", ctx(stopped), TODAY), 1500);
  assert.equal(stopTrackingHoldings(stopped, "inv"), stopped);
});

test("a tracked account whose holdings were all deleted can get a blank holding back", () => {
  let state = startTrackingHoldings(plainState(), "inv", TODAY, ids());
  const groupId = state.accounts[0].holdingsGroupId;
  state = { ...state, goals: { ...state.goals, netWorth: { ...state.goals.netWorth, assets: state.goals.netWorth.assets.filter((item) => item.groupId !== groupId) } } };
  const next = addHoldingToAccount(state, "inv", ids());
  assert.deepEqual(next.goals.netWorth.assets.filter((item) => item.groupId === groupId).map((item) => item.name), ["New holding"]);
  assert.equal(holdingsGroupTotal(next.goals.netWorth.assets, groupId), 0);
});
