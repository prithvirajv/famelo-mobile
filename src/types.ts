export type User = { id: string; email: string; name: string; isAdmin: boolean };
export type Household = { id: string; name: string; role: string; country: string; currency: string; selected: boolean };
export type RecurringBudgetBill = { enabled: boolean; amount: number; frequency: "monthly" | "quarterly" | "yearly"; dueDate: string };
export type BudgetLine = { id: string; name: string; planned: number; dueDay?: number; recurringBill?: RecurringBudgetBill };
export type BudgetCategory = { name: string; color: string; lines: BudgetLine[] };
export type Transaction = { date: string; payee: string; lineId: string; amount: number; memo?: string; tags?: string[] };
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
export type IouDirection = "i_owe" | "owed_to_me";
export type Iou = {
  id: string; person: string; amount: number; direction: IouDirection; reason: string; date: string;
  accountId: string; settled: boolean; settledDate: string;
};
export type Friend = { id: string; name: string; email: string; invitedAt: string };
export type HouseholdState = {
  household: { name: string; country: string; currency: string };
  budget: { month: string; income: number; categories: BudgetCategory[] };
  transactions: Transaction[];
  calendar: { events: CalendarEvent[]; chores: Chore[] };
  notes: { entries: Note[] };
  meals: { recipes: Recipe[]; plannedWeek: PlannedMeal[]; savedWeeks?: string[]; nutritionGoals?: { calories: number; protein: number }; selectedWeekByMonth?: Record<string, number>; feedback?: string; groceryEstimate?: number };
  goals?: { sinkingFunds?: unknown[]; debts?: Debt[]; netWorth?: { assets: WealthAsset[]; liabilities: WealthLiability[] } };
  ious?: Iou[];
  friends?: Friend[];
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
// An independent log entry of what actually happened on a given day, optionally
// linking to zero, one, or several planned tasks it relates to.
export type ActualLog = { id: string; startTime: string; endTime: string; note: string; linkedTaskIds: string[] };
export type PrivateData = { journal: { entries: JournalEntry[] }; plans: { tasks: PlanTask[]; actualLogs?: Record<string, ActualLog[]> } };

export type DocumentStatus = "pending" | "ready";
export type WealthItemType = "asset" | "liability";
export type DocumentFolder = {
  id: string; householdId: string; parentId: string | null; name: string;
  wealthItemType: WealthItemType | null; wealthItemId: string | null; createdAt: string;
};
export type Document = {
  id: string; householdId: string; uploadedBy: string; folderId: string | null; noteId: string | null;
  wealthItemType: WealthItemType | null; wealthItemId: string | null;
  name: string; description: string; contentType: string; sizeBytes: number | null;
  status: DocumentStatus; createdAt: string; updatedAt: string;
};
export type DocumentsData = { folders: DocumentFolder[]; documents: Document[] };
