// Direct TypeScript port of the Wealth-related pure functions in the web app's
// lib/shared-logic.js (household-hub-management-app). Kept behaviorally
// identical on purpose - see each function's comment for the specific gotcha
// it exists to avoid, carried over verbatim from the web source.
import type { Account, Debt, DebtPayment, HouseholdState, Iou, Paycheck, PaycheckOccurrence, Transfer, Transaction, WealthAsset } from "./types";

export function isHoldingAssetClass(assetClass?: string): boolean {
  return assetClass === "stock" || assetClass === "retirement";
}

export type StockHoldingGroup = { groupId: string; groupName: string; items: WealthAsset[] };

// Groups flat net-worth stock/mutual-fund holdings into one card per
// brokerage/retirement account. A holding created via the bulk/manage-holdings
// dialog carries an explicit groupId/groupName; a legacy solo holding (added
// one at a time before grouping existed) has neither, so it falls back to
// being its own single-holding group keyed by its own id - every holding-class
// asset ends up in exactly one group, none dropped silently.
export function groupStockHoldings(assets: WealthAsset[]): StockHoldingGroup[] {
  const groups: StockHoldingGroup[] = [];
  const byKey = new Map<string, StockHoldingGroup>();
  assets.filter((item) => isHoldingAssetClass(item.assetClass)).forEach((item) => {
    const key = item.groupId || item.id || item.name;
    let group = byKey.get(key);
    if (!group) {
      group = { groupId: key, groupName: item.groupName || item.name, items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  });
  return groups;
}

// A grouped holding card shows one label for the whole group ("Stocks",
// "Mutual Funds", or "Mixed") instead of a per-holding asset-class field.
export function assetClassLabelForHoldings(items: WealthAsset[]): "Stocks" | "Mutual Funds" | "Mixed" {
  const types = new Set(items.map((item) => item.holdingType || "stock"));
  if (types.size > 1) return "Mixed";
  return types.has("fund") ? "Mutual Funds" : "Stocks";
}

export type GainLoss = { amount: number; percent: number; hasCostBasis: boolean };

// Gain/loss for one holding, from its average cost basis vs its current
// price. costBasis defaults to 0 (never set) on older holdings, which would
// read as a nonsensical -100% loss - callers should treat hasCostBasis:false
// as "no gain/loss to show" rather than rendering the zeroed-out numbers.
export function holdingGainLoss(item: WealthAsset): GainLoss {
  const shares = Number(item.shares || 0);
  const price = Number(item.price || 0);
  const costBasis = Number(item.costBasis || 0);
  const hasCostBasis = costBasis > 0;
  const amount = hasCostBasis ? (price - costBasis) * shares : 0;
  const percent = hasCostBasis ? ((price - costBasis) / costBasis) * 100 : 0;
  return { amount, percent, hasCostBasis };
}

// Aggregates gain/loss across every holding in a group that has a cost basis
// set - holdings without one are excluded from both sides of the ratio rather
// than silently treated as break-even, which would understate the real
// percent move of the ones that do.
export function groupGainLoss(items: WealthAsset[]): GainLoss {
  const priced = items.filter((item) => Number(item.costBasis || 0) > 0);
  if (!priced.length) return { amount: 0, percent: 0, hasCostBasis: false };
  const amount = priced.reduce((sum, item) => sum + holdingGainLoss(item).amount, 0);
  const costTotal = priced.reduce((sum, item) => sum + Number(item.costBasis || 0) * Number(item.shares || 0), 0);
  const percent = costTotal > 0 ? (amount / costTotal) * 100 : 0;
  return { amount, percent, hasCostBasis: true };
}

// The debt payoff progress bar needs a real percent-paid-off, but debts only
// ever store their current balance, not an original one. Derive it from
// payment history instead: every logged payment's principal portion reduced
// the balance from some original amount, so balance + sum(principal paid)
// reconstructs that original amount without a new schema field.
export function debtPayoffProgressPercent(debt: Debt): number {
  const principalPaid = (debt.payments || []).reduce((sum, payment) => sum + Number(payment.principal || 0), 0);
  const originalBalance = Number(debt.balance || 0) + principalPaid;
  if (originalBalance <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((principalPaid / originalBalance) * 100)));
}

// Holding-class items (stock/retirement) normally price out as shares * price,
// but a retirement account can also be a flat legacy entry from before grouped
// holdings existed (just a dollar value, no shares field at all) - those still
// need to read .value directly, so this only takes the shares * price path
// once shares is actually set to something.
export function assetValue(item: WealthAsset): number {
  if (isHoldingAssetClass(item.assetClass) && Number(item.shares || 0) > 0) {
    return Math.max(0, Number(item.shares || 0)) * Math.max(0, Number(item.price || 0));
  }
  return Math.max(0, Number(item.value || 0));
}

function parseDateKey(dateKey: string): Date {
  const parts = dateKey.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day);
}

