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

// ---- AI home briefing ----------------------------------------------------------------------------------------------------
// Mirrors web's homeBriefingFacts: the household's own numbers assembled into plain text (nothing is looked up server-side), which the
// model only words. The chips are computed without the AI so the card is useful when it is unavailable. Callers pass the pieces that
// live in other logic files (action items, week strip, balances) so this file keeps its types-only imports.
export type HomeBriefing = { headline: string; points: string[]; tip: string };

export type HomeBriefingInput = {
  today: Date; planned: number; currency: string;
  actionItems: Array<{ title: string; label: string; overdue: boolean }>;
  weekStrip: Array<{ label: string; items: Array<{ title: string }> }>;
  funding: Array<{ title: string; detail: string; amount: number }>;
  planTasks: Array<{ done: boolean }>;
  balances: Array<{ name: string; type?: string; balance: number }>;
  spentOfLine: (lineId: string, monthKey: string) => number;
  formatMoney: (amount: number) => string;
};

export function homeBriefingFacts(state: HouseholdState, input: HomeBriefingInput): { text: string; chips: string[] } {
  const { today, planned, formatMoney: fmt } = input;
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  const lines = state.budget.categories.flatMap((category) => category.lines.map((line) => ({ ...line, category: category.name })));
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const monthSpend = new Map<string, number>();
  let spent = 0;
  for (const transaction of state.transactions) {
    if (String(transaction.date || "").slice(0, 7) !== monthKey) continue;
    spent += Number(transaction.amount || 0);
    const parts = transaction.splits?.length ? transaction.splits : [{ lineId: transaction.lineId, amount: transaction.amount }];
    for (const part of parts) {
      const category = lineById.get(part.lineId)?.category || "Uncategorized";
      monthSpend.set(category, (monthSpend.get(category) || 0) + Number(part.amount || 0));
    }
  }
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const topCategories = [...monthSpend.entries()].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const overBudget = lines.filter((line) => Number(line.planned || 0) > 0)
    .map((line) => ({ name: line.name, over: input.spentOfLine(line.id, monthKey) - Number(line.planned || 0) }))
    .filter((line) => line.over > 0).sort((a, b) => b.over - a.over).slice(0, 3);
  const waiting = (state.transactionInboxDrafts || []).length;
  const uncategorized = state.transactions.filter((transaction) => !transaction.lineId && !(transaction.splits || []).length).length;
  const week = input.weekStrip.filter((day) => day.items.length);
  const monthName = today.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const text = [
    `Today is ${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`,
    `Budget this month (${monthName}): ${fmt(spent)} spent of ${fmt(planned)} planned; day ${today.getDate()} of ${daysInMonth}.`,
    topCategories.length ? `Biggest categories this month: ${topCategories.map(([name, amount]) => `${name} ${fmt(amount)}`).join(", ")}.` : "",
    overBudget.length ? `Over budget: ${overBudget.map((line) => `${line.name} by ${fmt(line.over)}`).join(", ")}.` : "No budget line is over its plan.",
    input.balances.length ? `Accounts: ${input.balances.slice(0, 8).map((account) => `${account.name}${account.type ? ` (${account.type})` : ""} ${fmt(account.balance)}`).join("; ")}.` : "",
    waiting ? `${waiting} imported transaction${waiting === 1 ? " is" : "s are"} waiting for review in Bank stream.` : "",
    uncategorized ? `${uncategorized} ledger transaction${uncategorized === 1 ? " has" : "s have"} no category yet.` : "",
    input.actionItems.length ? `Needs attention today: ${input.actionItems.slice(0, 8).map((item) => `${item.title} (${item.label}, ${item.overdue ? "past due" : "due today"})`).join("; ")}.` : "Nothing is past due or due today.",
    week.length ? `Coming up this week: ${week.map((day) => `${day.label}: ${day.items.map((item) => item.title).join(", ")}`).join("; ")}.` : "",
    input.funding.length ? `Bills and goals open: ${input.funding.slice(0, 5).map((reminder) => `${reminder.title} - ${reminder.detail} ${fmt(reminder.amount)} left`).join("; ")}.` : "",
    input.planTasks.length ? `The viewer's plan today has ${input.planTasks.length} task${input.planTasks.length === 1 ? "" : "s"}, ${input.planTasks.filter((task) => task.done).length} done.` : ""
  ].filter(Boolean).join("\n").slice(0, 5800);
  const chips = [
    planned > 0 ? `${fmt(spent)} of ${fmt(planned)} spent` : `${fmt(spent)} spent this month`,
    input.actionItems.length ? `${input.actionItems.length} need${input.actionItems.length === 1 ? "s" : ""} attention` : "",
    waiting ? `${waiting} in Bank stream` : "",
    uncategorized ? `${uncategorized} need a category` : ""
  ].filter(Boolean);
  return { text, chips };
}
