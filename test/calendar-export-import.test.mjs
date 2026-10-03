import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarIcs, parseIcsText, icsEventsToCalendarDrafts, buildCalendarCsv, parseCalendarCsv, parseDelimitedText, sanitizeCalendarDrafts, calendarDraftToItem, resolveImportAssignees, annualEventNotifyAt, foldIcsLine, icsEscapeText, icsUnescapeText } from "../src/calendarLogic.ts";

const NOW = new Date(2026, 6, 10, 12, 0, 0);
const chore = { id: "c1", title: "Take out trash", assignee: "a@x.com", cadence: "Every 2 weeks", nextDue: "2026-07-01", startDate: "2026-07-01", recurrence: "biweekly", endDate: "2026-12-31", time: "18:30", location: "Curb", assignees: [{ key: "a@x.com", name: "Alex", email: "a@x.com" }, { key: "b@x.com", name: "Bo", email: "b@x.com" }] };
const reminder = { id: "e1", title: "Dentist, 2nd visit; bring forms", date: "2026-07-20", type: "reminder", recurrence: "monthly", dateTime: "2026-07-20T14:30", location: "12 Main St", assignees: [{ key: "a@x.com", name: "Alex", email: "a@x.com" }] };
const birthday = { id: "e2", title: "Sam's birthday", date: "1990-03-09", type: "birthday", annual: true, reminderDays: 3, monthDay: "03-09" };

test("ICS text escaping round-trips and long lines fold at 73 chars and unfold back", () => {
  assert.equal(icsUnescapeText(icsEscapeText("a,b;c\\d\ne")), "a,b;c\\d\ne");
  const long = "SUMMARY:" + "x".repeat(200);
  const folded = foldIcsLine(long);
  assert.ok(folded.split("\r\n").every((line) => line.length <= 73));
  assert.equal(folded.split("\r\n").map((line, index) => (index ? line.slice(1) : line)).join(""), long);
  assert.equal(foldIcsLine("short"), "short");
});

test("exporting then importing .ics round-trips chores, reminders and annual events losslessly", () => {
  const ics = buildCalendarIcs([reminder, birthday], [chore], NOW);
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0/);
  assert.match(ics, /DTSTAMP:20260710T/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231T235959/);
  assert.match(ics, /DTSTART;VALUE=DATE:19900309/);
  const drafts = icsEventsToCalendarDrafts(parseIcsText(ics));
  assert.equal(drafts.length, 3);
  const [c, r, b] = drafts;
  assert.deepEqual(c, { kind: "chore", type: "chore", title: "Take out trash", date: "2026-07-01", time: "18:30", recurrence: "biweekly", endDate: "2026-12-31", location: "Curb", assigneeKeys: ["a@x.com", "b@x.com"] });
  assert.deepEqual(r, { kind: "event", type: "reminder", title: "Dentist, 2nd visit; bring forms", date: "2026-07-20", time: "14:30", recurrence: "monthly", endDate: "", location: "12 Main St", assigneeKeys: ["a@x.com"] });
  assert.deepEqual(b, { kind: "event", type: "birthday", title: "Sam's birthday", date: "1990-03-09", time: "09:00", recurrence: "yearly", endDate: "", location: "", assigneeKeys: [], reminderDays: 3 });
});

test("an external .ics (no FamilyLoop markers) becomes generic reminders, mapping the repeat rule and handling UTC and date-only starts", () => {
  const text = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Team sync", "DTSTART:20260805T143000Z", "RRULE:FREQ=WEEKLY;BYDAY=WE", "LOCATION:Room 4\\, Floor 2", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261225", "RRULE:FREQ=YEARLY", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Untimed", "DTSTART:20260901", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:20260902T100000", "END:VEVENT", "END:VCALENDAR"
  ].join("\n");
  const drafts = icsEventsToCalendarDrafts(parseIcsText(text));
  assert.equal(drafts.length, 3, "an event with no title is dropped");
  assert.deepEqual(drafts[0], { kind: "event", type: "reminder", title: "Team sync", date: "2026-08-05", time: "14:30", recurrence: "weekly", endDate: "", location: "Room 4, Floor 2", assigneeKeys: [] });
  assert.equal(drafts[1].recurrence, "yearly");
  assert.equal(drafts[1].time, "09:00");
  assert.equal(drafts[2].recurrence, "once");
  assert.equal(drafts[2].date, "2026-09-01");
});

