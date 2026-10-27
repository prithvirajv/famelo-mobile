// Salary credited to a linked account is the household's income. Mirrors web's detectSalaryDeposits / autoAddDetectedSalaries
// (lib/shared-logic.js, app.js): a steady payer in the bank-feed deposits is recorded as a paycheck so the budget's income follows what is
// actually paid, and the bank's own deposit rows are folded into it so the same money is never counted twice. Pure and non-mutating. Only
// types are imported from other logic files (see the logic-file import rule), so the small helpers below are duplicated on purpose.
import type { HouseholdState, InboxDraft, Paycheck, Transaction } from "./types";

const SALARY_PAYEE_DENYLIST = /transfer|zelle|venmo|cash\s?app|paypal|refund|reversal|interest|dividend|reimburs|mobile deposit|check deposit|atm/i;
const SALARY_LOOKBACK_DAYS = 200;
const SALARY_MIN_AMOUNT = 100;
const SALARY_MIN_DEPOSITS = 3;

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}
function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((parseDateKey(a).getTime() - parseDateKey(b).getTime()) / 86400000));
}
const round2 = (value: number) => Math.round(value * 100) / 100;

// Digits (dates, reference numbers) and punctuation vary from one payslip to the next; the letters identify the payer.
export function salaryPayeeKey(payee: string | undefined): string {
  return String(payee || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 16);
}

export type SalaryRow = { externalId?: string; accountId?: string; payee?: string; amount?: number | string; date?: string };
export type SalaryDetection = { key: string; accountId: string; name: string; amount: number; recurrence: "weekly" | "biweekly" | "monthly"; anchorDate: string; lastDate: string; count: number };

function salaryCadence(sortedDates: string[]): { recurrence: SalaryDetection["recurrence"]; stepDays: number } | null {
  const intervals: number[] = [];
  for (let i = 1; i < sortedDates.length; i += 1) intervals.push(daysBetween(sortedDates[i - 1] as string, sortedDates[i] as string));
  if (intervals.length < SALARY_MIN_DEPOSITS - 1) return null;
  const share = (predicate: (days: number) => boolean) => intervals.filter(predicate).length / intervals.length;
  if (share((days) => days === 7) >= 0.6 && share((days) => Math.abs(days - 7) <= 1) >= 0.8) return { recurrence: "weekly", stepDays: 7 };
  if (share((days) => days === 14) >= 0.6 && share((days) => Math.abs(days - 14) <= 2) >= 0.8) return { recurrence: "biweekly", stepDays: 14 };
  if (share((days) => days >= 27 && days <= 34) >= 0.8) return { recurrence: "monthly", stepDays: 30 };
  return null;
}

