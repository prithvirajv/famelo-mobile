import type { CalendarEvent, CalendarImportDraft, Chore, ChoreRecurrence, ReminderPhotoDraft, ReminderRecurrence } from "./types";

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

// A date + 24-hour time as a Date in the device's own timezone, or null if either part isn't real. Built from numeric
// parts on purpose instead of parsing "YYYY-MM-DDTHH:MM": that string has no seconds or zone, and whether it is read as
// local time (as the spec says) is exactly the kind of thing that differs between JS engines, so it must not decide when
// a reminder fires on iOS vs Android. Impossible values (month 13, Feb 30, 25:00) are rejected rather than rolled over.
export function localInstant(date: string, time: string): Date | null {
  const [year, month, day] = date.trim().split("-").map(Number);
  const [hour, minute] = time.trim().split(":").map(Number);
  if (![year, month, day, hour, minute].every((part) => Number.isInteger(part))) return null;
  const instant = new Date(year as number, (month as number) - 1, day as number, hour as number, minute as number);
  const exact = instant.getFullYear() === year && instant.getMonth() === (month as number) - 1 && instant.getDate() === day && instant.getHours() === hour && instant.getMinutes() === minute;
  return exact ? instant : null;
}

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
  const instant = localInstant(date, cleanTime);
  if (!instant) return null;
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
    const instant = localInstant(nextReminderAt.slice(0, 10), nextReminderAt.slice(11, 16));
    if (instant) next.notifyAt = instant.toISOString();
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


// ---- Export / import (.ics and .csv) ---------------------------------------------------------------
// Ported from web's lib/shared-logic.js (buildCalendarIcs/parseIcsText/icsEventsToCalendarDrafts/
// buildCalendarCsv/parseCalendarCsv) so a file exported from either app imports cleanly into the other.
// Hand-rolled rather than a library: only this app's own small, fixed set of recurrence values has to
// round-trip. Chores and reminders use a floating (no timezone) local DATE-TIME for DTSTART, matching how
// wall-clock times are stored everywhere else; birthdays/anniversaries use a DATE-only DTSTART with
// FREQ=YEARLY. X-FAMILYLOOP-* properties carry the exact kind/type/recurrence for a lossless round-trip.

