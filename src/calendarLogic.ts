import type { CalendarEvent, Chore, ChoreRecurrence, ReminderPhotoDraft, ReminderRecurrence } from "./types";

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

// ---- Chores -------------------------------------------------------------------------------------
// Web keeps a chore's recurrence anchored on startDate and derives every occurrence from elapsed time
// (never from completion), and records completion per occurrence DATE: completedBy is a map
// { "YYYY-MM-DD": [assignee keys] }. Mobile must write exactly that shape - an array here is silently
// dropped by web's `completedBy[date] ||= []` (JSON loses non-index properties on an array), and moving
// startDate on completion would shift the recurrence anchor and erase history.

// The occurrence the chore's reminders track right now: the latest one on/before `now` (never every
// missed one), or the first one if none has arrived yet. Ported from web's currentChoreOccurrenceDate.
export function currentChoreOccurrenceDate(chore: Pick<Chore, "startDate" | "nextDue" | "recurrence" | "endDate">, now: Date = new Date()): string | null {
  const recurrence = chore.recurrence || "once";
  const startKey = chore.startDate || chore.nextDue;
  if (!startKey || !DATE_PATTERN.test(startKey)) return null;
  const start = parseDateKey(startKey);
  const end = chore.endDate && DATE_PATTERN.test(chore.endDate) ? parseDateKey(chore.endDate) : null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (recurrence === "once") return end && start > end ? null : dateKey(start);

  const monthStep = CHORE_MONTH_STEP_BY_RECURRENCE[recurrence];
  let current: Date | null = null;
  if (monthStep) {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    for (let i = 0; i < 240; i += 1) {
      const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const occurrence = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(start.getDate(), lastDay));
      if (occurrence >= start) {
        if (end && occurrence > end) break;
        if (occurrence > today) break;
        current = occurrence;
      }
      cursor.setMonth(cursor.getMonth() + monthStep);
    }
  } else {
    const intervalDays = recurrence === "triweekly" ? 21 : recurrence === "biweekly" ? 14 : 7;
    const cursor = new Date(start);
    for (let i = 0; i < 3650; i += 1) {
      if (end && cursor > end) break;
      if (cursor > today) break;
      current = new Date(cursor);
      cursor.setDate(cursor.getDate() + intervalDays);
    }
  }
  if (current) return dateKey(current);
  return end && start > end ? null : dateKey(start);
}

function completionMap(value: unknown): Record<string, string[]> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string[]>) : {};
}

export function choreCompletedKeys(chore: Pick<Chore, "completedBy">, date: string): string[] {
  return completionMap(chore.completedBy)[date] || [];
}

// An occurrence is done once every assignee has marked it (or anyone, when the chore has none).
export function isChoreOccurrenceComplete(chore: Pick<Chore, "completedBy" | "assignees">, date: string): boolean {
  const assigneeKeys = (chore.assignees || []).map((assignee) => assignee.key);
  const completed = choreCompletedKeys(chore, date);
  if (!assigneeKeys.length) return completed.length > 0;
  return assigneeKeys.every((key) => completed.includes(key));
}

export function toggleChoreCompletion(chore: Chore, date: string, key: string): Chore {
  const map = completionMap(chore.completedBy);
  const current = map[date] || [];
  return { ...chore, completedBy: { ...map, [date]: current.includes(key) ? current.filter((item) => item !== key) : [...current, key] } };
}

// Which key the signed-in viewer marks done under, and whether they may at all - web's single
// "Mark done" button: an assignee marks their own part, a chore/reminder with no assignees is
// marked as the whole "household", and a viewer who isn't one of several assignees only sees progress.
export function completionKeyFor(assignees: Array<{ key: string }> | undefined, viewerKey: string): string | null {
  if (!assignees?.length) return "household";
  return assignees.some((assignee) => assignee.key === viewerKey) ? viewerKey : null;
}

