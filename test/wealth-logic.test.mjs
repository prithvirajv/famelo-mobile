import assert from "node:assert/strict";
import test from "node:test";
import {
  isHoldingAssetClass, groupStockHoldings, assetClassLabelForHoldings, holdingGainLoss, groupGainLoss,
  debtPayoffProgressPercent, assetValue, computeTrailingMonthKeys, accountBalance, accountsWithBalances,
  computeNetWorthAtDate, computeNetWorthTrend, accountAllowsDate, applyDebtPayment
} from "../src/wealthLogic.ts";

test("isHoldingAssetClass is true for stock and retirement, false for everything else", () => {
  assert.equal(isHoldingAssetClass("stock"), true);
  assert.equal(isHoldingAssetClass("retirement"), true);
  assert.equal(isHoldingAssetClass("cash"), false);
  assert.equal(isHoldingAssetClass("property"), false);
  assert.equal(isHoldingAssetClass(undefined), false);
});

test("groupStockHoldings groups holdings that share a groupId into one card, in first-seen order", () => {
  const assets = [
    { id: "a1", groupId: "g1", groupName: "Brokerage M2", name: "AAPL", assetClass: "stock", value: 0 },
    { id: "cash1", name: "Cash", assetClass: "cash", value: 500 },
    { id: "a2", groupId: "g1", groupName: "Brokerage M2", name: "HD", assetClass: "stock", value: 0 }
  ];
  const groups = groupStockHoldings(assets);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupId, "g1");
  assert.equal(groups[0].groupName, "Brokerage M2");
  assert.deepEqual(groups[0].items.map((item) => item.id), ["a1", "a2"]);
});

test("groupStockHoldings falls back to a holding's own id as its group when it has no groupId (legacy solo holding)", () => {
  const assets = [{ id: "solo-1", name: "401k VTSAX", assetClass: "stock", value: 0 }];
  const groups = groupStockHoldings(assets);
  assert.deepEqual(groups, [{ groupId: "solo-1", groupName: "401k VTSAX", items: assets }]);
});

test("groupStockHoldings also groups retirement holdings, the same as stock", () => {
  const assets = [
    { id: "r1", groupId: "g1", groupName: "401(k) - Fidelity", name: "FXAIX", assetClass: "retirement", value: 0 },
    { id: "r2", groupId: "g1", groupName: "401(k) - Fidelity", name: "FSKAX", assetClass: "retirement", value: 0 },
    { id: "cash1", name: "Cash", assetClass: "cash", value: 500 }
  ];
  const groups = groupStockHoldings(assets);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map((item) => item.id), ["r1", "r2"]);
});

test("assetClassLabelForHoldings labels a group Stocks, Mutual Funds, or Mixed", () => {
  assert.equal(assetClassLabelForHoldings([{ holdingType: "stock" }, { holdingType: "stock" }]), "Stocks");
  assert.equal(assetClassLabelForHoldings([{ holdingType: "fund" }]), "Mutual Funds");
  assert.equal(assetClassLabelForHoldings([{ holdingType: "stock" }, { holdingType: "fund" }]), "Mixed");
  assert.equal(assetClassLabelForHoldings([{}]), "Stocks", "a holding with no holdingType defaults to stock");
});

test("debtPayoffProgressPercent derives percent paid off from balance + payment history, with no original-balance field to rely on", () => {
  assert.equal(debtPayoffProgressPercent({ balance: 8000, payments: [{ principal: 1000 }, { principal: 1000 }] }), 20);
  assert.equal(debtPayoffProgressPercent({ balance: 5000, payments: [] }), 0, "no payments yet means 0% paid off, not a divide-by-zero crash");
  assert.equal(debtPayoffProgressPercent({ balance: 0, payments: [] }), 0, "no balance and no payments is 0%, not NaN");
});

test("holdingGainLoss computes $ and % gain from cost basis vs current price", () => {
  const gain = holdingGainLoss({ shares: 10, price: 220, costBasis: 200 });
  assert.equal(gain.amount, 200);
  assert.equal(gain.percent, 10);
  assert.equal(gain.hasCostBasis, true);

  const loss = holdingGainLoss({ shares: 5, price: 90, costBasis: 100 });
  assert.equal(loss.amount, -50);
  assert.equal(loss.percent, -10);
});

