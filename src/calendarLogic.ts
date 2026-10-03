import type { CalendarEvent, ChoreRecurrence, ReminderPhotoDraft, ReminderRecurrence } from "./types";

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addMonthsToDateKey(value: string, months: number): string {
  const date = parseDateKey(value);
  const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  return dateKey(new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), Math.min(date.getDate(), lastDay)));
}

// A recurring reminder doesn't track a parallel per-occurrence completion map the way
// chores do - it just self-advances to its next due date and resets to not-done, mirroring
// web's advanceReminderDate (see app.js) - there's only ever one live occurrence to show.
export function advanceReminderDate(value: string, recurrence?: ReminderRecurrence): string {
  if (recurrence === "weekly") {
    const date = parseDateKey(value);
    date.setDate(date.getDate() + 7);
    return dateKey(date);
  }
  if (recurrence === "monthly") return addMonthsToDateKey(value, 1) || value;
  if (recurrence === "yearly") return addMonthsToDateKey(value, 12) || value;
  return value;
}

// A plain reminder has only one occurrence ever, so completion is a flat list of who's
// marked it done rather than the date-keyed map chores use. Mirrors web's isReminderComplete.
export function isReminderComplete(completedBy: string[] | undefined, assigneeKeys: string[]): boolean {
  const completedKeys = completedBy || [];
  if (!assigneeKeys.length) return completedKeys.length > 0;
  return assigneeKeys.every((key) => completedKeys.includes(key));
}

const CHORE_MONTH_STEP_BY_RECURRENCE: Partial<Record<ChoreRecurrence, number>> = { monthly: 1, every3months: 3, every4months: 4, every6months: 6, yearly: 12 };

export const choreCadenceLabels: Record<ChoreRecurrence, string> = {
  once: "Once", weekly: "Weekly", biweekly: "Every 2 weeks", triweekly: "Every 3 weeks",
  monthly: "Monthly", every3months: "Every 3 months", every4months: "Every 4 months", every6months: "Every 6 months", yearly: "Yearly"
};

// Web tracks chore completion via a date-keyed occurrence grid (isChoreOccurrencePendingFor);
// mobile's flat-list Calendar screen instead mirrors the simpler single-occurrence
// self-advance-on-complete model already used for reminders (see advanceReminderDate) -
// a deliberate simplification, not a partial port of the grid.
export function advanceChoreDate(value: string, recurrence?: ChoreRecurrence): string {
  if (recurrence === "weekly" || recurrence === "biweekly" || recurrence === "triweekly") {
    const days = recurrence === "weekly" ? 7 : recurrence === "biweekly" ? 14 : 21;
    const date = parseDateKey(value);
    date.setDate(date.getDate() + days);
    return dateKey(date);
  }
  const months = recurrence ? CHORE_MONTH_STEP_BY_RECURRENCE[recurrence] : undefined;
  if (months) return addMonthsToDateKey(value, months) || value;
  return value;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The server already validates what the vision model returns, but this is the boundary between the
// network and an editable form, so it re-checks every field and never throws: anything missing or
// malformed becomes a blank the user fills in (the AI output is only ever a draft).
export function normalizeReminderPhotoDraft(raw: unknown): ReminderPhotoDraft {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
  const date = text(source.date, 10);
  const time = text(source.time, 5);
  return { title: text(source.title, 200), date: DATE_PATTERN.test(date) ? date : "", time: TIME_PATTERN.test(time) ? time : "", location: text(source.location, 300) };
}

export type PhotoReminderInput = { title: string; date: string; time: string; location: string };

// Builds the reminder web's "Reminder from photo" dialog adds (same fields, same 09:00 default when no
// time was read). Returns null until there is both a title and a valid date - exactly web's submit
// guard. notifyAt is what makes the server actually send a notification for it, so it is always set.
// owner/ownerName are mobile's own single-assignee display fields; assignees is web's richer form.
export function buildPhotoReminderEvent(input: PhotoReminderInput, user: { email: string; name: string }, createId: () => string): CalendarEvent | null {
  const title = input.title.trim();
  const date = input.date.trim();
  if (!title || !DATE_PATTERN.test(date)) return null;
  const time = TIME_PATTERN.test(input.time.trim()) ? input.time.trim() : "09:00";
  const dateTime = `${date}T${time}`;
  const notifyAt = new Date(dateTime);
  if (Number.isNaN(notifyAt.getTime())) return null;
  return {
    id: createId(), title, date, dateTime, notifyAt: notifyAt.toISOString(), reminderAt: dateTime, type: "reminder", annual: false,
    location: input.location.trim(), recurrence: "once", completedBy: [],
    owner: user.email, ownerName: user.name, assignees: [{ key: user.email, name: user.name, email: user.email }]
  };
}