// Mobile used to write completedBy as a flat array on chores; web can't read that, so convert any
// such chore to the date-keyed map (the lost completions cannot be reconstructed, an empty map is
// the safe state). Returns the same state object when nothing needs repair.
export function repairChoreCompletion<T extends { calendar: { chores: Chore[] } }>(state: T): T {
  if (!state.calendar?.chores?.some((chore) => Array.isArray(chore.completedBy))) return state;
  return { ...state, calendar: { ...state.calendar, chores: state.calendar.chores.map((chore) => Array.isArray(chore.completedBy) ? { ...chore, completedBy: {} } : chore) } };
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

export type ReminderTiming = { dateTime: string; reminderAt: string; notifyAt: string };

// A plain reminder's schedule as web writes it: dateTime is the event's own date+time, and reminderAt /
// notifyAt are when to notify. The server only sends a push/email for an event that HAS notifyAt, so
// every reminder mobile creates or reschedules must set it. A blank/invalid time falls back to 09:00
// (web's default); returns null for an invalid date. notifyAt is the device-local wall-clock time
// converted to a UTC instant - the same thing web does in the browser.
export function reminderTiming(date: string, time: string): ReminderTiming | null {
  if (!DATE_PATTERN.test(date.trim())) return null;
  const cleanTime = TIME_PATTERN.test(time.trim()) ? time.trim() : "09:00";
  const dateTime = `${date.trim()}T${cleanTime}`;
  const instant = new Date(dateTime);
  if (Number.isNaN(instant.getTime())) return null;
  return { dateTime, reminderAt: dateTime, notifyAt: instant.toISOString() };
}

// Completing a RECURRING reminder rolls it to its next occurrence (web's complete handler): the event's
// own date and the notification time both move forward by one period, and completion resets. Without
// moving notifyAt too, the next occurrence would never notify.
export function advanceRecurringReminder(event: CalendarEvent): CalendarEvent {
  const recurrence = event.recurrence;
  if (event.type !== "reminder" || !recurrence || recurrence === "once") return event;
  const nextDate = advanceReminderDate(event.date, recurrence);
  const time = (event.dateTime || "").slice(11, 16) || "09:00";
  const next: CalendarEvent = { ...event, date: nextDate, dateTime: `${nextDate}T${time}`, completedBy: [] };
  if (event.reminderAt) {
    const reminderTime = event.reminderAt.slice(11, 16) || "09:00";
    const nextReminderAt = `${advanceReminderDate(event.reminderAt.slice(0, 10), recurrence)}T${reminderTime}`;
    next.reminderAt = nextReminderAt;
    const instant = new Date(nextReminderAt);
    if (!Number.isNaN(instant.getTime())) next.notifyAt = instant.toISOString();
  }
  return next;
}

// Builds the reminder web's "Reminder from photo" dialog adds (same fields, same 09:00 default when no
// time was read). Returns null until there is both a title and a valid date - exactly web's submit
// guard. owner/ownerName are mobile's own single-assignee display fields; assignees is web's richer form.
export function buildPhotoReminderEvent(input: PhotoReminderInput, user: { email: string; name: string }, createId: () => string): CalendarEvent | null {
  const title = input.title.trim();
  const timing = reminderTiming(input.date, input.time);
  if (!title || !timing) return null;
  return {
    id: createId(), title, date: input.date.trim(), ...timing, type: "reminder", annual: false,
    location: input.location.trim(), recurrence: "once", completedBy: [],
    owner: user.email, ownerName: user.name, assignees: [{ key: user.email, name: user.name, email: user.email }]
  };
}

export function isValidClockTime(value: string): boolean {
  return TIME_PATTERN.test(value.trim());
}

// Who a reminder/chore is assigned to, in web's terms. Mobile-created items only carry a single
// owner/assignee email; web upgrades those to a one-person assignees list on its next render, so
// completion has to be keyed the same way or the two apps disagree about whether it is done.
export function effectiveAssignees(item: { assignees?: Array<{ key: string }>; owner?: string; assignee?: string }): Array<{ key: string }> {
  if (item.assignees?.length) return item.assignees;
  const single = item.owner || item.assignee;
  return single ? [{ key: single }] : [];
}