test("holdingGainLoss reports hasCostBasis:false instead of a false -100% when no cost basis was ever set", () => {
  const result = holdingGainLoss({ shares: 10, price: 220, costBasis: 0 });
  assert.equal(result.hasCostBasis, false);
  assert.equal(result.amount, 0);
  assert.equal(result.percent, 0);
});

test("groupGainLoss aggregates only holdings that have a cost basis set, not treating unpriced ones as break-even", () => {
  const items = [
    { shares: 10, price: 220, costBasis: 200 },
    { shares: 5, price: 90, costBasis: 100 },
    { shares: 3, price: 50, costBasis: 0 }
  ];
  const result = groupGainLoss(items);
  assert.equal(result.hasCostBasis, true);
  assert.equal(result.amount, 150);
  assert.equal(result.percent, 6);
});

test("groupGainLoss returns hasCostBasis:false when no holding in the group has a cost basis", () => {
  const result = groupGainLoss([{ shares: 10, price: 220, costBasis: 0 }]);
  assert.deepEqual(result, { amount: 0, percent: 0, hasCostBasis: false });
});

test("assetValue computes a stock holding from shares * price, or reads .value directly otherwise, clamping negatives to 0", () => {
  assert.equal(assetValue({ assetClass: "stock", shares: 10, price: 25.5, value: 0 }), 255);
  assert.equal(assetValue({ assetClass: "retirement", shares: 1094.96, price: 252.44, value: 0 }), 1094.96 * 252.44, "a share-based retirement holding goes through the same shares * price math as stock, not the raw .value fallback");
  assert.equal(assetValue({ assetClass: "retirement", value: 18500 }), 18500, "a flat legacy retirement entry with no shares field still reads .value directly");
  assert.equal(assetValue({ value: 400 }), 400);
  assert.equal(assetValue({ value: -50 }), 0, "a negative plain value clamps to 0, not a negative asset");
  assert.equal(assetValue({ assetClass: "stock", shares: -5, price: 10, value: 0 }), 0, "negative shares clamp to 0 before multiplying");
});