test("parseIcsText unfolds continuation lines and tolerates CRLF, LF and stray text outside events", () => {
  const text = "junk\r\nBEGIN:VEVENT\r\nSUMMARY:Very long\r\n  title here\r\nDTSTART:20260805T100000\r\nEND:VEVENT\r\n";
  const [event] = parseIcsText(text);
  assert.equal(event.summary, "Very long title here");
  assert.deepEqual(event.dtstart, { date: "2026-08-05", time: "10:00" });
});

test("CSV export then import round-trips, including commas, quotes and newlines inside fields", () => {
  const tricky = { ...reminder, title: 'He said "hi", then left\nagain', location: "A, B" };
  const csv = buildCalendarCsv([tricky, birthday], [chore]);
  assert.match(csv.split("\r\n")[0], /^Kind,Type,Title,Date,Time,Recurrence,EndDate,Location,Assignees,ReminderDays$/);
  const drafts = parseCalendarCsv(csv);
  assert.equal(drafts.length, 3);
  assert.equal(drafts[0].kind, "chore");
  assert.equal(drafts[0].assigneeKeys.join("|"), "a@x.com|b@x.com");
  assert.equal(drafts[1].title, 'He said "hi", then left\nagain');
  assert.equal(drafts[1].location, "A, B");
  assert.equal(drafts[2].recurrence, "yearly");
  assert.equal(drafts[2].reminderDays, 3);
  assert.equal(drafts[2].time, "09:00");
});

test("parseCalendarCsv needs Title and Date columns, matches headers case-insensitively, and skips blank rows", () => {
  assert.deepEqual(parseCalendarCsv(""), []);
  assert.deepEqual(parseCalendarCsv("Foo,Bar\n1,2"), []);
  const drafts = parseCalendarCsv("title,DATE\nPay rent,2026-08-01\n\n,2026-08-02\nNo date,\n");
  assert.deepEqual(drafts.map((d) => [d.title, d.date, d.kind, d.type, d.recurrence, d.time]), [["Pay rent", "2026-08-01", "event", "reminder", "once", "09:00"]]);
  assert.deepEqual(parseDelimitedText('a,"b,c"\r\nd,e'), [["a", "b,c"], ["d", "e"]]);
});

test("sanitizeCalendarDrafts drops missing titles and impossible dates, and repairs bad times and recurrences", () => {
  const base = { kind: "event", type: "reminder", title: "T", date: "2026-08-01", time: "09:00", recurrence: "once", endDate: "", location: "", assigneeKeys: [] };
  const { drafts, skipped } = sanitizeCalendarDrafts([
    base,
    { ...base, title: "  " },
    { ...base, date: "2026-02-30" },
    { ...base, date: "garbage" },
    { ...base, time: "7pm", recurrence: "fortnightly", endDate: "soon" },
    { ...base, kind: "chore", type: "whatever", recurrence: "biweekly", endDate: "2026-12-31" },
    { ...base, kind: "wat" }
  ]);
  assert.equal(skipped, 3);
  assert.equal(drafts.length, 4);
  assert.equal(drafts[1].time, "09:00");
  assert.equal(drafts[1].recurrence, "once");
  assert.equal(drafts[1].endDate, "");
  assert.equal(drafts[2].type, "chore");
  assert.equal(drafts[2].endDate, "2026-12-31");
  assert.equal(drafts[3].kind, "event");
});

test("resolveImportAssignees maps known members, keeps unknown keys, and falls back to the importing user", () => {
  const members = [{ name: "Alex", email: "a@x.com" }];
  const me = { email: "me@x.com", name: "Me" };
  assert.deepEqual(resolveImportAssignees(["a@x.com", "stranger@y.com", "Cousin"], members, me), [
    { key: "a@x.com", name: "Alex", email: "a@x.com" }, { key: "stranger@y.com", name: "stranger@y.com", email: "stranger@y.com" }, { key: "Cousin", name: "Cousin", email: "" }
  ]);
  assert.deepEqual(resolveImportAssignees([], members, me), [{ key: "me@x.com", name: "Me", email: "me@x.com" }]);
  assert.equal(resolveImportAssignees(["a@x.com", "a@x.com"], members, me).length, 1);
});

