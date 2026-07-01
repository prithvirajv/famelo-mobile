export type User = { id: string; email: string; name: string; isAdmin: boolean };
export type Household = { id: string; name: string; role: string; country: string; currency: string; selected: boolean };
export type BudgetLine = { id: string; name: string; planned: number; dueDay?: number };
export type BudgetCategory = { name: string; color: string; lines: BudgetLine[] };
export type Transaction = { date: string; payee: string; lineId: string; amount: number; memo?: string };
export type CalendarEvent = { date: string; title: string; type: string };
export type Chore = { title: string; assignee: string; cadence: string; nextDue: string };
export type NoteItem = { id: string; text: string; done: boolean };
export type Note = { id: string; title: string; body: string; checklist: NoteItem[]; pinned: boolean; archived: boolean; trashed: boolean; color: string };
export type Recipe = { id: string; name: string; ingredients: string[]; calories: number; protein: number };
export type HouseholdState = {
  household: { name: string; country: string; currency: string };
  budget: { month: string; income: number; categories: BudgetCategory[] };
  transactions: Transaction[];
  calendar: { events: CalendarEvent[]; chores: Chore[] };
  notes: { entries: Note[] };
  meals: { recipes: Recipe[]; plannedWeek: Array<{ day: string; meal: string; servings: number }> };
};
