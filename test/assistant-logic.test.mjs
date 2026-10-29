import assert from "node:assert/strict";
import test from "node:test";
import { assistantContext, assistantActionProblem, describeAssistantAction, applyAssistantActions } from "../src/assistantLogic.ts";
import { groupStockHoldings, assetValue } from "../src/wealthLogic.ts";
import { setPayeeRule, categorizationRuleForPayee } from "../src/bankStreamLogic.ts";

const deps = { groupStockHoldings, assetValue, setPayeeRule };
const TODAY = "2026-10-29";
const money = (value) => `$${Number(value).toFixed(2)}`;
const household = () => ({
  household: { name: "H", country: "US", currency: "USD", activity: [] },
  budget: { month: "2026-10", income: 0, categories: [{ name: "Food", color: "", lines: [{ id: "groceries", name: "Groceries", planned: 400 }] }] },
  accounts: [{ id: "chk", name: "Checking", type: "checking", openingBalance: 0 }, { id: "sav", name: "Savings", type: "savings", openingBalance: 0 }],
  transactions: [{ accountId: "sav", date: "2026-10-20", payee: "X", amount: 5, lineId: "" }],
  transactionInboxDrafts: [], transactionInboxDone: [], transfers: [],
  goals: { netWorth: { assets: [
    { id: "m1-a", name: "VTI", assetClass: "stock", shares: 10, price: 200, groupId: "m1", groupName: "Sample M1" },
    { id: "m1-b", name: "VXUS", assetClass: "stock", shares: 5, price: 60, groupId: "m1", groupName: "Sample M1" },
    { id: "fid-a", name: "FXAIX", assetClass: "stock", shares: 2, price: 100, groupId: "fid", groupName: "Sample Fidelity" },
    { id: "cash-1", name: "Cash", assetClass: "cash", value: 500 }
  ], liabilities: [] }, debts: [], sinkingFunds: [] }
});

test("the assistant's context is a small id summary of accounts, holdings groups and budget lines", () => {
  const context = assistantContext(household(), deps);
  assert.deepEqual(context.groups.map((g) => [g.groupId, g.holdings]), [["m1", 2], ["fid", 1]]);
  assert.deepEqual(context.lines, [{ id: "groceries", label: "Food - Groceries" }]);
  assert.equal(JSON.stringify(context).includes("amount"), false, "no transactions are sent");
});

test("the confirmation is written from the household's data; actions that cannot run are reported", () => {
  const state = household();
  assert.match(describeAssistantAction({ type: "merge_holdings_group", fromGroupId: "m1", intoGroupId: "fid" }, state, money, TODAY, deps), /Move all 2 holdings \(about \$2300\.00\) from "Sample M1" into "Sample Fidelity".*net worth stays the same/);
  assert.match(describeAssistantAction({ type: "close_account", accountId: "sav", closedAt: "2026-10-01" }, state, money, TODAY, deps), /1 existing transaction is dated after it/);
  assert.equal(assistantActionProblem({ type: "merge_holdings_group", fromGroupId: "m1", intoGroupId: "m1" }, state, TODAY, deps), "Those are the same group.");
  assert.match(assistantActionProblem({ type: "close_account", accountId: "chk", closedAt: "2026-12-01" }, state, TODAY, deps), /future/);
  assert.match(assistantActionProblem({ type: "rename_account", accountId: "chk", name: "savings" }, state, TODAY, deps), /already called/);
  assert.match(assistantActionProblem({ type: "close_account", accountId: "gone" }, state, TODAY, deps), /no longer exists/);
});

test("confirmed actions change only what they name, never mutate the input, and Undo puts back exactly what changed", () => {
  const state = household();
  const before = JSON.stringify(state);
  const result = applyAssistantActions(state, [
    { type: "merge_holdings_group", fromGroupId: "m1", intoGroupId: "fid" },
    { type: "close_account", accountId: "sav" },
    { type: "rename_account", accountId: "chk", name: "Everyday" },
    { type: "set_payee_category", payee: "Sample Store*A1", lineId: "groceries" },
    { type: "close_account", accountId: "gone" }
  ], TODAY, deps);
  assert.equal(JSON.stringify(state), before);
  assert.equal(result.applied.length, 4);
  assert.deepEqual(result.skipped.map((s) => s.action.accountId), ["gone"]);
  const next = { ...state, ...result.patch };
  assert.deepEqual(next.goals.netWorth.assets.filter((a) => a.groupId === "fid").map((a) => a.id).sort(), ["fid-a", "m1-a", "m1-b"]);
  assert.equal(next.goals.netWorth.assets.find((a) => a.id === "cash-1").groupId, undefined);
  assert.deepEqual([next.accounts.find((a) => a.id === "sav").closedAt, next.accounts.find((a) => a.id === "chk").name], [TODAY, "Everyday"]);
  assert.equal(categorizationRuleForPayee(next.transactionCategorizationRules, "Sample Store*Z9"), "groceries");
  const restored = { ...next, ...result.undo };
  assert.deepEqual(restored.goals, state.goals);
  assert.deepEqual(restored.accounts, state.accounts);
  assert.equal(restored.transactionCategorizationRules, undefined);
});
