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
