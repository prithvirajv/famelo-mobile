import assert from "node:assert/strict";
import test from "node:test";
import { advanceReminderDate, isReminderComplete, choreCadenceLabels, currentChoreOccurrenceDate, choreCompletedKeys, isChoreOccurrenceComplete, toggleChoreCompletion, completionKeyFor, repairChoreCompletion, reminderTiming, advanceRecurringReminder, isValidClockTime, effectiveAssignees } from "../src/calendarLogic.ts";

test("advanceReminderDate leaves a one-off reminder's date unchanged", () => {
  assert.equal(advanceReminderDate("2026-07-13", "once"), "2026-07-13");
  assert.equal(advanceReminderDate("2026-07-13", undefined), "2026-07-13");
});

test("advanceReminderDate rolls a weekly reminder forward exactly 7 days", () => {
  assert.equal(advanceReminderDate("2026-07-13", "weekly"), "2026-07-20");
});

test("advanceReminderDate rolls a monthly reminder forward one calendar month, clamping short months", () => {
  assert.equal(advanceReminderDate("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(advanceReminderDate("2026-07-13", "monthly"), "2026-08-13");
});

test("advanceReminderDate rolls a yearly reminder forward twelve months", () => {
  assert.equal(advanceReminderDate("2026-07-13", "yearly"), "2027-07-13");
});

test("isReminderComplete is true once every assignee has completed it", () => {
  assert.equal(isReminderComplete(["a@x.com"], ["a@x.com", "b@x.com"]), false);
  assert.equal(isReminderComplete(["a@x.com", "b@x.com"], ["a@x.com", "b@x.com"]), true);
});

test("isReminderComplete falls back to any completion when the reminder has no assignees", () => {
  assert.equal(isReminderComplete([], []), false);
  assert.equal(isReminderComplete(["household"], []), true);
});

test("choreCadenceLabels covers every recurrence value with a human label", () => {
  assert.equal(choreCadenceLabels.once, "Once");
  assert.equal(choreCadenceLabels.biweekly, "Every 2 weeks");
  assert.equal(choreCadenceLabels.every3months, "Every 3 months");
});

import { normalizeReminderPhotoDraft, buildPhotoReminderEvent } from "../src/calendarLogic.ts";

test("normalizeReminderPhotoDraft keeps valid fields and blanks anything malformed instead of throwing", () => {
  assert.deepEqual(normalizeReminderPhotoDraft({ title: " Dentist ", date: "2026-07-20", time: "14:30", location: " 12 Main St " }), { title: "Dentist", date: "2026-07-20", time: "14:30", location: "12 Main St" });
  assert.deepEqual(normalizeReminderPhotoDraft({ title: "x", date: "July 20", time: "2pm", location: null }), { title: "x", date: "", time: "", location: "" });
  assert.deepEqual(normalizeReminderPhotoDraft(null), { title: "", date: "", time: "", location: "" });
  assert.deepEqual(normalizeReminderPhotoDraft("garbage"), { title: "", date: "", time: "", location: "" });
  assert.equal(normalizeReminderPhotoDraft({ title: "a".repeat(500) }).title.length, 200);
});

test("buildPhotoReminderEvent needs a title and valid date, defaults the time to 09:00, and always sets notifyAt", () => {
  const user = { email: "a@x.com", name: "Alex" };
  const event = buildPhotoReminderEvent({ title: " Party ", date: "2026-07-20", time: "", location: " Park " }, user, () => "event-1");
  assert.equal(event.id, "event-1");
  assert.equal(event.title, "Party");
  assert.equal(event.dateTime, "2026-07-20T09:00");
  assert.equal(event.reminderAt, "2026-07-20T09:00");
  assert.equal(event.notifyAt, new Date("2026-07-20T09:00").toISOString());
  assert.equal(event.location, "Park");
  assert.equal(event.type, "reminder");
  assert.equal(event.recurrence, "once");
  assert.deepEqual(event.assignees, [{ key: "a@x.com", name: "Alex", email: "a@x.com" }]);
  assert.equal(event.owner, "a@x.com");
  assert.equal(buildPhotoReminderEvent({ title: "Party", date: "2026-07-20", time: "18:45", location: "" }, user, () => "e").dateTime, "2026-07-20T18:45");
  assert.equal(buildPhotoReminderEvent({ title: "Party", date: "2026-07-20", time: "25:99", location: "" }, user, () => "e").dateTime, "2026-07-20T09:00");
  assert.equal(buildPhotoReminderEvent({ title: "  ", date: "2026-07-20", time: "", location: "" }, user, () => "e"), null);
  assert.equal(buildPhotoReminderEvent({ title: "Party", date: "", time: "", location: "" }, user, () => "e"), null);
  assert.equal(buildPhotoReminderEvent({ title: "Party", date: "2026-7-2", time: "", location: "" }, user, () => "e"), null);
});

const chore = (overrides = {}) => ({ id: "c1", title: "Trash", assignee: "a@x.com", cadence: "Weekly", nextDue: "2026-07-01", startDate: "2026-07-01", recurrence: "weekly", ...overrides });
const day = (y, m, d) => new Date(y, m - 1, d);

test("currentChoreOccurrenceDate is the latest occurrence on/before today for weekly, biweekly, and triweekly chores", () => {
  // 2026-07-01 is a Wednesday
  assert.equal(currentChoreOccurrenceDate(chore(), day(2026, 7, 16)), "2026-07-15");
  assert.equal(currentChoreOccurrenceDate(chore(), day(2026, 7, 15)), "2026-07-15");
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "biweekly" }), day(2026, 7, 16)), "2026-07-15");
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "biweekly" }), day(2026, 7, 14)), "2026-07-01");
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "triweekly" }), day(2026, 7, 30)), "2026-07-22");
});

