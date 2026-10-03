// Direct TypeScript port of the Paycheck-related pure functions in the web
// app's lib/shared-logic.js and app.js. Kept behaviorally identical on
// purpose - see each function's comment for the specific gotcha it exists to
// avoid, carried over verbatim from the web source.
import type { Paycheck, PaycheckOccurrence } from "./types";

function parseDateKey(dateKey: string): Date {
  const parts = dateKey.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day);
}

function formatDateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Duplicated from wealthLogic.ts rather than imported - this repo's existing
// logic modules only ever import *types* from one another (erased at compile
// time), never real values, since Node's native TS type-stripping loader (used
// by `pnpm test`) requires an explicit .ts extension on relative imports that
// tsc itself then rejects as unsupported syntax without also flipping on
// allowImportingTsExtensions repo-wide - not worth the risk of changing how
// Metro/Expo resolves every other import in the app to save one small
// function from being duplicated twice.
function paycheckOccurrencesSince(paycheck: Paycheck, referenceDateKey: string): number {
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

export function paycheckOccurrencesInRange(paycheck: Paycheck, rangeStartKey: string, rangeEndKey: string): number {
  const dayBeforeStart = formatDateKeyFromDate(new Date(parseDateKey(rangeStartKey).getTime() - 24 * 60 * 60 * 1000));
  return paycheckOccurrencesSince(paycheck, rangeEndKey) - paycheckOccurrencesSince(paycheck, dayBeforeStart);
}

// The actual date of every occurrence within [rangeStartKey, rangeEndKey]
// (inclusive) - paycheckOccurrencesInRange only returns a count, but the
// Paycheck/Income screen needs each individual pay date (e.g. a biweekly
// paycheck anchored on the 10th lands on both the 10th and 24th within the
// same month) so a user can see every payday, not just a single total.
export function paycheckAllOccurrenceDatesInRange(paycheck: Paycheck, rangeStartKey: string, rangeEndKey: string): string[] {
  if (!paycheck?.date) return [];
  const recurrence = paycheck.recurrence || "once";
  const effectiveRangeEndKey = paycheck.endDate && rangeEndKey > paycheck.endDate ? paycheck.endDate : rangeEndKey;
  if (recurrence === "once" || recurrence === "bonus") {
    return (paycheck.date >= rangeStartKey && paycheck.date <= effectiveRangeEndKey) ? [paycheck.date] : [];
  }
  const anchor = parseDateKey(paycheck.date);
  const rangeEnd = parseDateKey(effectiveRangeEndKey);
  const dates: string[] = [];
  if (recurrence === "weekly" || recurrence === "biweekly") {
    const stepDays = recurrence === "weekly" ? 7 : 14;
    let cursor = anchor;
    while (cursor <= rangeEnd) {
      const key = formatDateKeyFromDate(cursor);
      if (key >= rangeStartKey) dates.push(key);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + stepDays);
    }
    return dates;
  }
  if (recurrence === "monthly") {
    let monthsElapsed = 0;
    let cursor = anchor;
    while (cursor <= rangeEnd) {
      const key = formatDateKeyFromDate(cursor);
      if (key >= rangeStartKey) dates.push(key);
      monthsElapsed += 1;
      const lastDayOfNextOccurrence = new Date(anchor.getFullYear(), anchor.getMonth() + monthsElapsed + 1, 0).getDate();
      cursor = new Date(anchor.getFullYear(), anchor.getMonth() + monthsElapsed, Math.min(anchor.getDate(), lastDayOfNextOccurrence));
    }
    return dates;
  }
  return [];
}

export type OccurrenceSyncResult = { paychecks: Paycheck[]; paycheckOccurrences: PaycheckOccurrence[] };

