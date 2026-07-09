import assert from "node:assert/strict";
import test from "node:test";
import {
  groupPlanTasksByBucket, defaultPlanAnchorDate,
  dailyTaskOccursOnDate, isDailyTaskDoneOnDate, toggleDailyTaskDoneOnDate,
  timeToMinutes, minutesToTime, snapMinutes, comparePlannedToActual
} from "../src/planLogic.ts";

test("groupPlanTasksByBucket sorts tasks into daily, weekly, and monthly groups", () => {
  const tasks = [
    { id: "1", bucket: "daily" },
    { id: "2", bucket: "weekly" },
    { id: "3", bucket: "monthly" },
    { id: "4", bucket: "daily" }
  ];
  const grouped = groupPlanTasksByBucket(tasks);
  assert.deepEqual(grouped.daily.map((task) => task.id), ["1", "4"]);
  assert.deepEqual(grouped.weekly.map((task) => task.id), ["2"]);
  assert.deepEqual(grouped.monthly.map((task) => task.id), ["3"]);
});

test("groupPlanTasksByBucket returns empty arrays for buckets with no tasks", () => {
  assert.deepEqual(groupPlanTasksByBucket([]), { daily: [], weekly: [], monthly: [] });
});

test("defaultPlanAnchorDate returns a YYYY-MM-DD date for daily and weekly buckets", () => {
  // Noon UTC avoids local-midnight-to-UTC date-shift flakiness across timezones.
  const now = new Date(Date.UTC(2026, 6, 5, 12));
  assert.equal(defaultPlanAnchorDate("daily", now), "2026-07-05");
  assert.equal(defaultPlanAnchorDate("weekly", now), "2026-07-05");
});

test("defaultPlanAnchorDate returns a YYYY-MM month for the monthly bucket", () => {
  const now = new Date(Date.UTC(2026, 6, 5, 12));
  assert.equal(defaultPlanAnchorDate("monthly", now), "2026-07");
});

test("dailyTaskOccursOnDate: recurrence none only occurs on its exact anchor date", () => {
  const task = { anchorDate: "2026-07-06", recurrence: "none" };
  assert.equal(dailyTaskOccursOnDate(task, "2026-07-06"), true);
  assert.equal(dailyTaskOccursOnDate(task, "2026-07-07"), false);
  assert.equal(dailyTaskOccursOnDate(task, "2026-07-05"), false);
});

test("dailyTaskOccursOnDate: recurrence weekdays skips Saturday and Sunday", () => {
  // 2026-07-06 is a Monday.
  const task = { anchorDate: "2026-07-06", recurrence: "weekdays" };
  assert.equal(dailyTaskOccursOnDate(task, "2026-07-10"), true, "Friday should occur");
  assert.equal(dailyTaskOccursOnDate(task, "2026-07-11"), false, "Saturday should not occur");
  assert.equal(dailyTaskOccursOnDate(task, "2026-07-13"), true, "the following Monday should occur");
});

test("dailyTaskOccursOnDate: recurrence weekly repeats on the same weekday", () => {
  const task = { anchorDate: "2026-07-06", recurrence: "weekly" };
  assert.equal(dailyTaskOccursOnDate(task, "2026-07-13"), true);
  assert.equal(dailyTaskOccursOnDate(task, "2026-07-14"), false);
});

test("dailyTaskOccursOnDate: recurrence monthly repeats on the same day of month", () => {
  const task = { anchorDate: "2026-07-06", recurrence: "monthly" };
  assert.equal(dailyTaskOccursOnDate(task, "2026-08-06"), true);
  assert.equal(dailyTaskOccursOnDate(task, "2026-08-07"), false);
});

test("isDailyTaskDoneOnDate and toggleDailyTaskDoneOnDate track completion per occurrence date", () => {
  const task = { id: "t1", anchorDate: "2026-07-06", recurrence: "daily", completedDates: [] };
  const afterFirstToggle = toggleDailyTaskDoneOnDate(task, "2026-07-06");
  assert.equal(isDailyTaskDoneOnDate(afterFirstToggle, "2026-07-06"), true);
  assert.equal(isDailyTaskDoneOnDate(afterFirstToggle, "2026-07-07"), false);
  const afterSecondToggle = toggleDailyTaskDoneOnDate(afterFirstToggle, "2026-07-06");
  assert.equal(isDailyTaskDoneOnDate(afterSecondToggle, "2026-07-06"), false);
});

test("timeToMinutes and minutesToTime convert both directions", () => {
  assert.equal(timeToMinutes("09:30"), 570);
  assert.equal(minutesToTime(570), "09:30");
});

test("snapMinutes rounds to the nearest step", () => {
  assert.equal(snapMinutes(52, 15), 45);
  assert.equal(snapMinutes(58, 15), 60);
});

test("comparePlannedToActual reports signed start and duration deltas against the plan", () => {
  const late = comparePlannedToActual({ plannedStartTime: "09:00", plannedDurationMinutes: 30, actualStartTime: "09:15", actualEndTime: "09:45" });
  assert.equal(late.startDeltaMinutes, 15);
  assert.equal(late.durationDeltaMinutes, 0);

  const overran = comparePlannedToActual({ plannedStartTime: "09:00", plannedDurationMinutes: 30, actualStartTime: "09:00", actualEndTime: "09:50" });
  assert.equal(overran.startDeltaMinutes, 0);
  assert.equal(overran.durationDeltaMinutes, 20);
});

test("comparePlannedToActual returns null deltas when there isn't enough data", () => {
  assert.deepEqual(
    comparePlannedToActual({ plannedStartTime: "09:00", plannedDurationMinutes: 30, actualStartTime: undefined, actualEndTime: undefined }),
    { startDeltaMinutes: null, durationDeltaMinutes: null }
  );
});