// How many times a recurring paycheck has fired up through referenceDateKey
// (respecting an optional endDate) - a "once"/"bonus" paycheck fires exactly
// once, on its own date.
export function paycheckOccurrencesSince(paycheck: Paycheck, referenceDateKey: string): number {
  if (!paycheck.date || referenceDateKey < paycheck.date) return 0;
  const effectiveReferenceKey = paycheck.endDate && referenceDateKey > paycheck.endDate ? paycheck.endDate : referenceDateKey;
  if (effectiveReferenceKey < paycheck.date) return 0;
  const recurrence = paycheck.recurrence || "once";
  if (recurrence === "once" || recurrence === "bonus") return 1;
  const anchor = parseDateKey(paycheck.date);
  const reference = parseDateKey(effectiveReferenceKey);
  const dayMs = 24 * 60 * 60 * 1000;
  if (recurrence === "weekly") return Math.floor((reference.getTime() - anchor.getTime()) / (7 * dayMs)) + 1;
  if (recurrence === "biweekly") return Math.floor((reference.getTime() - anchor.getTime()) / (14 * dayMs)) + 1;
  if (recurrence === "monthly") {
    const months = (reference.getFullYear() - anchor.getFullYear()) * 12 + (reference.getMonth() - anchor.getMonth());
    return months + (reference.getDate() >= anchor.getDate() ? 1 : 0);
  }
  return 1;
}

export type AccountBalanceContext = {
  accounts: Account[]; transactions: Transaction[]; paychecks: Paycheck[];
  paycheckOccurrences: PaycheckOccurrence[]; transfers: Transfer[]; ious: Iou[];
};

// The core balance-reconstruction function - an account's balance is never
// stored, always rebuilt from every movement against it as of referenceDateKey
// (so this doubles as "balance right now" and "balance as of a past date" for
// historical trends). Ported verbatim from the web app; see the inline
// comments below for the two easiest-to-get-backwards parts: the liability
// vs. cash formula, and the IOU direction/settlement asymmetry.
export function accountBalance(accountId: string, context: AccountBalanceContext, referenceDateKey: string): number {
  const { accounts, transactions, paychecks, paycheckOccurrences, transfers, ious } = context;
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return 0;
  const isLiability = account.type === "credit_card";

  const purchases = transactions
    .filter((transaction) => transaction.accountId === accountId && transaction.date <= referenceDateKey)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  // Recurring paychecks deposit through materialized occurrence rows (one per
  // actual payday, individually editable/deletable), not recurrence math -
  // only genuinely one-time/bonus paychecks still use paycheckOccurrencesSince.
  const oneTimeDeposits = paychecks
    .filter((paycheck) => paycheck.depositAccountId === accountId && ["once", "bonus"].includes(paycheck.recurrence || "once"))
    .reduce((sum, paycheck) => sum + Number(paycheck.amount || 0) * paycheckOccurrencesSince(paycheck, referenceDateKey), 0);
  const recurringDeposits = paycheckOccurrences
    .filter((occurrence) => occurrence.depositAccountId === accountId && occurrence.date <= referenceDateKey)
    .reduce((sum, occurrence) => sum + Number(occurrence.amount || 0), 0);
  const deposits = oneTimeDeposits + recurringDeposits;
  const transfersOut = transfers
    .filter((transfer) => transfer.fromAccountId === accountId && transfer.date <= referenceDateKey)
    .reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);
  const transfersIn = transfers
    .filter((transfer) => transfer.toAccountId === accountId && transfer.date <= referenceDateKey)
    .reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);
  const opening = Number(account.openingBalance || 0);

  if (isLiability) {
    // Owed = opening + purchases charged to the card - payments received (a transfer INTO the card pays it down).
    return opening + purchases - transfersIn;
  }
  // Borrowing money is real cash landing in this account the moment it's
  // recorded (you now hold it, and owe it back); a split expense you already
  // paid separately doesn't touch this account until the friend actually pays
  // you back. Settling either direction is the matching opposite movement,
  // dated by settledDate rather than the IOU's original date. An unsettled
  // owed_to_me IOU has ZERO effect on cash - money you're owed doesn't touch
  // the account until repaid.
  const iouCashFlow = ious
    .filter((iou) => iou.accountId === accountId)
    .reduce((sum, iou) => {
      let effect = 0;
      if (iou.direction === "i_owe" && iou.date && iou.date <= referenceDateKey) effect += Number(iou.amount || 0);
      if (iou.settled && iou.settledDate && iou.settledDate <= referenceDateKey) {
        effect += iou.direction === "i_owe" ? -Number(iou.amount || 0) : Number(iou.amount || 0);
      }
      return sum + effect;
    }, 0);
  // Cash = opening + deposits - purchases paid directly from this account - transfers out + transfers in + IOU cash flow.
  return opening + deposits - purchases - transfersOut + transfersIn + iouCashFlow;
}