test("calendarDraftToItem builds a chore with notifyAt, an 'until' cadence label and web's date-keyed completion map", () => {
  const assignees = [{ key: "a@x.com", name: "Alex", email: "a@x.com" }];
  const result = calendarDraftToItem({ kind: "chore", type: "chore", title: "Trash", date: "2026-08-01", time: "18:30", recurrence: "biweekly", endDate: "2026-12-31", location: "Curb", assigneeKeys: [] }, assignees, () => "id1", NOW);
  assert.equal(result.kind, "chore");
  assert.deepEqual(result.item, {
    id: "id1", title: "Trash", assignee: "a@x.com", assigneeName: "Alex", assignees, cadence: "Every 2 weeks until 2026-12-31", recurrence: "biweekly", endDate: "2026-12-31",
    startDate: "2026-08-01", nextDue: "2026-08-01", time: "18:30", notifyAt: new Date("2026-08-01T18:30").toISOString(), location: "Curb", completedBy: {}
  });
  const once = calendarDraftToItem({ kind: "chore", type: "chore", title: "Once", date: "2026-08-01", time: "09:00", recurrence: "once", endDate: "2026-12-31", location: "", assigneeKeys: [] }, assignees, () => "id2", NOW);
  assert.equal(once.item.endDate, "");
  assert.equal(once.item.cadence, "Once");
});

test("calendarDraftToItem builds a reminder with notifyAt/reminderAt, and an annual event keyed on monthDay with a next-occurrence notifyAt", () => {
  const assignees = [{ key: "a@x.com", name: "Alex", email: "a@x.com" }];
  const rem = calendarDraftToItem({ kind: "event", type: "reminder", title: "Dentist", date: "2026-08-01", time: "10:15", recurrence: "weekly", endDate: "", location: "Clinic", assigneeKeys: [] }, assignees, () => "e1", NOW);
  assert.equal(rem.kind, "event");
  assert.equal(rem.item.dateTime, "2026-08-01T10:15");
  assert.equal(rem.item.reminderAt, "2026-08-01T10:15");
  assert.equal(rem.item.notifyAt, new Date("2026-08-01T10:15").toISOString());
  assert.equal(rem.item.recurrence, "weekly");
  assert.equal(rem.item.annual, false);
  assert.equal(rem.item.owner, "a@x.com");
  const bday = calendarDraftToItem({ kind: "event", type: "birthday", title: "Sam", date: "1990-03-09", time: "08:00", recurrence: "yearly", endDate: "", location: "ignored", assigneeKeys: [] }, assignees, () => "e2", NOW);
  assert.equal(bday.item.annual, true);
  assert.equal(bday.item.monthDay, "03-09");
  assert.equal(bday.item.reminderDays, 1);
  assert.equal(bday.item.location, "");
  assert.equal(bday.item.recurrence, undefined);
  assert.equal(bday.item.reminderAt, undefined);
  assert.equal(bday.item.notifyAt, new Date(2027, 2, 8, 8, 0).toISOString());
});

test("annualEventNotifyAt targets this year's occurrence if still ahead, else next year's, minus the reminder days, clamping Feb 29", () => {
  assert.equal(annualEventNotifyAt("07-20", 2, "09:00", NOW), new Date(2026, 6, 18, 9, 0).toISOString());
  assert.equal(annualEventNotifyAt("07-04", 0, "21:30", NOW), new Date(2027, 6, 4, 21, 30).toISOString());
  assert.equal(annualEventNotifyAt("02-29", 0, "09:00", new Date(2026, 0, 5)), new Date(2026, 1, 28, 9, 0).toISOString());
  assert.equal(annualEventNotifyAt("07-10", 0, "bad", NOW), new Date(2026, 6, 10, 9, 0).toISOString());
});
