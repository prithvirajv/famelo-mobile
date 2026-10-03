import assert from "node:assert/strict";
import test from "node:test";
import { homeNoteReminders, homeRecentActivity, billAndGoalReminders, dismissBudgetReminder } from "../src/homeLogic.ts";
import { isRelevantToViewer, isChoreOccurrencePendingFor, isReminderPendingFor, nextPendingChoreOccurrence, toggleReminderCompletion, homeActionItems, homeWeekStrip } from "../src/calendarLogic.ts";

const me = "me@example.com"; const other = "other@example.com";
const a = (key) => ({ key, name: key.split("@")[0], email: key });

test("a viewer only sees what is assigned to them (or to nobody)", () => {
  assert.equal(isRelevantToViewer(undefined, me), true);
  assert.equal(isRelevantToViewer([], me), true);
  assert.equal(isRelevantToViewer([a(other)], me), false);
  assert.equal(isRelevantToViewer([a(other), a(me)], me), true);
  assert.equal(isRelevantToViewer([a(other)], ""), true);
});

test("a jointly assigned chore stops being pending for the viewer once they did their own part", () => {
  const chore = { assignees: [a(me), a(other)], completedBy: { "2026-07-06": [me] } };
  assert.equal(isChoreOccurrencePendingFor(chore, "2026-07-06", me), false);
  assert.equal(isChoreOccurrencePendingFor(chore, "2026-07-06", other), true);
  assert.equal(isChoreOccurrencePendingFor({ assignees: [], completedBy: {} }, "2026-07-06", me), true);
  assert.equal(isReminderPendingFor({ assignees: [a(me), a(other)], completedBy: [me] }, me), false);
  assert.equal(isReminderPendingFor({ assignees: [a(me), a(other)], completedBy: [me] }, "third@example.com"), true);
});

test("nextPendingChoreOccurrence finds the earliest occurrence the viewer has not done, skipping completed ones, and respects the end date", () => {
  const weekly = { title: "Dishes", assignee: me, cadence: "", nextDue: "2026-07-01", startDate: "2026-07-01", recurrence: "weekly", assignees: [a(me)], completedBy: { "2026-07-01": [me], "2026-07-08": [me] } };
  assert.equal(nextPendingChoreOccurrence(weekly, me).date, "2026-07-15");
  assert.equal(nextPendingChoreOccurrence({ ...weekly, endDate: "2026-07-10" }, me), null);
  const once = { ...weekly, recurrence: "once", completedBy: {} };
  assert.equal(nextPendingChoreOccurrence(once, me).date, "2026-07-01");
  assert.equal(nextPendingChoreOccurrence({ ...once, completedBy: { "2026-07-01": [me] } }, me), null);
  const monthly = { ...weekly, recurrence: "monthly", startDate: "2026-01-31", completedBy: {} };
  assert.equal(nextPendingChoreOccurrence(monthly, me).date, "2026-01-31");
  assert.equal(nextPendingChoreOccurrence({ title: "x", assignee: "", cadence: "", nextDue: "" }, me), null);
});

test("toggleReminderCompletion completes for the viewer, can undo, rolls a recurring reminder forward, and refuses non-assignees", () => {
  const reminder = { type: "reminder", title: "Pay rent", date: "2026-07-01", assignees: [a(me)], completedBy: [], recurrence: "monthly" };
  const done = toggleReminderCompletion(reminder, me);
  assert.equal(done.date, "2026-08-01", "monthly reminder advanced");
  assert.deepEqual(done.completedBy, [], "and reset to not done");
  const single = { ...reminder, recurrence: "once" };
  const completed = toggleReminderCompletion(single, me);
  assert.deepEqual(completed.completedBy, [me]);
  assert.deepEqual(toggleReminderCompletion(completed, me).completedBy, []);
  assert.equal(toggleReminderCompletion(single, other), null);
});

test("home action items list past-due and due-today chores, annual events and reminders for the viewer, oldest first", () => {
  const calendar = {
    chores: [
      { title: "Dishes", assignee: me, cadence: "", nextDue: "2026-07-08", startDate: "2026-07-08", recurrence: "once", assignees: [a(me)], completedBy: {} },
      { title: "Future", assignee: me, cadence: "", nextDue: "2026-07-20", startDate: "2026-07-20", recurrence: "once", assignees: [a(me)], completedBy: {} },
      { title: "Theirs", assignee: other, cadence: "", nextDue: "2026-07-08", startDate: "2026-07-08", recurrence: "once", assignees: [a(other)], completedBy: {} }
    ],
    events: [
      { type: "reminder", title: "Call mom", date: "2026-07-10", assignees: [a(me)], completedBy: [] },
      { type: "reminder", title: "Done already", date: "2026-07-09", assignees: [a(me)], completedBy: [me] },
      { type: "birthday", title: "Sam's birthday reminder", monthDay: "07-10", assignees: [a(me)], wishedBy: {} },
      { type: "birthday", title: "Later birthday", monthDay: "09-10", assignees: [a(me)], wishedBy: {} }
    ]
  };
  const items = homeActionItems(calendar, me, "2026-07-10", new Date(2026, 6, 10));
  assert.deepEqual(items.map((i) => [i.title, i.kind, i.overdue]), [["Dishes", "chore", true], ["Call mom", "reminder", false], ["Sam's birthday", "annual", false]]);
  assert.deepEqual(items.map((i) => i.index), [0, 0, 2]);
  assert.equal(items[2].year, 2026);
});

