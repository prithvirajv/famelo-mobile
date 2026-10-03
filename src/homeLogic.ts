// Pure helpers behind the Home dashboard cards that are not calendar-based (those live in calendarLogic.ts), mirroring web's
// homeNoteReminders / homeRecentActivity / billAndGoalReminders / dismissBudgetReminder. Types only are imported - see the
// logic-file import rule - so anything needing another logic file's function takes it as a callback.
import type { HouseholdState } from "./types";

export type NoteReminderItem = { id: string; title: string; overdue: boolean; reminder: string };

// A note's reminder is "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"; it is due once its DATE is today or earlier.
export function homeNoteReminders(notes: HouseholdState["notes"]["entries"], today: string): NoteReminderItem[] {
  return notes
    .filter((note) => !note.archived && !note.trashed && note.reminder && note.reminder.slice(0, 10) <= today)
    .map((note) => ({ id: note.id, title: note.title || "Untitled note", overdue: (note.reminder as string).slice(0, 10) < today, reminder: note.reminder as string }))
    .sort((a, b) => a.reminder.localeCompare(b.reminder));
}

export type ActivityItem = { at: string; title: string; detail: string; icon: string };

// Only entities that carry a real timestamp (notes, decisions, settled IOUs) - nothing is invented for bill payments.
export function homeRecentActivity(state: Pick<HouseholdState, "notes" | "decisions" | "ious">, limit = 8): ActivityItem[] {
  const notes = (state.notes?.entries || []).filter((note) => !note.trashed && note.createdAt).map((note) => ({ at: note.createdAt as string, title: note.title || "Untitled note", detail: "Note added", icon: "📝" }));
  const decisions = (state.decisions || []).flatMap((decision) => {
    const rows: ActivityItem[] = [];
    if (decision.createdAt) rows.push({ at: decision.createdAt, title: decision.title || "Untitled decision", detail: "Decision raised", icon: "⚖️" });
    if (decision.decidedAt) rows.push({ at: decision.decidedAt, title: decision.title || "Untitled decision", detail: "Decision made", icon: "⚖️" });
    return rows;
  });
  const ious = (state.ious || []).filter((iou) => iou.settled && iou.settledDate).map((iou) => ({ at: iou.settledDate, title: `Settled with ${iou.person}`, detail: String(iou.amount || 0), icon: "💸" }));
  return [...notes, ...decisions, ...ious].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}

export type FundingReminder = { id: string; title: string; detail: string; kind: "bill" | "goal"; amount: number };

// Bills with money still to pay this month and savings goals that are not fully funded, minus ones marked Done this month.
export function billAndGoalReminders(state: HouseholdState, spentOf: (lineId: string) => number): FundingReminder[] {
  const dismissed = state.budget.dismissedReminders?.[state.budget.month] || [];
  const bills = state.budget.categories.flatMap((category) => category.lines)
    .filter((line) => line.dueDay && Number(line.planned || 0) > spentOf(line.id))
    .map((line): FundingReminder => {
      const left = Number(line.planned || 0) - spentOf(line.id);
      return { id: `bill:${line.id}`, title: `${line.name} payoff due`, detail: `Due day ${line.dueDay}`, kind: "bill", amount: left };
    });
  const goals = (state.goals?.sinkingFunds || [])
    .filter((fund) => Number(fund.saved || 0) < Number(fund.target || 0))
    .map((fund, index): FundingReminder => ({ id: `goal:${fund.name || index}`, title: `${fund.name || "Goal"} needs funding`, detail: fund.targetDate ? `by ${fund.targetDate}` : "", kind: "goal", amount: Number(fund.target || 0) - Number(fund.saved || 0) }));
  return [...bills, ...goals].filter((reminder) => !dismissed.includes(reminder.id));
}

export function dismissBudgetReminder(state: HouseholdState, id: string): HouseholdState {
  const month = state.budget.month;
  const existing = state.budget.dismissedReminders?.[month] || [];
  if (existing.includes(id)) return state;
  return { ...state, budget: { ...state.budget, dismissedReminders: { ...state.budget.dismissedReminders, [month]: [...existing, id] } } };
}