// Cautious on purpose: transfers, P2P payments, refunds and interest are never salary, a series needs at least three deposits and a steady
// cadence (twice-a-month pay is not guessed at), a steady amount, and it must still be current.
export function detectSalaryDeposits(rows: SalaryRow[], todayKey: string): SalaryDetection[] {
  const cutoff = formatDateKey(new Date(parseDateKey(todayKey).getTime() - SALARY_LOOKBACK_DAYS * 86400000));
  const groups = new Map<string, Array<SalaryRow & { received: number; date: string }>>();
  for (const row of rows) {
    const amount = Number(row.amount);
    const key = salaryPayeeKey(row.payee);
    if (!row.externalId || !row.accountId || !key || !(amount <= -SALARY_MIN_AMOUNT) || !row.date || row.date < cutoff || row.date > todayKey) continue;
    if (SALARY_PAYEE_DENYLIST.test(String(row.payee || ""))) continue;
    const id = `${row.accountId}|${key}`;
    groups.set(id, [...(groups.get(id) || []), { ...row, date: row.date, received: -amount }]);
  }
  const found: SalaryDetection[] = [];
  groups.forEach((deposits, id) => {
    const byDate = [...deposits].sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...new Set(byDate.map((deposit) => deposit.date))];
    if (dates.length < SALARY_MIN_DEPOSITS) return;
    const cadence = salaryCadence(dates);
    if (!cadence) return;
    const amounts = byDate.map((deposit) => deposit.received).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)] as number;
    if (amounts.filter((amount) => Math.abs(amount - median) <= median * 0.15).length / amounts.length < 0.8) return;
    const last = byDate[byDate.length - 1] as (typeof byDate)[number];
    if (daysBetween(last.date, todayKey) > cadence.stepDays * 2 + 4) return;
    const [accountId, key] = id.split("|") as [string, string];
    const todayDate = parseDateKey(todayKey);
    // Income should cover last month and this one, so the series starts at the first deposit in that window (or the latest if none).
    const windowStart = formatDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1));
    const anchorDate = (byDate.find((deposit) => deposit.date >= windowStart) || last).date;
    found.push({ key, accountId, name: String(last.payee || "").replace(/\d{3,}/g, " ").replace(/[#*_/\\-]+\s*$/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "Salary", amount: round2(last.received), recurrence: cadence.recurrence, anchorDate, lastDate: last.date, count: byDate.length });
  });
  return found.sort((a, b) => b.amount - a.amount);
}

// A bank deposit that is one of the pay lines of a salary already recorded from the deposits: same account and payer, an amount within 20%
// of the paycheck so a raise or a bonus week still counts.
export function salaryDepositMatchesPaycheck(row: SalaryRow, paycheck: Paycheck): boolean {
  const detected = paycheck.autoDetected;
  const amount = Number(row.amount);
  if (!detected || !row.accountId || row.accountId !== detected.accountId || !(amount < 0)) return false;
  if (salaryPayeeKey(row.payee) !== detected.key) return false;
  const expected = Number(paycheck.amount);
  return expected > 0 && Math.abs(-amount - expected) <= expected * 0.2;
}

// A salary the household already recorded by hand: any live paycheck of the same cadence and about the same amount.
export function salaryAlreadyRecorded(detection: SalaryDetection, paychecks: Paycheck[]): boolean {
  return paychecks.some((paycheck) => {
    if ((paycheck.recurrence || "once") !== detection.recurrence) return false;
    const expected = Number(paycheck.amount);
    return expected > 0 && Math.abs(expected - detection.amount) <= expected * 0.05 && (!paycheck.endDate || paycheck.endDate >= detection.lastDate);
  });
}

const RECURRENCE_LABELS: Record<string, string> = { weekly: "weekly", biweekly: "every two weeks", monthly: "monthly" };
export function salaryRecurrenceLabel(recurrence: string): string { return RECURRENCE_LABELS[recurrence] || recurrence; }

// Posting a bank-feed row hands its amount through the opening balance (the total stays the bank's); taking one out reverses that.
function openingShift(account: { type?: string } | undefined, amount: number): number {
  return account?.type === "credit_card" ? -amount : amount;
}

function withActivity(state: HouseholdState, line: string): HouseholdState["household"] {
  return { ...state.household, activity: [line, ...(state.household.activity || [])] };
}

export function applyDetectedSalaries(state: HouseholdState, todayKey: string, createId: (prefix: string) => string, nowIso: string = new Date().toISOString()): { state: HouseholdState; changed: boolean; added: number } {
  let paychecks: Paycheck[] = [...state.paychecks];
  let transactions: Transaction[] = [...state.transactions];
  let drafts: InboxDraft[] = [...(state.transactionInboxDrafts || [])];
  let done: string[] = [...(state.transactionInboxDone || [])];
  let accounts = (state.accounts || []).map((account) => ({ ...account }));
  let occurrences = [...(state.paycheckOccurrences || [])];
  let household = state.household;
  const log = (line: string) => { household = { ...household, activity: [line, ...(household.activity || [])] }; };
  let changed = false;
  let added = 0;
  const ignored = state.salaryDetectionIgnored || [];
  const dismiss = (paycheck: Paycheck, draft: InboxDraft) => {
    paycheck.autoDetected?.dismissed.push(draft);
    if (!done.includes(draft.id || "")) done = [...done, draft.id || ""];
    drafts = drafts.filter((item) => item.id !== draft.id);
  };

  // Deposits of a salary already recorded from the deposits: skip the waiting rows, and follow a raise once two deposits agree on it.
  paychecks = paychecks.map((original) => {
    if (!original.autoDetected) return original;
    const paycheck: Paycheck = { ...original, autoDetected: { ...original.autoDetected, removed: [...original.autoDetected.removed], dismissed: [...original.autoDetected.dismissed] } };
    const waiting = drafts.filter((draft) => salaryDepositMatchesPaycheck(draft, paycheck)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!waiting.length) return original;
    waiting.forEach((draft) => dismiss(paycheck, draft));
    const latest = -Number(waiting[waiting.length - 1]?.amount);
    const detected = paycheck.autoDetected as NonNullable<Paycheck["autoDetected"]>;
    if (Math.abs(latest - paycheck.amount) <= paycheck.amount * 0.02) delete detected.pendingAmount;
    else if (detected.pendingAmount && Math.abs(latest - detected.pendingAmount) <= detected.pendingAmount * 0.005) {
      const previous = paycheck.amount;
      paycheck.amount = detected.pendingAmount;
      occurrences = occurrences.map((occurrence) => occurrence.seriesId === paycheck.id && occurrence.amount === previous ? { ...occurrence, amount: paycheck.amount } : occurrence);
      delete detected.pendingAmount;
      log(`${paycheck.name}: amount updated to ${paycheck.amount} to match your deposits`);
    } else detected.pendingAmount = latest;
    changed = true;
    return paycheck;
  });

  // A salary the deposits show that nothing records yet.
  const rows: SalaryRow[] = [...transactions, ...drafts];
  for (const detection of detectSalaryDeposits(rows, todayKey)) {
    if (ignored.includes(`${detection.accountId}|${detection.key}`)) continue;
    if (paychecks.some((paycheck) => paycheck.autoDetected?.key === detection.key && paycheck.autoDetected.accountId === detection.accountId)) continue;
    if (salaryAlreadyRecorded(detection, paychecks)) continue;
    const paycheck: Paycheck = {
      id: createId("paycheck"), name: `${detection.name} (from your deposits)`, date: detection.anchorDate, amount: detection.amount, recurrence: detection.recurrence,
      assignedLineIds: [], depositAccountId: "",
      autoDetected: { key: detection.key, accountId: detection.accountId, detectedAt: nowIso, acknowledged: false, removed: [], dismissed: [] }
    };
    const matches = (row: SalaryRow) => salaryDepositMatchesPaycheck(row, paycheck);
    transactions = transactions.filter((transaction) => {
      if (!transaction.externalId || transaction.lineId || (transaction.splits || []).length || !matches(transaction)) return true;
      paycheck.autoDetected?.removed.push(transaction);
      if (transaction.date <= todayKey) {
        accounts = accounts.map((account) => account.id === transaction.accountId ? { ...account, openingBalance: round2(Number(account.openingBalance || 0) - openingShift(account, Number(transaction.amount))) } : account);
      }
      return false;
    });
    drafts.filter(matches).forEach((draft) => dismiss(paycheck, draft));
    paychecks = [...paychecks, paycheck];
    log(`Income added from your deposits: ${paycheck.name}, ${paycheck.amount} ${salaryRecurrenceLabel(paycheck.recurrence)}`);
    changed = true;
    added += 1;
  }
  if (!changed) return { state, changed: false, added: 0 };
  return { state: { ...state, paychecks, transactions, transactionInboxDrafts: drafts, transactionInboxDone: done, accounts, paycheckOccurrences: occurrences, household }, changed, added };
}

export function keepDetectedSalary(state: HouseholdState, paycheckId: string): HouseholdState {
  return { ...state, paychecks: state.paychecks.map((paycheck) => paycheck.id === paycheckId && paycheck.autoDetected ? { ...paycheck, autoDetected: { ...paycheck.autoDetected, acknowledged: true } } : paycheck) };
}

// Undo removes the paycheck and puts back everything folded into it (ledger rows, with the opening balance adjusted again, and waiting
// rows), and stops that payer being detected again.
export function undoDetectedSalary(state: HouseholdState, paycheckId: string, todayKey: string): HouseholdState {
  const paycheck = state.paychecks.find((item) => item.id === paycheckId && item.autoDetected);
  if (!paycheck?.autoDetected) return state;
  const detected = paycheck.autoDetected;
  const accounts = (state.accounts || []).map((account) => {
    const restored = detected.removed.filter((row) => row.accountId === account.id && row.date <= todayKey);
    return restored.length ? { ...account, openingBalance: round2(Number(account.openingBalance || 0) + restored.reduce((sum, row) => sum + openingShift(account, Number(row.amount)), 0)) } : account;
  });
  const restoredIds = detected.dismissed.map((draft) => draft.id);
  return {
    ...state, accounts,
    paychecks: state.paychecks.filter((item) => item.id !== paycheckId),
    paycheckOccurrences: (state.paycheckOccurrences || []).filter((occurrence) => occurrence.seriesId !== paycheckId),
    transactions: [...detected.removed, ...state.transactions],
    transactionInboxDone: (state.transactionInboxDone || []).filter((id) => !restoredIds.includes(id)),
    transactionInboxDrafts: [...detected.dismissed, ...(state.transactionInboxDrafts || [])],
    salaryDetectionIgnored: [...(state.salaryDetectionIgnored || []), `${detected.accountId}|${detected.key}`],
    household: withActivity(state, `Undid the income added from your deposits: ${paycheck.name}`)
  };
}

export function detectedSalaryNotices(state: Pick<HouseholdState, "paychecks">): Paycheck[] {
  return state.paychecks.filter((paycheck) => paycheck.autoDetected && !paycheck.autoDetected.acknowledged);
}
