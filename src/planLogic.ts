import type { PlanBucket, PlanTask } from "./types";

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