export function icsEscapeText(text: unknown): string {
  return String(text || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function icsUnescapeText(text: unknown): string {
  return String(text || "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");
}

// RFC 5545: lines longer than 75 octets are folded. Folded per character, not per UTF-8 octet - titles and
// locations here are short enough that the difference never matters in practice (same as web).
export function foldIcsLine(line: string): string {
  if (line.length <= 73) return line;
  let result = line.slice(0, 73);
  let rest = line.slice(73);
  while (rest.length) {
    result += "\r\n " + rest.slice(0, 72);
    rest = rest.slice(72);
  }
  return result;
}

const icsDateOnly = (value: unknown) => String(value || "").replace(/-/g, "");
function icsDateTimeFloating(date: string | undefined, time: string | undefined): string {
  const [hour = "09", minute = "00"] = String(time || "09:00").split(":");
  return `${icsDateOnly(date)}T${hour.padStart(2, "0")}${minute.padStart(2, "0")}00`;
}
const icsStampNow = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

function choreIcsRRule(chore: Chore): string {
  const recurrence = chore.recurrence || "once";
  let rule = "";
  if (recurrence === "weekly") rule = "FREQ=WEEKLY";
  else if (recurrence === "biweekly") rule = "FREQ=WEEKLY;INTERVAL=2";
  else if (recurrence === "triweekly") rule = "FREQ=WEEKLY;INTERVAL=3";
  else if (CHORE_MONTH_STEP_BY_RECURRENCE[recurrence]) rule = `FREQ=MONTHLY;INTERVAL=${CHORE_MONTH_STEP_BY_RECURRENCE[recurrence]}`;
  if (!rule) return "";
  if (chore.endDate) rule += `;UNTIL=${icsDateOnly(chore.endDate)}T235959`;
  return rule;
}

function reminderIcsRRule(recurrence: string | undefined): string {
  if (recurrence === "weekly") return "FREQ=WEEKLY";
  if (recurrence === "monthly") return "FREQ=MONTHLY";
  if (recurrence === "yearly") return "FREQ=YEARLY";
  return "";
}

function calendarItemToIcsLines(kind: "chore" | "event", item: Chore | CalendarEvent, now: Date): string[] {
  const lines = ["BEGIN:VEVENT"];
  const id = item.id || "";
  lines.push(`UID:${kind}-${id}@familyloop`);
  lines.push(`DTSTAMP:${icsStampNow(now)}`);
  lines.push(foldIcsLine(`SUMMARY:${icsEscapeText(item.title)}`));
  if (kind === "chore") {
    const chore = item as Chore;
    lines.push(`DTSTART:${icsDateTimeFloating(chore.startDate || chore.nextDue, chore.time)}`);
    const rrule = choreIcsRRule(chore);
    if (rrule) lines.push(`RRULE:${rrule}`);
    if (chore.location) lines.push(foldIcsLine(`LOCATION:${icsEscapeText(chore.location)}`));
    lines.push("X-FAMILYLOOP-KIND:chore", "X-FAMILYLOOP-TYPE:chore", `X-FAMILYLOOP-RECURRENCE:${chore.recurrence || "once"}`);
    if (chore.endDate) lines.push(`X-FAMILYLOOP-ENDDATE:${chore.endDate}`);
  } else {
    const event = item as CalendarEvent;
    if (event.annual) {
      lines.push(`DTSTART;VALUE=DATE:${icsDateOnly(event.date)}`, "RRULE:FREQ=YEARLY");
      lines.push("X-FAMILYLOOP-KIND:event", `X-FAMILYLOOP-TYPE:${event.type}`, "X-FAMILYLOOP-RECURRENCE:yearly");
      if (event.reminderDays !== undefined && event.reminderDays !== null) lines.push(`X-FAMILYLOOP-REMINDERDAYS:${event.reminderDays}`);
    } else {
      lines.push(`DTSTART:${icsDateTimeFloating(event.date, event.dateTime?.slice(11, 16))}`);
      const rrule = reminderIcsRRule(event.recurrence);
      if (rrule) lines.push(`RRULE:${rrule}`);
      if (event.location) lines.push(foldIcsLine(`LOCATION:${icsEscapeText(event.location)}`));
      lines.push("X-FAMILYLOOP-KIND:event", `X-FAMILYLOOP-TYPE:${event.type || "reminder"}`, `X-FAMILYLOOP-RECURRENCE:${event.recurrence || "once"}`);
    }
  }
  const assigneeKeys = (item.assignees || []).map((assignee) => assignee.key).filter(Boolean);
  if (assigneeKeys.length) lines.push(foldIcsLine(`X-FAMILYLOOP-ASSIGNEES:${icsEscapeText(assigneeKeys.join("|"))}`));
  lines.push(`X-FAMILYLOOP-ID:${id}`, "END:VEVENT");
  return lines;
}

export function buildCalendarIcs(events: CalendarEvent[], chores: Chore[], now: Date = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FamilyLoop//Calendar//EN", "CALSCALE:GREGORIAN"];
  (chores || []).forEach((chore) => lines.push(...calendarItemToIcsLines("chore", chore, now)));
  (events || []).forEach((event) => lines.push(...calendarItemToIcsLines("event", event, now)));
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export type ParsedIcsEvent = {
  summary: string; dtstart: { date: string; time: string | null } | null; rrule: { freq: string; interval: number } | null;
  location: string; xProps: Record<string, string>;
};

// Unfolds continuation lines (a line starting with a space or tab continues the previous one), then groups
// BEGIN:VEVENT/END:VEVENT blocks into raw objects. No interpretation of what an event "means" happens here.
export function parseIcsText(text: string): ParsedIcsEvent[] {
  const unfolded: string[] = [];
  String(text || "").split(/\r\n|\n|\r/).forEach((line) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  });
  const events: ParsedIcsEvent[] = [];
  let current: ParsedIcsEvent | null = null;
  unfolded.forEach((line) => {
    if (line === "BEGIN:VEVENT") { current = { summary: "", dtstart: null, rrule: null, location: "", xProps: {} }; return; }
    if (line === "END:VEVENT") { if (current) events.push(current); current = null; return; }
    if (!current) return;
    const match = line.match(/^([A-Za-z0-9-]+)(;[^:]*)?:(.*)$/);
    if (!match) return;
    const name = (match[1] || "").toUpperCase();
    const params = match[2] || "";
    const value = match[3] || "";
    if (name === "SUMMARY") current.summary = icsUnescapeText(value);
    else if (name === "DTSTART") {
      const isDateOnly = /VALUE=DATE(?!-TIME)/i.test(params) || /^\d{8}$/.test(value);
      const digits = value.replace(/Z$/i, "");
      const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      const time = isDateOnly || digits.length < 13 ? null : `${digits.slice(9, 11)}:${digits.slice(11, 13)}`;
      current.dtstart = { date, time };
    } else if (name === "RRULE") {
      const parts = Object.fromEntries(value.split(";").map((pair) => pair.split("=") as [string, string]));
      current.rrule = { freq: parts.FREQ || "", interval: Number(parts.INTERVAL || 1) };
    } else if (name === "LOCATION") current.location = icsUnescapeText(value);
    else if (name.startsWith("X-FAMILYLOOP-")) current.xProps[name] = icsUnescapeText(value);
  });
  return events;
}

// Maps parsed VEVENTs to flat drafts. With X-FAMILYLOOP-* markers (this app's own export) the original
// kind/type/recurrence round-trips exactly; a real external .ics (Google/Apple/Outlook) falls back to a safe
// generic mapping - everything becomes a reminder, never guessing at chore/birthday semantics.
export function icsEventsToCalendarDrafts(icsEvents: ParsedIcsEvent[]): CalendarImportDraft[] {
  return (icsEvents || [])
    .filter((icsEvent) => icsEvent.dtstart && icsEvent.dtstart.date && icsEvent.summary)
    .map((icsEvent): CalendarImportDraft => {
      const x = icsEvent.xProps;
      const dtstart = icsEvent.dtstart as { date: string; time: string | null };
      if (x["X-FAMILYLOOP-KIND"]) {
        const reminderDays = x["X-FAMILYLOOP-REMINDERDAYS"] !== undefined ? Number(x["X-FAMILYLOOP-REMINDERDAYS"]) : undefined;
        return {
          kind: x["X-FAMILYLOOP-KIND"] === "chore" ? "chore" : "event",
          type: x["X-FAMILYLOOP-TYPE"] || x["X-FAMILYLOOP-KIND"] || "reminder",
          title: icsEvent.summary, date: dtstart.date, time: dtstart.time || "09:00",
          recurrence: x["X-FAMILYLOOP-RECURRENCE"] || "once", endDate: x["X-FAMILYLOOP-ENDDATE"] || "", location: icsEvent.location || "",
          assigneeKeys: x["X-FAMILYLOOP-ASSIGNEES"] ? x["X-FAMILYLOOP-ASSIGNEES"].split("|").filter(Boolean) : [],
          ...(reminderDays !== undefined ? { reminderDays } : {})
        };
      }
      const freq = icsEvent.rrule?.freq || "";
      const recurrence = freq === "YEARLY" ? "yearly" : freq === "MONTHLY" ? "monthly" : freq === "WEEKLY" ? "weekly" : "once";
      return { kind: "event", type: "reminder", title: icsEvent.summary, date: dtstart.date, time: dtstart.time || "09:00", recurrence, endDate: "", location: icsEvent.location || "", assigneeKeys: [] };
    });
}

const CALENDAR_CSV_HEADERS = ["Kind", "Type", "Title", "Date", "Time", "Recurrence", "EndDate", "Location", "Assignees", "ReminderDays"];
const calendarCsvField = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function buildCalendarCsv(events: CalendarEvent[], chores: Chore[]): string {
  const rows = [CALENDAR_CSV_HEADERS.join(",")];
  (chores || []).forEach((chore) => rows.push([
    "chore", "chore", chore.title, chore.startDate || chore.nextDue, chore.time || "", chore.recurrence || "once", chore.endDate || "",
    chore.location || "", (chore.assignees || []).map((assignee) => assignee.key).join("|"), ""
  ].map(calendarCsvField).join(",")));
  (events || []).forEach((event) => rows.push([
    "event", event.type || "reminder", event.title, event.date, event.dateTime?.slice(11, 16) || "", event.annual ? "yearly" : (event.recurrence || "once"),
    "", event.location || "", (event.assignees || []).map((assignee) => assignee.key).join("|"), event.reminderDays ?? ""
  ].map(calendarCsvField).join(",")));
  return rows.join("\r\n");
}

// A lenient character-by-character CSV parser: a quote closes a field only when immediately followed by a
// comma, newline or end of input, so an unescaped literal quote inside a quoted field survives (web's rule).
export function parseDelimitedText(text: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = String(text || "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        const next = source[i + 1];
        if (next === '"') { field += '"'; i += 1; }
        else if (next === "," || next === "\n" || next === "\r" || next === undefined) inQuotes = false;
        else field += '"';
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") inQuotes = true;
    else if (char === ",") { fields.push(field); field = ""; }
    else if (char === "\r") { /* skipped - \n ends the row */ }
    else if (char === "\n") { fields.push(field); rows.push(fields); fields = []; field = ""; }
    else field += char;
  }
  if (field !== "" || fields.length) { fields.push(field); rows.push(fields); }
  return rows;
}

export function parseCalendarCsv(text: string): CalendarImportDraft[] {
  const rows = parseDelimitedText(text).filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
  const headerRow = rows[0];
  if (!headerRow) return [];
  const header = headerRow.map((cell) => String(cell || "").trim().toLowerCase());
  const indexOf = (name: string) => header.indexOf(name.toLowerCase());
  const i = { kind: indexOf("Kind"), type: indexOf("Type"), title: indexOf("Title"), date: indexOf("Date"), time: indexOf("Time"), recurrence: indexOf("Recurrence"), endDate: indexOf("EndDate"), location: indexOf("Location"), assignees: indexOf("Assignees"), reminderDays: indexOf("ReminderDays") };
  if (i.title === -1 || i.date === -1) return [];
  const cell = (row: string[], index: number) => (index === -1 ? "" : row[index] || "");
  return rows.slice(1)
    .filter((row) => cell(row, i.title) && cell(row, i.date))
    .map((row): CalendarImportDraft => {
      const reminderDaysCell = i.reminderDays !== -1 ? row[i.reminderDays] : undefined;
      return {
        kind: cell(row, i.kind) === "chore" ? "chore" : "event", type: cell(row, i.type) || "reminder", title: cell(row, i.title), date: cell(row, i.date),
        time: cell(row, i.time) || "09:00", recurrence: cell(row, i.recurrence) || "once", endDate: cell(row, i.endDate), location: cell(row, i.location),
        assigneeKeys: cell(row, i.assignees) ? cell(row, i.assignees).split("|").filter(Boolean) : [],
        ...(reminderDaysCell !== undefined && reminderDaysCell !== "" ? { reminderDays: Number(reminderDaysCell) } : {})
      };
    });
}

export const ANNUAL_EVENT_TYPES = ["birthday", "anniversary"];
const REMINDER_RECURRENCES = ["once", "weekly", "monthly", "yearly"];

// An imported file is untrusted input. Web builds items straight from it and would throw on a bad date, so
// mobile validates first: rows with a missing title or an invalid date are dropped (and counted), a bad time
// becomes 09:00, and an unknown recurrence becomes "once".
export function sanitizeCalendarDrafts(drafts: CalendarImportDraft[]): { drafts: CalendarImportDraft[]; skipped: number } {
  const valid: CalendarImportDraft[] = [];
  let skipped = 0;
  drafts.forEach((draft) => {
    const date = String(draft.date || "").trim();
    const parsed = DATE_PATTERN.test(date) ? parseDateKey(date) : null;
    const isRealDate = Boolean(parsed) && !Number.isNaN((parsed as Date).getTime()) && dateKey(parsed as Date) === date;
    if (!String(draft.title || "").trim() || !isRealDate) { skipped += 1; return; }
    const kind = draft.kind === "chore" ? "chore" : "event";
    const allowed = kind === "chore" ? Object.keys(choreCadenceLabels) : REMINDER_RECURRENCES;
    const endDate = DATE_PATTERN.test(draft.endDate || "") ? draft.endDate : "";
    valid.push({
      ...draft, kind, title: draft.title.trim(), date, endDate,
      time: TIME_PATTERN.test((draft.time || "").trim()) ? draft.time.trim() : "09:00",
      recurrence: allowed.includes(draft.recurrence) ? draft.recurrence : "once",
      type: kind === "chore" ? "chore" : (draft.type || "reminder")
    });
  });
  return { drafts: valid, skipped };
}

// Birthday/anniversary notifications always target the NEXT upcoming occurrence of the annual date (the
// entered date is often a birth year decades ago), minus reminderDays, at the given time. Device-local
// wall-clock, like web's annualEventNotifyAt (client-side only for the same reason).
export function nextAnnualOccurrence(monthDay: string, reference: Date = new Date()): Date {
  const [month = 1, day = 1] = monthDay.split("-").map(Number);
  const occurrenceIn = (year: number) => new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate()));
  const midnight = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const candidate = occurrenceIn(reference.getFullYear());
  return candidate >= midnight ? candidate : occurrenceIn(reference.getFullYear() + 1);
}

