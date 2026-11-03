import assert from "node:assert/strict";
import test from "node:test";
import { accountBalance, accountCashBalance, accountNetWorthValue, accountsWithBalances, computeNetWorthAtDate } from "../src/wealthLogic.ts";
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