test("currentChoreOccurrenceDate walks month-step chores, clamping short months, and falls back to the start before it begins", () => {
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "monthly", startDate: "2026-01-31" }), day(2026, 3, 10)), "2026-02-28");
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "monthly", startDate: "2026-01-31" }), day(2026, 3, 31)), "2026-03-31");
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "every3months", startDate: "2026-01-15" }), day(2026, 8, 1)), "2026-07-15");
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "yearly", startDate: "2025-07-13" }), day(2026, 7, 12)), "2025-07-13");
  assert.equal(currentChoreOccurrenceDate(chore({ startDate: "2026-09-01" }), day(2026, 7, 16)), "2026-09-01");
});

test("currentChoreOccurrenceDate honors once, endDate, the legacy nextDue anchor, and bad input", () => {
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "once", startDate: "2026-07-05" }), day(2026, 8, 1)), "2026-07-05");
  assert.equal(currentChoreOccurrenceDate(chore({ recurrence: "once", startDate: "2026-07-05", endDate: "2026-07-01" }), day(2026, 8, 1)), null);
  assert.equal(currentChoreOccurrenceDate(chore({ endDate: "2026-07-10" }), day(2026, 7, 30)), "2026-07-08");
  assert.equal(currentChoreOccurrenceDate(chore({ startDate: undefined, nextDue: "2026-07-01" }), day(2026, 7, 16)), "2026-07-15");
  assert.equal(currentChoreOccurrenceDate(chore({ startDate: undefined, nextDue: "" }), day(2026, 7, 16)), null);
});

test("chore completion is a date-keyed map: toggling adds then removes a key, and never touches startDate", () => {
  const start = chore({ completedBy: {} });
  const done = toggleChoreCompletion(start, "2026-07-15", "a@x.com");
  assert.deepEqual(done.completedBy, { "2026-07-15": ["a@x.com"] });
  assert.equal(done.startDate, "2026-07-01");
  assert.equal(done.nextDue, "2026-07-01");
  assert.deepEqual(toggleChoreCompletion(done, "2026-07-15", "a@x.com").completedBy, { "2026-07-15": [] });
  assert.deepEqual(toggleChoreCompletion(done, "2026-07-22", "a@x.com").completedBy, { "2026-07-15": ["a@x.com"], "2026-07-22": ["a@x.com"] });
  assert.deepEqual(choreCompletedKeys(done, "2026-07-15"), ["a@x.com"]);
  assert.deepEqual(choreCompletedKeys(done, "2026-08-01"), []);
});

test("isChoreOccurrenceComplete needs every assignee, or anyone when there are none", () => {
  const joint = chore({ assignees: [{ key: "a@x.com" }, { key: "b@x.com" }], completedBy: { "2026-07-15": ["a@x.com"] } });
  assert.equal(isChoreOccurrenceComplete(joint, "2026-07-15"), false);
  assert.equal(isChoreOccurrenceComplete({ ...joint, completedBy: { "2026-07-15": ["a@x.com", "b@x.com"] } }, "2026-07-15"), true);
  assert.equal(isChoreOccurrenceComplete(chore({ completedBy: { "2026-07-15": ["household"] } }), "2026-07-15"), true);
  assert.equal(isChoreOccurrenceComplete(chore({ completedBy: {} }), "2026-07-15"), false);
});

