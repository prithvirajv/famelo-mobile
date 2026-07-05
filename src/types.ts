export type User = { id: string; email: string; name: string; isAdmin: boolean };
export type Household = { id: string; name: string; role: string; country: string; currency: string; selected: boolean };
export type BudgetLine = { id: string; name: string; planned: number; dueDay?: number };
export type BudgetCategory = { name: string; color: string; lines: BudgetLine[] };
export type Transaction = { date: string; payee: string; lineId: string; amount: number; memo?: string };
export type CalendarEvent = { id?: string; date: string; title: string; type: string; owner?: string; ownerName?: string };
export type Chore = { id?: string; title: string; assignee: string; assigneeName?: string; cadence: string; nextDue: string; startDate?: string; recurrence?: string };
export type NoteItem = { id: string; text: string; done: boolean; parentId?: string };
export type Note = { id: string; title: string; body: string; checklist: NoteItem[]; pinned: boolean; archived: boolean; trashed: boolean; color: string };
export type Recipe = { id: string; name: string; ingredients: string[]; calories: number; protein: number };
export type HouseholdAccess = { canManage: boolean; members: Array<{ name: string; email: string; role: string; status: string; isOwner: boolean }> };
export type PlannedMeal = { month?: string; week?: number; day: string; slot?: string; meal: string; recipeId?: string; servings: number };
export type WealthAsset = { id?: string; name: string; value: number; assetClass?: "other" | "cash" | "property" | "retirement" | "stock"; symbol?: string; shares?: number; price?: number };
export type WealthLiability = { id?: string; name: string; value: number };
export type DebtPayment = { id?: string; date: string; amount: number; interest: number; principal: number; extra: number };
export type Debt = { id?: string; name: string; balance: number; rate: number; minimum: number; termMonths?: number; assetId?: string; payments?: DebtPayment[] };
export type HouseholdState = {
  household: { name: string; country: string; currency: string };
  budget: { month: string; income: number; categories: BudgetCategory[] };
  transactions: Transaction[];
  calendar: { events: CalendarEvent[]; chores: Chore[] };
  notes: { entries: Note[] };
  meals: { recipes: Recipe[]; plannedWeek: PlannedMeal[]; savedWeeks?: string[]; nutritionGoals?: { calories: number; protein: number }; selectedWeekByMonth?: Record<string, number>; feedback?: string; groceryEstimate?: number };
  goals?: { sinkingFunds?: unknown[]; debts?: Debt[]; netWorth?: { assets: WealthAsset[]; liabilities: WealthLiability[] } };
};

export type JournalPhoto = { id: string; dataUrl: string; createdAt: string };
export type JournalEntry = {
  id: string; entryDate: string; title: string; body: string; mood: string; tags: string[];
  photos: JournalPhoto[]; createdAt: string; updatedAt: string;
};
export type PlanBucket = "daily" | "weekly" | "monthly";
export type PlanRecurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";
export type PlanSubtask = { id: string; text: string; done: boolean };
export type PlanTask = {
  id: string; title: string; notes: string; bucket: PlanBucket; anchorDate: string; createdAt: string;
  subtasks?: PlanSubtask[];
  // Weekly/monthly tasks use this plain boolean; daily tasks use completedDates instead (see below).
  done?: boolean;
  // Daily-bucket-only fields:
  startTime?: string; durationMinutes?: number; recurrence?: PlanRecurrence; completedDates?: string[];
};
export type PrivateData = { journal: { entries: JournalEntry[] }; plans: { tasks: PlanTask[] } };
