import type { PlanBucket, PlanTask } from "./types";

const WEEKDAY_INDEXES = [1, 2, 3, 4, 5];

function parseDateKey(dateKey: string): Date {
  const parts = dateKey.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day);
}

export function groupPlanTasksByBucket(tasks: PlanTask[]): Record<PlanBucket, PlanTask[]> {
  return {
    daily: tasks.filter((task) => task.bucket === "daily"),
    weekly: tasks.filter((task) => task.bucket === "weekly"),
    monthly: tasks.filter((task) => task.bucket === "monthly")
  };
}

export function defaultPlanAnchorDate(bucket: PlanBucket, now: Date = new Date()): string {
  if (bucket === "monthly") return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return now.toISOString().slice(0, 10);
}

export function dailyTaskOccursOnDate(task: PlanTask, dateKey: string): boolean {
  if (!task.anchorDate || dateKey < task.anchorDate) return false;
  const recurrence = task.recurrence || "none";
  if (recurrence === "none") return dateKey === task.anchorDate;
  const anchor = parseDateKey(task.anchorDate);
  const target = parseDateKey(dateKey);
  if (recurrence === "daily") return true;
  if (recurrence === "weekdays") return WEEKDAY_INDEXES.includes(target.getDay());
  if (recurrence === "weekly") return anchor.getDay() === target.getDay();
  if (recurrence === "monthly") return anchor.getDate() === target.getDate();
  return dateKey === task.anchorDate;
}

export function isDailyTaskDoneOnDate(task: PlanTask, dateKey: string): boolean {
  return (task.completedDates || []).includes(dateKey);
}

export function toggleDailyTaskDoneOnDate(task: PlanTask, dateKey: string): PlanTask {
  const completedDates = task.completedDates || [];
  const isDone = completedDates.includes(dateKey);
  return {
    ...task,
    completedDates: isDone ? completedDates.filter((date) => date !== dateKey) : [...completedDates, dateKey]
  };
}

export function timeToMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const parts = time.split(":").map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function snapMinutes(value: number, step = 15): number {
  return Math.round(value / step) * step;
}

export interface PlannedVsActualDelta {
  startDeltaMinutes: number | null;
  durationDeltaMinutes: number | null;
}

// Compares a task's planned schedule against what was actually logged for one
// occurrence. Deltas are signed minute counts (positive = started later / ran
// longer than planned); either delta is null when there isn't enough data.
export function comparePlannedToActual({ plannedStartTime, plannedDurationMinutes, actualStartTime, actualEndTime }: {
  plannedStartTime: string | undefined;
  plannedDurationMinutes: number | undefined;
  actualStartTime: string | undefined;
  actualEndTime: string | undefined;
}): PlannedVsActualDelta {
  const plannedStart = timeToMinutes(plannedStartTime);
  const actualStart = timeToMinutes(actualStartTime);
  const actualEnd = timeToMinutes(actualEndTime);
  const startDeltaMinutes = plannedStart != null && actualStart != null ? actualStart - plannedStart : null;
  const durationDeltaMinutes = actualStart != null && actualEnd != null && plannedDurationMinutes != null
    ? (actualEnd - actualStart) - plannedDurationMinutes
    : null;
  return { startDeltaMinutes, durationDeltaMinutes };
}