test("a flat-array completedBy (old mobile shape) is treated as empty and repaired, other chores untouched", () => {
  const broken = chore({ completedBy: ["a@x.com"] });
  assert.deepEqual(choreCompletedKeys(broken, "2026-07-15"), []);
  assert.deepEqual(toggleChoreCompletion(broken, "2026-07-15", "a@x.com").completedBy, { "2026-07-15": ["a@x.com"] });
  const fine = chore({ id: "c2", completedBy: { "2026-07-08": ["a@x.com"] } });
  const state = { calendar: { events: [], chores: [broken, fine] } };
  const repaired = repairChoreCompletion(state);
  assert.deepEqual(repaired.calendar.chores[0].completedBy, {});
  assert.equal(repaired.calendar.chores[1], fine);
  assert.equal(repairChoreCompletion({ calendar: { events: [], chores: [fine] } }).calendar.chores[0], fine);
  const clean = { calendar: { events: [], chores: [fine] } };
  assert.equal(repairChoreCompletion(clean), clean);
});

test("completionKeyFor: an assignee marks their own part, no assignees means household, a non-assignee only watches", () => {
  assert.equal(completionKeyFor([], "a@x.com"), "household");
  assert.equal(completionKeyFor(undefined, "a@x.com"), "household");
  assert.equal(completionKeyFor([{ key: "a@x.com" }, { key: "b@x.com" }], "b@x.com"), "b@x.com");
  assert.equal(completionKeyFor([{ key: "b@x.com" }], "a@x.com"), null);
});

test("effectiveAssignees upgrades a single owner/assignee the way web does, and prefers a real assignees list", () => {
  assert.deepEqual(effectiveAssignees({ owner: "a@x.com" }), [{ key: "a@x.com" }]);
  assert.deepEqual(effectiveAssignees({ assignee: "b@x.com" }), [{ key: "b@x.com" }]);
  assert.deepEqual(effectiveAssignees({ owner: "a@x.com", assignees: [{ key: "c@x.com" }] }), [{ key: "c@x.com" }]);
  assert.deepEqual(effectiveAssignees({}), []);
});

test("reminderTiming sets dateTime/reminderAt/notifyAt, defaults a blank or bad time to 09:00, and rejects a bad date", () => {
  const t = reminderTiming("2026-07-20", "14:30");
  assert.deepEqual(t, { dateTime: "2026-07-20T14:30", reminderAt: "2026-07-20T14:30", notifyAt: new Date("2026-07-20T14:30").toISOString() });
  assert.equal(reminderTiming("2026-07-20", "").dateTime, "2026-07-20T09:00");
  assert.equal(reminderTiming("2026-07-20", "9pm").dateTime, "2026-07-20T09:00");
  assert.equal(reminderTiming("July 20", "10:00"), null);
  assert.equal(reminderTiming("", "10:00"), null);
  assert.equal(isValidClockTime("23:59"), true);
  assert.equal(isValidClockTime(" 07:05 "), true);
  assert.equal(isValidClockTime("24:00"), false);
  assert.equal(isValidClockTime("7:05"), false);
});

test("advanceRecurringReminder moves date, dateTime, reminderAt and notifyAt together and resets completion; one-off and non-reminders are untouched", () => {
  const event = { id: "e", title: "Rent", date: "2026-07-31", type: "reminder", recurrence: "monthly", dateTime: "2026-07-31T10:00", reminderAt: "2026-07-30T08:30", notifyAt: new Date("2026-07-30T08:30").toISOString(), completedBy: ["a@x.com"] };
  const next = advanceRecurringReminder(event);
  assert.equal(next.date, "2026-08-31");
  assert.equal(next.dateTime, "2026-08-31T10:00");
  assert.equal(next.reminderAt, "2026-08-30T08:30");
  assert.equal(next.notifyAt, new Date("2026-08-30T08:30").toISOString());
  assert.deepEqual(next.completedBy, []);
  const once = { ...event, recurrence: "once" };
  assert.equal(advanceRecurringReminder(once), once);
  const birthday = { ...event, type: "birthday" };
  assert.equal(advanceRecurringReminder(birthday), birthday);
  const weekly = advanceRecurringReminder({ id: "w", title: "Bins", date: "2026-07-13", type: "reminder", recurrence: "weekly" });
  assert.equal(weekly.date, "2026-07-20");
  assert.equal(weekly.dateTime, "2026-07-20T09:00");
  assert.equal(weekly.reminderAt, undefined);
  assert.equal(weekly.notifyAt, undefined);
});
