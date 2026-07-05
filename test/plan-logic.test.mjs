import assert from "node:assert/strict";
import test from "node:test";
import { groupPlanTasksByBucket, defaultPlanAnchorDate } from "../src/planLogic.ts";

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
