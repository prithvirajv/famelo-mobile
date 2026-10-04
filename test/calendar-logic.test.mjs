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

import { localInstant } from "../src/calendarLogic.ts";

test("localInstant builds device-local times from numeric parts and rejects anything that isn't a real date/time instead of rolling it over", () => {
  assert.equal(localInstant("2026-07-20", "14:30").getTime(), new Date(2026, 6, 20, 14, 30).getTime());
  assert.equal(localInstant(" 2026-07-20 ", " 09:05 ").getHours(), 9);
  assert.equal(localInstant("2026-13-01", "09:00"), null);
  assert.equal(localInstant("2026-02-30", "09:00"), null);
  assert.equal(localInstant("2026-07-20", "25:00"), null);
  assert.equal(localInstant("2026-07-20", "09:60"), null);
  assert.equal(localInstant("garbage", "09:00"), null);
  assert.equal(localInstant("2026-07-20", ""), null);
  assert.equal(reminderTiming("2026-02-30", "09:00"), null, "a date that does not exist is not a reminder time");
  assert.equal(reminderTiming("2026-07-20", "9pm").dateTime, "2026-07-20T09:00");
});

import { annualEventDate, isAnnualEventYearComplete, annualWishedKeys, toggleAnnualWished, nextPendingAnnualOccurrence, annualEventDisplayTitle, buildAnnualEvent, updateAnnualEvent, REMIND_BEFORE_OPTIONS } from "../src/calendarLogic.ts";

const bday = (overrides = {}) => ({ id: "b1", title: "Sam's birthday reminder", date: "1990-03-09", monthDay: "03-09", type: "birthday", annual: true, reminderDays: 3, assignees: [{ key: "a@x.com", name: "Alex", email: "a@x.com" }], wishedBy: {}, ...overrides });
const me = { email: "a@x.com", name: "Alex" };

test("annualEventDate uses the month-day in any year and clamps Feb 29 in a non-leap year", () => {
  assert.equal(annualEventDate(bday(), 2026).getTime(), new Date(2026, 2, 9).getTime());
  assert.equal(annualEventDate({ date: "2000-02-29" }, 2027).getTime(), new Date(2027, 1, 28).getTime());
  assert.equal(annualEventDate({ date: "2000-02-29" }, 2028).getTime(), new Date(2028, 1, 29).getTime());
  assert.equal(annualEventDate({ date: "1990-03-09", monthDay: "12-25" }, 2026).getTime(), new Date(2026, 11, 25).getTime());
});

test("wishing is per person per year: toggling adds then removes only your own mark, and a year is complete once every assignee marked it", () => {
  const joint = bday({ assignees: [{ key: "a@x.com" }, { key: "b@x.com" }] });
  const aWished = toggleAnnualWished(joint, 2026, "a@x.com");
  assert.deepEqual(annualWishedKeys(aWished, 2026), ["a@x.com"]);
  assert.equal(isAnnualEventYearComplete(aWished, 2026), false);
  const both = toggleAnnualWished(aWished, 2026, "b@x.com");
  assert.equal(isAnnualEventYearComplete(both, 2026), true);
  assert.equal(isAnnualEventYearComplete(both, 2027), false);
  assert.deepEqual(annualWishedKeys(toggleAnnualWished(both, 2026, "a@x.com"), 2026), ["b@x.com"]);
  assert.deepEqual(joint.wishedBy, {}, "never mutates the input");
  assert.equal(isAnnualEventYearComplete(bday({ assignees: [], wishedBy: { 2026: ["anyone"] } }), 2026), true);
  assert.equal(isAnnualEventYearComplete(bday({ assignees: [] }), 2026), false);
});

test("nextPendingAnnualOccurrence shows an overdue unwished year instead of skipping ahead, then moves on once wished", () => {
  const ref = new Date(2026, 5, 1);
  assert.deepEqual(nextPendingAnnualOccurrence(bday(), "a@x.com", ref), { date: "2026-03-09", year: 2026 });
  const wished = toggleAnnualWished(bday(), 2026, "a@x.com");
  assert.deepEqual(nextPendingAnnualOccurrence(wished, "a@x.com", ref), { date: "2027-03-09", year: 2027 });
  assert.deepEqual(nextPendingAnnualOccurrence(wished, "b@x.com", ref), { date: "2026-03-09", year: 2026 }, "someone else's mark doesn't clear mine");
  assert.deepEqual(nextPendingAnnualOccurrence(wished, undefined, ref), { date: "2027-03-09", year: 2027 });
});

