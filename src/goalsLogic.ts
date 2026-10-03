// Savings-goal auto-contribution, ported from web's ensureGoalAutoContributions (app.js). A goal can
// auto-fund itself by rounding every purchase up to the next dollar ("roundup") or by setting aside a
// percent of every paycheck that has been received ("percent"). Both are idempotent: a watermark stored
// ON the goal rules out anything already counted, so running this on every save/screen visit never
// double-credits - the same watermark fields web writes, so both clients agree on what's been counted.
import type { HouseholdState, PaycheckOccurrence, SinkingFund, Transaction } from "./types";

export type AutoContributeChoice = "off" | "roundup" | "percent";

export function autoContributeChoice(fund: SinkingFund): AutoContributeChoice {
  if (!fund.autoContribute?.enabled) return "off";
  return fund.autoContribute.mode === "percent" ? "percent" : "roundup";
}

export function setAutoContributeMode(fund: SinkingFund, choice: AutoContributeChoice): SinkingFund {
  if (choice === "off") return { ...fund, autoContribute: { enabled: false } };
  return { ...fund, autoContribute: { enabled: true, mode: choice, percent: fund.autoContribute?.percent || 5 } };
}

export function setAutoContributePercent(fund: SinkingFund, percent: number): SinkingFund {
  if (!fund.autoContribute) return fund;
  return { ...fund, autoContribute: { ...fund.autoContribute, percent: Math.min(100, Math.max(0, Number(percent) || 0)) } };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

// Sum of (next whole dollar - amount) over positive (expense) transactions only - a refund or income
// row has nothing to round up toward.
export function roundupAmount(transactions: Transaction[]): number {
  return transactions.reduce((sum, transaction) => {
    const amount = Number(transaction.amount || 0);
    return amount > 0 ? sum + (Math.ceil(amount) - amount) : sum;
  }, 0);
}

// Transactions have no stable id (web addresses them by array index), so round-up tracks a WATERMARK:
// how many transactions have already been counted. New transactions are added at the FRONT of the list
// (unshift - on web and mobile), so the unseen ones are the first (length - watermark) entries, not the
// tail. (Web's own slice(watermark) reads the tail, i.e. the oldest, already-counted rows - a bug
// reported separately; mobile counts the genuinely new ones.) If transactions were deleted the list is
// shorter than the watermark: nothing new can be told apart, so just lower the watermark to match
// rather than leaving it stuck high and silently skipping the next several purchases.
function applyRoundup(fund: SinkingFund, transactions: Transaction[]): SinkingFund {
  const watermark = fund.roundupProcessedCount || 0;
  if (transactions.length < watermark) return { ...fund, roundupProcessedCount: transactions.length };
  if (transactions.length === watermark) return fund.roundupProcessedCount === undefined ? { ...fund, roundupProcessedCount: 0 } : fund;
  const roundup = roundupAmount(transactions.slice(0, transactions.length - watermark));
  return {
    ...fund,
    roundupProcessedCount: transactions.length,
    saved: roundup > 0.004 ? round2(Number(fund.saved || 0) + roundup) : fund.saved
  };
}

// Percent-of-paycheck tracks processed paycheck OCCURRENCE ids (those do have real ids), counting every
// occurrence whose date has arrived and that hasn't been counted yet.
function applyPercent(fund: SinkingFund, occurrences: PaycheckOccurrence[], today: string): SinkingFund {
  const percent = Number(fund.autoContribute?.percent || 0);
  if (percent <= 0) return fund;
  const processed = fund.percentProcessedOccurrenceIds || [];
  const received = occurrences.filter((occurrence) => occurrence.date <= today && !processed.includes(occurrence.id));
  if (!received.length) return fund;
  const contribution = received.reduce((sum, occurrence) => sum + Number(occurrence.amount || 0) * (percent / 100), 0);
  return {
    ...fund,
    percentProcessedOccurrenceIds: [...processed, ...received.map((occurrence) => occurrence.id)],
    saved: contribution > 0.004 ? round2(Number(fund.saved || 0) + contribution) : fund.saved
  };
}

export type AutoContributionResult = { sinkingFunds: SinkingFund[]; changed: boolean };

export function applyGoalAutoContributions(state: Pick<HouseholdState, "transactions" | "paycheckOccurrences">, sinkingFunds: SinkingFund[], today: string): AutoContributionResult {
  let changed = false;
  const next = sinkingFunds.map((fund) => {
    const choice = autoContributeChoice(fund);
    const updated = choice === "roundup" ? applyRoundup(fund, state.transactions || [])
      : choice === "percent" ? applyPercent(fund, state.paycheckOccurrences || [], today)
      : fund;
    if (updated !== fund) changed = true;
    return updated;
  });
  return { sinkingFunds: changed ? next : sinkingFunds, changed };
}

// Convenience for the whole-state save path: returns the same state object untouched when there's
// nothing to credit.
export function withGoalAutoContributions<T extends HouseholdState>(state: T, today: string): T {
  const funds = state.goals?.sinkingFunds;
  if (!funds?.length || !state.goals) return state;
  const result = applyGoalAutoContributions(state, funds, today);
  return result.changed ? { ...state, goals: { ...state.goals, sinkingFunds: result.sinkingFunds } } : state;
}