export function annualEventNotifyAt(monthDay: string, reminderDays: number, time: string, reference: Date = new Date()): string {
  const notify = nextAnnualOccurrence(monthDay, reference);
  notify.setDate(notify.getDate() - Number(reminderDays || 0));
  const [hour = 9, minute = 0] = (TIME_PATTERN.test(time) ? time : "09:00").split(":").map(Number);
  notify.setHours(hour, minute, 0, 0);
  return notify.toISOString();
}

export type ImportMember = { name: string; email: string };

// Resolves assignee keys the way web's resolveAssignees does: a known household member by email, else the
// key itself. With no keys, the importing user is the assignee (web's default).
export function resolveImportAssignees(keys: string[], members: ImportMember[], fallback: { email: string; name: string }): Array<{ key: string; name: string; email: string }> {
  const unique = [...new Set(keys.map((key) => String(key || "").trim()).filter(Boolean))];
  if (!unique.length) return [{ key: fallback.email, name: fallback.name, email: fallback.email }];
  return unique.map((key) => {
    const member = members.find((candidate) => candidate.email === key || candidate.name === key);
    return { key, name: member?.name || key, email: member?.email || (key.includes("@") ? key : "") };
  });
}

// Turns a (sanitized) draft into the chore/event object the add forms themselves build, so an imported
// item behaves identically to one added by hand - including notifyAt, which is what makes the server
// notify. owner/assignee fields are mobile's single-person display fields (first assignee).
export function calendarDraftToItem(draft: CalendarImportDraft, assignees: Array<{ key: string; name: string; email: string }>, createId: () => string, now: Date = new Date()): { kind: "chore"; item: Chore } | { kind: "event"; item: CalendarEvent } | null {
  const first = assignees[0];
  const time = TIME_PATTERN.test(draft.time) ? draft.time : "09:00";
  if (draft.kind === "chore") {
    const recurrence = (Object.keys(choreCadenceLabels).includes(draft.recurrence) ? draft.recurrence : "once") as ChoreRecurrence;
    const endDate = recurrence === "once" ? "" : draft.endDate || "";
    const instant = localInstant(draft.date, time);
    if (!instant) return null;
    const base = choreCadenceLabels[recurrence];
    return { kind: "chore", item: {
      id: createId(), title: draft.title, assignee: first?.key || "", assigneeName: first?.name || "", assignees,
      cadence: endDate ? `${base} until ${endDate}` : base, recurrence, endDate, startDate: draft.date, nextDue: draft.date,
      time, notifyAt: instant.toISOString(), location: draft.location || "", completedBy: {}
    } };
  }
  const isAnnual = ANNUAL_EVENT_TYPES.includes(draft.type);
  const dateTime = `${draft.date}T${time}`;
  const instant = localInstant(draft.date, time);
  if (!instant) return null;
  const monthDay = isAnnual ? draft.date.slice(5) : undefined;
  const reminderDays = isAnnual ? (draft.reminderDays ?? 1) : undefined;
  const recurrence = (REMINDER_RECURRENCES.includes(draft.recurrence) ? draft.recurrence : "once") as ReminderRecurrence;
  return { kind: "event", item: {
    id: createId(), title: draft.title, date: draft.date, dateTime,
    notifyAt: isAnnual ? annualEventNotifyAt(monthDay as string, reminderDays as number, time, now) : instant.toISOString(),
    ...(isAnnual ? {} : { reminderAt: dateTime }),
    ...(monthDay ? { monthDay } : {}),
    type: isAnnual ? draft.type : "reminder", annual: isAnnual, location: isAnnual ? "" : draft.location || "",
    ...(reminderDays !== undefined ? { reminderDays } : {}),
    ...(isAnnual ? {} : { recurrence }),
    owner: first?.key || "", ownerName: first?.name || "", assignees, completedBy: []
  } };
}