test("annualEventDisplayTitle strips a trailing 'reminder' and falls back to the type's label", () => {
  assert.equal(annualEventDisplayTitle(bday()), "Sam's birthday");
  assert.equal(annualEventDisplayTitle({ title: "", type: "anniversary" }), "Anniversary");
  assert.equal(annualEventDisplayTitle({ title: "Mom and Dad", type: "anniversary" }), "Mom and Dad");
});

test("buildAnnualEvent writes web's shape: monthDay, assignee, empty wishes and a notifyAt on the next occurrence minus the reminder days", () => {
  const now = new Date(2026, 6, 10, 12);
  const event = buildAnnualEvent({ type: "birthday", title: " Sam ", date: "1990-03-09", time: "08:00", reminderDays: 3 }, me, () => "b9", now);
  assert.deepEqual({ ...event }, {
    id: "b9", title: "Sam", date: "1990-03-09", dateTime: "1990-03-09T08:00", monthDay: "03-09", reminderDays: 3, notifyAt: new Date(2027, 2, 6, 8, 0).toISOString(),
    type: "birthday", annual: true, location: "", owner: "a@x.com", ownerName: "Alex", assignees: [{ key: "a@x.com", name: "Alex", email: "a@x.com" }], wishedBy: {}
  });
  assert.equal(buildAnnualEvent({ type: "birthday", title: "Sam", date: "1990-03-09", time: "bad", reminderDays: 1 }, me, () => "x", now).dateTime, "1990-03-09T09:00");
  assert.equal(buildAnnualEvent({ type: "reminder", title: "x", date: "2026-03-09", time: "09:00", reminderDays: 1 }, me, () => "x", now), null);
  assert.equal(buildAnnualEvent({ type: "birthday", title: " ", date: "2026-03-09", time: "09:00", reminderDays: 1 }, me, () => "x", now), null);
  assert.equal(buildAnnualEvent({ type: "birthday", title: "x", date: "2026-02-30", time: "09:00", reminderDays: 1 }, me, () => "x", now), null);
  assert.deepEqual(REMIND_BEFORE_OPTIONS.map((o) => o.days), [0, 1, 3, 7, 14, -1]);
});

test("updateAnnualEvent changes title/date/reminder and re-derives monthDay and notifyAt, keeping wishes and assignees", () => {
  const now = new Date(2026, 6, 10, 12);
  const original = bday({ wishedBy: { 2026: ["a@x.com"] }, notifyAt: "stale" });
  const updated = updateAnnualEvent(original, { type: "birthday", title: "Samuel", date: "1991-12-25", time: "10:30", reminderDays: 7 }, now);
  assert.equal(updated.title, "Samuel");
  assert.equal(updated.monthDay, "12-25");
  assert.equal(updated.reminderDays, 7);
  assert.equal(updated.notifyAt, new Date(2026, 11, 18, 10, 30).toISOString());
  assert.deepEqual(updated.wishedBy, { 2026: ["a@x.com"] });
  assert.deepEqual(updated.assignees, original.assignees);
  assert.equal(updateAnnualEvent(original, { type: "birthday", title: "", date: "1991-12-25", time: "10:30", reminderDays: 7 }, now), null);
});

import { directionsUrl, matchesOwnerFilter } from "../src/calendarLogic.ts";

test("directionsUrl encodes a free-text place for Google Maps", () => {
  assert.equal(directionsUrl(" Dr. Lee, 12 Main St & 3rd "), "https://www.google.com/maps/dir/?api=1&destination=Dr.%20Lee%2C%2012%20Main%20St%20%26%203rd");
});

test("owner filter shows everything when empty and otherwise only the person's items, including legacy single-owner ones", () => {
  const joint = { assignees: [{ key: "a@x.co" }, { key: "b@x.co" }] };
  assert.equal(matchesOwnerFilter(joint, ""), true);
  assert.equal(matchesOwnerFilter(joint, "b@x.co"), true);
  assert.equal(matchesOwnerFilter(joint, "c@x.co"), false);
  assert.equal(matchesOwnerFilter({ owner: "c@x.co" }, "c@x.co"), true, "falls back to the legacy owner field");
  assert.equal(matchesOwnerFilter({ assignee: "d@x.co" }, "c@x.co"), false);
});
