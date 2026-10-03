import assert from "node:assert/strict";
import test from "node:test";
import { advanceReminderDate, isReminderComplete, advanceChoreDate, choreCadenceLabels } from "../src/calendarLogic.ts";

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

test("advanceChoreDate leaves a one-off chore's date unchanged", () => {
  assert.equal(advanceChoreDate("2026-07-13", "once"), "2026-07-13");
  assert.equal(advanceChoreDate("2026-07-13", undefined), "2026-07-13");
});

test("advanceChoreDate steps weekly/biweekly/triweekly chores by the right number of days", () => {
  assert.equal(advanceChoreDate("2026-07-13", "weekly"), "2026-07-20");
  assert.equal(advanceChoreDate("2026-07-13", "biweekly"), "2026-07-27");
  assert.equal(advanceChoreDate("2026-07-13", "triweekly"), "2026-08-03");
});

test("advanceChoreDate steps month-multiple chores, clamping short months", () => {
  assert.equal(advanceChoreDate("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(advanceChoreDate("2026-07-13", "every3months"), "2026-10-13");
  assert.equal(advanceChoreDate("2026-07-13", "every4months"), "2026-11-13");
  assert.equal(advanceChoreDate("2026-07-13", "every6months"), "2027-01-13");
  assert.equal(advanceChoreDate("2026-07-13", "yearly"), "2027-07-13");
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