// Materializes real, individually editable/deletable occurrence rows for
// every recurring paycheck, up to 12 months out, and self-heals whenever a
// paycheck's recurrence/anchor date/end date has changed since occurrences
// were last generated under the old schedule (checked every time this runs,
// not just reactively in a field's own change handler, so it also repairs
// any paycheck left in a stale state by an edit made before this existed).
// A "once"/"bonus" paycheck never gets occurrence rows - it deposits once
// directly, on its own date. Call this once per screen load/refresh rather
// than on every keystroke; it's a whole-list recompute, not free.
export function ensurePaycheckOccurrencesGenerated(paychecks: Paycheck[], existingOccurrences: PaycheckOccurrence[], createId: () => string, now: Date = new Date()): OccurrenceSyncResult {
  const paychecksById = new Map(paychecks.map((paycheck) => [paycheck.id, paycheck]));
  let occurrences = existingOccurrences.filter((occurrence) => {
    const paycheck = paychecksById.get(occurrence.seriesId);
    return !paycheck?.endDate || occurrence.date <= paycheck.endDate;
  });
  const capDate = new Date(now.getFullYear(), now.getMonth() + 12, now.getDate());
  const capKey = formatDateKeyFromDate(capDate);

  const nextPaychecks = paychecks.map((paycheck) => {
    // A paycheck seeded before mobile (or web) ever assigned it a real id - e.g. straight from
    // signup's default state, never opened on web - would otherwise generate occurrences keyed to
    // seriesId: undefined, breaking the join back to this paycheck. Mobile's own "add paycheck" flow
    // always assigns a real id up front (matching the Wealth screen's account-creation pattern), so
    // this only ever triggers for that narrow legacy case.
    let next = paycheck.id ? paycheck : { ...paycheck, id: createId() };
    const recurrence = next.recurrence || "once";
    // Occurrences already on file were materialized under whatever recurrence/anchor/end-date was
    // active when generated (generatedRecurrence/generatedAnchorDate/generatedEndDate) - if any of
    // those have since changed, those rows no longer match the real schedule and must be thrown out
    // and regenerated from scratch, not left stale alongside a mismatched watermark.
    if (next.generatedRecurrence !== recurrence || next.generatedAnchorDate !== next.date || next.generatedEndDate !== (next.endDate || "")) {
      occurrences = occurrences.filter((occurrence) => occurrence.seriesId !== next.id);
      next = { ...next, generatedThroughDate: "", generatedRecurrence: recurrence, generatedAnchorDate: next.date, generatedEndDate: next.endDate || "" };
    }
    if (recurrence === "once" || recurrence === "bonus") return next;
    if (next.generatedThroughDate && next.generatedThroughDate >= capKey) return next;
    const generateFromKey = next.generatedThroughDate
      ? formatDateKeyFromDate(new Date(parseDateKey(next.generatedThroughDate).getTime() + 24 * 60 * 60 * 1000))
      : next.date;
    if (generateFromKey <= capKey) {
      paycheckAllOccurrenceDatesInRange(next, generateFromKey, capKey).forEach((date) => {
        occurrences = [...occurrences, { id: createId(), seriesId: next.id, date, amount: next.amount, depositAccountId: next.depositAccountId || "" }];
      });
    }
    return { ...next, generatedThroughDate: capKey };
  });

  return { paychecks: nextPaychecks, paycheckOccurrences: occurrences };
}

function monthEndDateKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year ?? 1970, month ?? 1, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

// Income for one month, derived from paychecks the way web does everywhere (Budget's monthly income and
// Reports' cash flow): one-time income by occurrence count, recurring income from the materialized
// occurrences that land in the month.
export function paycheckIncomeForMonth(state: { paychecks: Paycheck[]; paycheckOccurrences?: PaycheckOccurrence[] }, monthKey: string): number {
  const monthStart = `${monthKey}-01`;
  const monthEnd = monthEndDateKey(monthKey);
  const oneTimeIncome = (state.paychecks || [])
    .filter((paycheck) => ["once", "bonus"].includes(paycheck.recurrence || "once"))
    .reduce((sum, paycheck) => sum + Number(paycheck.amount || 0) * paycheckOccurrencesInRange(paycheck, monthStart, monthEnd), 0);
  const recurringIncome = (state.paycheckOccurrences || [])
    .filter((occurrence) => occurrence.date >= monthStart && occurrence.date <= monthEnd)
    .reduce((sum, occurrence) => sum + Number(occurrence.amount || 0), 0);
  return oneTimeIncome + recurringIncome;
}

// Mirrors web's budgetIncomeFromPaychecks (app.js): a month's budget income is always derived from
// the household's paychecks - web recomputes it on every render, so the stored state.budget.income is
// never something a client should edit directly; a stale value just gets overwritten there.
export function budgetIncomeFromPaychecks(state: { budget: { month: string }; paychecks: Paycheck[]; paycheckOccurrences?: PaycheckOccurrence[] }): number {
  return paycheckIncomeForMonth(state, state.budget.month);
}

// ---- editing an existing paycheck, assigning bills to it, and per-month figures (mirrors web's Paycheck/Income plan cards) ----

type PaycheckData = { paychecks: Paycheck[]; paycheckOccurrences: PaycheckOccurrence[] };

export type PaycheckPatch = Partial<Pick<Paycheck, "name" | "amount" | "date" | "recurrence" | "endDate" | "depositAccountId">>;

export function validatePaycheckPatch(patch: PaycheckPatch): string | null {
  if (patch.name !== undefined && !patch.name.trim()) return "A paycheck needs a name.";
  if (patch.amount !== undefined && !(Number.isFinite(patch.amount) && patch.amount >= 0)) return "Amount must be zero or more.";
  for (const [label, value] of [["Date", patch.date], ["End date", patch.endDate]] as const) {
    if (!value) continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const real = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!match || !real || real.getUTCMonth() !== Number(match[2]) - 1 || real.getUTCDate() !== Number(match[3])) return `${label} must be a real date as YYYY-MM-DD.`;
  }
  if (patch.date === "") return "A paycheck needs a date.";
  return null;
}