test("week strip covers 7 days from today with pending items and unpaid bills only", () => {
  const calendar = { chores: [], events: [{ type: "reminder", title: "Dentist", date: "2026-07-12", assignees: [a(me)], completedBy: [] }, { type: "reminder", title: "Past", date: "2026-07-01", assignees: [], completedBy: [] }] };
  const strip = homeWeekStrip(calendar, me, [{ name: "Rent", dueDay: 11, paid: false }, { name: "Paid bill", dueDay: 11, paid: true }, { name: "Far", dueDay: 28, paid: false }], new Date(2026, 6, 10));
  assert.equal(strip.length, 7);
  assert.equal(strip[0].dateKey, "2026-07-10");
  assert.deepEqual(strip[1].items, [{ title: "Rent", icon: "🧾" }]);
  assert.deepEqual(strip[2].items, [{ title: "Dentist", icon: "⏰" }]);
  assert.equal(strip.flatMap((d) => d.items).length, 2);
});

test("note reminders due today or earlier, soonest first, excluding archived and trashed", () => {
  const notes = [
    { id: "a", title: "Late", reminder: "2026-07-08T09:00", archived: false, trashed: false },
    { id: "b", title: "", reminder: "2026-07-10", archived: false, trashed: false },
    { id: "c", title: "Future", reminder: "2026-07-11", archived: false, trashed: false },
    { id: "d", title: "Archived", reminder: "2026-07-01", archived: true, trashed: false },
    { id: "e", title: "No reminder", archived: false, trashed: false }
  ];
  assert.deepEqual(homeNoteReminders(notes, "2026-07-10").map((n) => [n.id, n.title, n.overdue]), [["a", "Late", true], ["b", "Untitled note", false]]);
});

test("recent activity merges notes, decisions and settled IOUs newest first and caps the list", () => {
  const state = {
    notes: { entries: [{ title: "N", createdAt: "2026-07-05T00:00:00Z", trashed: false }, { title: "T", createdAt: "2026-07-09T00:00:00Z", trashed: true }] },
    decisions: [{ title: "D", createdAt: "2026-07-01T00:00:00Z", decidedAt: "2026-07-06T00:00:00Z" }],
    ious: [{ person: "Sam", amount: 20, settled: true, settledDate: "2026-07-07" }, { person: "Open", amount: 5, settled: false, settledDate: "" }]
  };
  assert.deepEqual(homeRecentActivity(state).map((i) => i.detail), ["20", "Decision made", "Note added", "Decision raised"]);
  assert.equal(homeRecentActivity(state, 2).length, 2);
});

test("bill and goal reminders show what is left, skip dismissed ones, and dismissing is per month and idempotent", () => {
  const state = {
    budget: { month: "2026-07", income: 0, dismissedReminders: { "2026-07": ["bill:l2"] }, categories: [{ name: "Home", color: "", lines: [{ id: "l1", name: "Rent", planned: 1000, dueDay: 1 }, { id: "l2", name: "Power", planned: 100, dueDay: 5 }, { id: "l3", name: "Fun", planned: 50 }, { id: "l4", name: "Paid", planned: 10, dueDay: 2 }] }] },
    goals: { sinkingFunds: [{ name: "Trip", target: 500, saved: 100, targetDate: "2026-12-01" }, { name: "Done", target: 10, saved: 10 }] }
  };
  const spent = { l1: 400, l4: 10 };
  const list = billAndGoalReminders(state, (id) => spent[id] || 0);
  assert.deepEqual(list.map((r) => [r.id, r.amount]), [["bill:l1", 600], ["goal:Trip", 400]]);
  const dismissed = dismissBudgetReminder(state, "bill:l1");
  assert.deepEqual(dismissed.budget.dismissedReminders["2026-07"], ["bill:l2", "bill:l1"]);
  assert.equal(dismissBudgetReminder(dismissed, "bill:l1"), dismissed);
  assert.deepEqual(state.budget.dismissedReminders["2026-07"], ["bill:l2"]);
  assert.deepEqual(billAndGoalReminders(dismissed, (id) => spent[id] || 0).map((r) => r.id), ["goal:Trip"]);
});
