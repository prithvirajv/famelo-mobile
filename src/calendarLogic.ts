import type { ReminderRecurrence } from "./types";

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