export function accountsWithBalances(state: HouseholdState, referenceDateKey: string): Array<Account & { balance: number }> {
  const accounts = state.accounts || [];
  const context: AccountBalanceContext = {
    accounts,
    transactions: state.transactions || [],
    paychecks: state.paychecks || [],
    paycheckOccurrences: state.paycheckOccurrences || [],
    transfers: state.transfers || [],
    ious: state.ious || []
  };
  return accounts.map((account) => ({ ...account, balance: accountBalance(account.id, context, referenceDateKey) }));
}

export function monthEndDateKey(monthKey: string): string {
  const parts = monthKey.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? 1;
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

export function computeTrailingMonthKeys(currentMonthKey: string, count: number): string[] {
  const parts = currentMonthKey.split("-").map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? new Date().getMonth() + 1;
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(year, month - 1 - i, 1);
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

// Net worth "as of" a past date, reconstructed rather than stored: a linked
// account's historical balance comes straight from accountBalance (real
// transaction/paycheck/transfer history), while an unlinked net-worth item
// (e.g. property, no transaction history behind it) has no way to know what
// it was worth in the past, so its current value is carried flat across the
// whole trend - an honest approximation given what data actually exists.
export function computeNetWorthAtDate(state: HouseholdState, referenceDateKey: string): number {
  const context: AccountBalanceContext = {
    accounts: state.accounts || [],
    transactions: state.transactions || [],
    paychecks: state.paychecks || [],
    paycheckOccurrences: state.paycheckOccurrences || [],
    transfers: state.transfers || [],
    ious: state.ious || []
  };
  const assets = state.goals?.netWorth?.assets || [];
  const liabilities = state.goals?.netWorth?.liabilities || [];
  const assetTotal = assets.reduce((sum, asset) => {
    const linkedAccount = context.accounts.find((account) => account.netWorthAssetId === asset.id);
    return sum + (linkedAccount ? accountBalance(linkedAccount.id, context, referenceDateKey) : assetValue(asset));
  }, 0);
  const liabilityTotal = liabilities.reduce((sum, liability) => {
    const linkedAccount = context.accounts.find((account) => account.netWorthLiabilityId === liability.id);
    return sum + (linkedAccount ? accountBalance(linkedAccount.id, context, referenceDateKey) : Number(liability.value || 0));
  }, 0);
  return assetTotal - liabilityTotal;
}

export function computeNetWorthTrend(state: HouseholdState, monthKeys: string[]): Array<{ month: string; value: number }> {
  return monthKeys.map((monthKey) => ({ month: monthKey, value: computeNetWorthAtDate(state, monthEndDateKey(monthKey)) }));
}

export type DebtPaymentResult = { debt: Debt; payment: DebtPayment };

// Splits a payment into interest (this period's simple monthly interest on
// the current balance, at the debt's annual rate) and principal, reduces the
// balance, and records the payment. Never applies more than what's actually
// owed (balance + this period's interest) - overpaying just caps at "paid
// off", not a negative balance. Takes an id-generator rather than making one
// up itself, matching settleUpPersonIous's dependency-injected id pattern.
export function applyDebtPayment(debt: Debt, rawAmount: number, date: string, createPaymentId: () => string): DebtPaymentResult | null {
  if (!debt.balance) return null;
  const interest = Math.min(debt.balance, (debt.balance * Math.max(0, Number(debt.rate || 0))) / 1200);
  const amount = Math.min(debt.balance + interest, Math.max(0, Number(rawAmount || 0)));
  const principal = Math.max(0, amount - interest);
  const nextBalance = Math.max(0, debt.balance - principal);
  const payment: DebtPayment = { id: createPaymentId(), date, amount, principal, interest, extra: 0, balance: nextBalance };
  return { debt: { ...debt, balance: nextBalance, payments: [payment, ...(debt.payments || [])] }, payment };
}

// A closed account still allows a backdated entry (on/before closedAt) but
// blocks anything dated after it - every entry point that lets you pick a
// date + an account (transactions, paycheck deposits, transfers) must gate
// through this, not just the "add account" form itself.
export function accountAllowsDate(account: Account | undefined, dateValue: string): boolean {
  if (!account?.closedAt) return true;
  return dateValue <= account.closedAt;
}
