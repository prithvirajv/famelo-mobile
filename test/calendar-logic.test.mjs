import assert from "node:assert/strict";
import test from "node:test";
import { advanceReminderDate, isReminderComplete } from "../src/calendarLogic.ts";

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