test("computeTrailingMonthKeys lists the N months ending at the given month, inclusive, rolling back across a year boundary", () => {
  assert.deepEqual(computeTrailingMonthKeys("2026-03", 3), ["2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(computeTrailingMonthKeys("2026-02", 4), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});

function emptyContext(overrides = {}) {
  return { accounts: [], transactions: [], paychecks: [], paycheckOccurrences: [], transfers: [], ious: [], ...overrides };
}

test("accountBalance: checking account with one paycheck deposit and no purchases", () => {
  const accounts = [{ id: "checking", name: "Checking", type: "checking", openingBalance: 100, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }];
  const paychecks = [{ id: "p1", date: "2026-07-01", name: "Pay", recurrence: "once", amount: 2600, assignedLineIds: [], depositAccountId: "checking" }];
  const balance = accountBalance("checking", emptyContext({ accounts, paychecks }), "2026-07-11");
  assert.equal(balance, 2700);
});

test("accountBalance: a purchase linked to the account reduces its balance, an unlinked purchase does not", () => {
  const accounts = [{ id: "checking", name: "Checking", type: "checking", openingBalance: 1000, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }];
  const transactions = [
    { date: "2026-07-05", payee: "", lineId: "", amount: 50, accountId: "checking" },
    { date: "2026-07-05", payee: "", lineId: "", amount: 999, accountId: "" }
  ];
  const balance = accountBalance("checking", emptyContext({ accounts, transactions }), "2026-07-11");
  assert.equal(balance, 950);
});

test("accountBalance: a credit card's owed balance increases with a purchase and no payments", () => {
  const accounts = [{ id: "card", name: "Card", type: "credit_card", openingBalance: 0, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }];
  const transactions = [{ date: "2026-07-05", payee: "", lineId: "", amount: 120, accountId: "card" }];
  const balance = accountBalance("card", emptyContext({ accounts, transactions }), "2026-07-11");
  assert.equal(balance, 120);
});

test("accountBalance: paying off a credit card via one transfer reduces both the checking and card balances", () => {
  const accounts = [
    { id: "checking", name: "Checking", type: "checking", openingBalance: 2000, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" },
    { id: "card", name: "Card", type: "credit_card", openingBalance: 0, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }
  ];
  const transactions = [{ date: "2026-07-05", payee: "", lineId: "", amount: 300, accountId: "card" }];
  const transfers = [{ date: "2026-07-08", fromAccountId: "checking", toAccountId: "card", amount: 300 }];
  const context = emptyContext({ accounts, transactions, transfers });
  assert.equal(accountBalance("checking", context, "2026-07-11"), 1700);
  assert.equal(accountBalance("card", context, "2026-07-11"), 0);
});

test("accountBalance: a historical query excludes transactions and transfers dated after the reference date", () => {
  const accounts = [
    { id: "checking", name: "Checking", type: "checking", openingBalance: 1000, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" },
    { id: "card", name: "Card", type: "credit_card", openingBalance: 0, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }
  ];
  const transactions = [
    { date: "2026-06-01", payee: "", lineId: "", amount: 50, accountId: "checking" },
    { date: "2026-08-01", payee: "", lineId: "", amount: 200, accountId: "checking" }
  ];
  const transfers = [{ date: "2026-08-05", fromAccountId: "checking", toAccountId: "card", amount: 40 }];
  const context = emptyContext({ accounts, transactions, transfers });
  assert.equal(accountBalance("checking", context, "2026-07-01"), 950);
  assert.equal(accountBalance("checking", context, "2026-09-01"), 710);
});

test("accountBalance returns 0 for an unknown or deleted account id", () => {
  assert.equal(accountBalance("does-not-exist", emptyContext(), "2026-07-11"), 0);
});

test("accountBalance: borrowing money is an immediate cash inflow, still outstanding", () => {
  const accounts = [{ id: "checking", name: "Checking", type: "checking", openingBalance: 100, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }];
  const ious = [{ id: "i1", person: "Sam", direction: "i_owe", amount: 45, reason: "", date: "2026-07-05", accountId: "checking", settled: false, settledDate: "" }];
  const balance = accountBalance("checking", emptyContext({ accounts, ious }), "2026-07-11");
  assert.equal(balance, 145);
});

test("accountBalance: paying back a borrowed IOU nets it back out once settled", () => {
  const accounts = [{ id: "checking", name: "Checking", type: "checking", openingBalance: 100, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }];
  const ious = [{ id: "i1", person: "Sam", direction: "i_owe", amount: 45, reason: "", date: "2026-07-05", accountId: "checking", settled: true, settledDate: "2026-07-09" }];
  const context = emptyContext({ accounts, ious });
  assert.equal(accountBalance("checking", context, "2026-07-08"), 145);
  assert.equal(accountBalance("checking", context, "2026-07-10"), 100);
});

test("accountBalance: a split expense owed to you does not affect the account until settled", () => {
  const accounts = [{ id: "checking", name: "Checking", type: "checking", openingBalance: 100, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }];
  const unsettled = [{ id: "i1", person: "Priya", direction: "owed_to_me", amount: 33, reason: "", date: "2026-07-05", accountId: "checking", settled: false, settledDate: "" }];
  assert.equal(accountBalance("checking", emptyContext({ accounts, ious: unsettled }), "2026-07-11"), 100);
  const settled = [{ ...unsettled[0], settled: true, settledDate: "2026-07-09" }];
  assert.equal(accountBalance("checking", emptyContext({ accounts, ious: settled }), "2026-07-11"), 133);
});

test("accountBalance: an IOU linked to a different account does not leak into this one", () => {
  const accounts = [
    { id: "checking", name: "Checking", type: "checking", openingBalance: 100, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" },
    { id: "savings", name: "Savings", type: "savings", openingBalance: 100, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }
  ];
  const ious = [{ id: "i1", person: "Sam", direction: "i_owe", amount: 45, reason: "", date: "2026-07-05", accountId: "savings", settled: false, settledDate: "" }];
  assert.equal(accountBalance("checking", emptyContext({ accounts, ious }), "2026-07-11"), 100);
});

test("accountsWithBalances maps every account to its computed balance", () => {
  const state = {
    accounts: [{ id: "checking", name: "Checking", type: "checking", openingBalance: 500, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" }],
    transactions: [], paychecks: [], paycheckOccurrences: [], transfers: [], ious: []
  };
  const result = accountsWithBalances(state, "2026-07-11");
  assert.equal(result.length, 1);
  assert.equal(result[0].balance, 500);
  assert.equal(result[0].id, "checking");
});

test("computeNetWorthAtDate sums unlinked assets/liabilities directly and linked ones via accountBalance instead of their own stored value", () => {
  const state = {
    accounts: [{ id: "savings", name: "Savings", type: "checking", openingBalance: 5000, netWorthAssetId: "investments", netWorthLiabilityId: "", createdAt: "" }],
    transactions: [], paychecks: [], paycheckOccurrences: [], transfers: [], ious: [],
    goals: {
      // "investments" is linked to the savings account, so its own .value (999999) must be ignored in favor of the account's real balance.
      netWorth: { assets: [{ id: "house", name: "House", value: 300000 }, { id: "investments", name: "Investments", value: 999999 }], liabilities: [{ id: "car-loan", name: "Car loan", value: 20000 }] }
    }
  };
  assert.equal(computeNetWorthAtDate(state, "2026-06-30"), 300000 + 5000 - 20000);
});

test("computeNetWorthTrend maps each month key to its net worth at that month's end date", () => {
  const state = {
    accounts: [], transactions: [], paychecks: [], paycheckOccurrences: [], transfers: [], ious: [],
    goals: { netWorth: { assets: [{ id: "cash", name: "Cash", value: 1000 }], liabilities: [] } }
  };
  const trend = computeNetWorthTrend(state, ["2026-05", "2026-06"]);
  assert.deepEqual(trend, [{ month: "2026-05", value: 1000 }, { month: "2026-06", value: 1000 }]);
});

test("applyDebtPayment splits a payment into interest and principal based on the current balance and annual rate", () => {
  const debt = { name: "Car loan", balance: 10000, rate: 6, minimum: 200, payments: [] };
  // Monthly interest at 6% APR on 10000 = 10000 * 6 / 1200 = 50.
  const result = applyDebtPayment(debt, 300, "2026-07-01", () => "payment-1");
  assert.ok(result);
  assert.equal(result.payment.interest, 50);
  assert.equal(result.payment.principal, 250);
  assert.equal(result.debt.balance, 9750);
  assert.equal(result.debt.payments.length, 1);
  assert.equal(result.debt.payments[0].id, "payment-1");
});

test("applyDebtPayment caps an overpayment at fully paying off the debt, never going negative", () => {
  const debt = { name: "Small balance", balance: 100, rate: 0, minimum: 10, payments: [] };
  const result = applyDebtPayment(debt, 10000, "2026-07-01", () => "payment-1");
  assert.ok(result);
  assert.equal(result.debt.balance, 0);
  assert.equal(result.payment.principal, 100);
});

test("applyDebtPayment returns null for a debt that's already fully paid off", () => {
  assert.equal(applyDebtPayment({ name: "Paid off", balance: 0, rate: 5, minimum: 0, payments: [] }, 100, "2026-07-01", () => "x"), null);
});

test("applyDebtPayment prepends the new payment, keeping existing history", () => {
  const debt = { name: "Card", balance: 1000, rate: 0, minimum: 50, payments: [{ id: "old", date: "2026-06-01", amount: 50, principal: 50, interest: 0, extra: 0 }] };
  const result = applyDebtPayment(debt, 50, "2026-07-01", () => "new");
  assert.ok(result);
  assert.deepEqual(result.debt.payments.map((payment) => payment.id), ["new", "old"]);
});

test("accountAllowsDate blocks a new entry dated after closedAt but still allows backdating", () => {
  const closed = { id: "old", name: "Old", type: "checking", openingBalance: 0, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "", closedAt: "2026-06-30" };
  assert.equal(accountAllowsDate(closed, "2026-06-30"), true, "on the close date itself is still allowed");
  assert.equal(accountAllowsDate(closed, "2026-06-15"), true, "backdated entries are allowed");
  assert.equal(accountAllowsDate(closed, "2026-07-01"), false, "a date after closedAt is blocked");
  const open = { id: "open", name: "Open", type: "checking", openingBalance: 0, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "" };
  assert.equal(accountAllowsDate(open, "2099-01-01"), true, "an open account (no closedAt) allows any date");
  assert.equal(accountAllowsDate(undefined, "2026-07-01"), true, "no account at all is not itself a reason to block");
});