// Applies an edit like web's field handlers. Changing the date, repeat or end date needs no clean-up here: the screen's
// ensurePaycheckOccurrencesGenerated pass notices the watermark mismatch and regenerates. A new amount reaches only pay dates still
// at the old template amount (so a hand-edited bonus week is not overwritten); a new deposit account reaches every pay date.
export function updatePaycheck(data: PaycheckData, paycheckId: string, patch: PaycheckPatch): PaycheckData {
  const current = data.paychecks.find((item) => item.id === paycheckId);
  if (!current) return data;
  const next: Paycheck = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
    ...(patch.date ? { date: patch.date } : {}),
    ...(patch.recurrence !== undefined ? { recurrence: patch.recurrence } : {}),
    ...(patch.endDate !== undefined ? { endDate: patch.endDate || "" } : {}),
    ...(patch.depositAccountId !== undefined ? { depositAccountId: patch.depositAccountId } : {})
  };
  const occurrences = data.paycheckOccurrences.map((occurrence) => {
    if (occurrence.seriesId !== paycheckId) return occurrence;
    let updated = occurrence;
    if (patch.amount !== undefined && occurrence.amount === current.amount) updated = { ...updated, amount: patch.amount };
    if (patch.depositAccountId !== undefined) updated = { ...updated, depositAccountId: patch.depositAccountId };
    return updated;
  });
  return { paychecks: data.paychecks.map((item) => item.id === paycheckId ? next : item), paycheckOccurrences: occurrences };
}

export function setOccurrenceDate(occurrences: PaycheckOccurrence[], occurrenceId: string, date: string): PaycheckOccurrence[] {
  return occurrences.map((occurrence) => occurrence.id === occurrenceId ? { ...occurrence, date } : occurrence);
}

// Assigns a budget line (bill) to a paycheck, optionally setting the line's planned amount, like web's "Assign bill".
export function assignBillToPaycheck<T extends { paychecks: Paycheck[]; budget: { categories: Array<{ lines: Array<{ id: string; planned: number }> }> } }>(state: T, paycheckId: string, lineId: string, plannedAmount: number | null): T {
  const paychecks = state.paychecks.map((paycheck) => paycheck.id === paycheckId && !paycheck.assignedLineIds.includes(lineId) ? { ...paycheck, assignedLineIds: [...paycheck.assignedLineIds, lineId] } : paycheck);
  if (plannedAmount === null || !(plannedAmount >= 0)) return { ...state, paychecks };
  const categories = state.budget.categories.map((category) => ({ ...category, lines: category.lines.map((line) => line.id === lineId ? { ...line, planned: plannedAmount } : line) }));
  return { ...state, paychecks, budget: { ...state.budget, categories } };
}

export function removeAssignedLine(paychecks: Paycheck[], paycheckId: string, lineId: string): Paycheck[] {
  return paychecks.map((paycheck) => paycheck.id === paycheckId ? { ...paycheck, assignedLineIds: paycheck.assignedLineIds.filter((id) => id !== lineId) } : paycheck);
}

export function paycheckAssignedAmount(paycheck: Paycheck, lines: Array<{ id: string; planned: number }>): number {
  return paycheck.assignedLineIds.reduce((sum, id) => sum + Number(lines.find((line) => line.id === id)?.planned || 0), 0);
}

// How much of this paycheck lands in the month: recurring ones from their materialized pay dates, one-time ones from the date itself.
export function paycheckMonthlyIncome(paycheck: Paycheck, occurrences: PaycheckOccurrence[], monthKey: string): number {
  const monthStart = `${monthKey}-01`;
  const monthEnd = monthEndDateKey(monthKey);
  if (!["once", "bonus"].includes(paycheck.recurrence || "once")) {
    return occurrences.filter((occurrence) => occurrence.seriesId === paycheck.id && occurrence.date >= monthStart && occurrence.date <= monthEnd).reduce((sum, occurrence) => sum + Number(occurrence.amount || 0), 0);
  }
  return Number(paycheck.amount || 0) * paycheckOccurrencesInRange(paycheck, monthStart, monthEnd);
}

// Whether the paycheck is a live income source in the month (an ended series, or one that has not started, is not).
export function paycheckActiveInMonth(paycheck: Paycheck, monthKey: string): boolean {
  const monthStart = `${monthKey}-01`;
  const monthEnd = monthEndDateKey(monthKey);
  if (["once", "bonus"].includes(paycheck.recurrence || "once")) return paycheckOccurrencesInRange(paycheck, monthStart, monthEnd) > 0;
  if (!paycheck.date || paycheck.date > monthEnd) return false;
  if (paycheck.endDate && paycheck.endDate < monthStart) return false;
  return true;
}
