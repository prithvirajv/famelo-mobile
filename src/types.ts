export type User = { id: string; email: string; name: string; isAdmin: boolean };
export type Household = { id: string; name: string; role: string; country: string; currency: string; selected: boolean };
export type RecurringBudgetBill = { enabled: boolean; amount: number; frequency: "monthly" | "quarterly" | "yearly"; dueDate: string };
export type BudgetLine = {
  id: string; name: string; planned: number; dueDay?: number | null; recurringBill?: RecurringBudgetBill;
  // Not edited on mobile yet, but preserved untouched on every save (all edits spread the existing line).
  ownerId?: string; rolloverEnabled?: boolean; rolloverAmount?: number;
};
export type BudgetCategory = { name: string; color: string; lines: BudgetLine[] };
export type TransactionSplit = { lineId: string; amount: number };
export type Transaction = {
  date: string; payee: string; lineId: string; amount: number; memo?: string; tags?: string[];
  accountId?: string; orderNumber?: string; splits?: TransactionSplit[]; categoryName?: string; subcategoryName?: string;
};
export type ReminderRecurrence = "once" | "weekly" | "monthly" | "yearly";
// recurrence/completedBy only apply to type: "reminder" events (matches web's app.js) - a
// completed recurring reminder self-advances to its next due date and clears completedBy
// (see advanceReminderDate in calendarLogic.ts), rather than tracking per-occurrence history.
export type EventAssignee = { key: string; name: string; email: string };
// dateTime/notifyAt/reminderAt/location/assignees are what web writes on a reminder; the server only
// sends a push/email for an event that has notifyAt, and web upgrades owner-only events (the shape
// mobile's own add form still writes) to assignees lazily. Mobile preserves them untouched on edit.
export type CalendarEvent = {
  id?: string; date: string; title: string; type: string; owner?: string; ownerName?: string;
  recurrence?: ReminderRecurrence; completedBy?: string[];
  dateTime?: string; notifyAt?: string; reminderAt?: string; location?: string; annual?: boolean; assignees?: EventAssignee[];
  monthDay?: string; reminderDays?: number;
};
// One row parsed from an .ics or .csv file, in the flat shape web's importer uses for both formats.
export type CalendarImportDraft = {
  kind: "event" | "chore"; type: string; title: string; date: string; time: string; recurrence: string;
  endDate: string; location: string; assigneeKeys: string[]; reminderDays?: number;
};
// What POST /api/calendar/reminder-from-image extracts from a photo; every field may be blank.
export type ReminderPhotoDraft = { title: string; date: string; time: string; location: string };
export type ChoreRecurrence = "once" | "weekly" | "biweekly" | "triweekly" | "monthly" | "every3months" | "every4months" | "every6months" | "yearly";
// completedBy is a map { "YYYY-MM-DD": [assignee keys] } (web's shape). Fields beyond the first group are
// written by web and preserved untouched on every mobile edit (all edits spread the existing chore).
export type Chore = {
  id?: string; title: string; assignee: string; assigneeName?: string; cadence: string; nextDue: string; startDate?: string;
  recurrence?: ChoreRecurrence; completedBy?: Record<string, string[]>;
  endDate?: string; time?: string; location?: string; assignees?: EventAssignee[]; notifyAt?: string;
};
export type NoteItem = { id: string; text: string; done: boolean; parentId?: string };
export type Note = { id: string; title: string; body: string; checklist: NoteItem[]; pinned: boolean; archived: boolean; trashed: boolean; color: string; createdAt?: string };
export type Recipe = { id: string; name: string; ingredients: string[]; calories: number; protein: number };
export type HouseholdAccess = { canManage: boolean; members: Array<{ name: string; email: string; role: string; status: string; isOwner: boolean }> };
export type PlannedMeal = { month?: string; week?: number; day: string; slot?: string; meal: string; recipeId?: string; servings: number };
// Holding-only fields (symbol/shares/price/costBasis/groupId/groupName/holdingType) only apply
// when assetClass is "stock" or "retirement" - see isHoldingAssetClass in the web app's
// lib/shared-logic.js. A legacy holding may have shares/price unset (flat `value` only) - assetValue()
// must fall back to `value` in that case, not assume shares/price are always present.
export type WealthAsset = {
  id?: string; name: string; value: number; assetClass?: "other" | "cash" | "property" | "retirement" | "stock";
  symbol?: string; shares?: number; price?: number; costBasis?: number;
  groupId?: string; groupName?: string; holdingType?: "stock" | "fund";
};
// priceLastUpdated: when each holdings group's live prices were last refreshed, keyed by group id (ISO time).
export type NetWorth = { assets: WealthAsset[]; liabilities: WealthLiability[]; priceLastUpdated?: Record<string, string> };
export type WealthLiability = { id?: string; name: string; value: number };
export type DebtPayment = { id?: string; date: string; amount: number; interest: number; principal: number; extra: number; balance?: number };
export type Debt = {
  id?: string; name: string; balance: number; rate: number; minimum: number; termMonths?: number;
  // assetId: informational "secured by" link (e.g. mortgage -> house). lineId: auto-EMI-from-Ledger
  // link to a budget subcategory; appliedPaymentSignatures dedupes which Ledger transactions have
  // already been applied as a payment (format "date|amount") so relinking never double-counts.
  assetId?: string; lineId?: string; appliedPaymentSignatures?: string[]; payments?: DebtPayment[];
};
// Web stores { enabled: false } with no mode when auto-contribute is switched off.
export type SinkingFundAutoContribute = { enabled: boolean; mode?: "roundup" | "percent"; percent?: number };
export type SinkingFund = {
  name: string; target: number; saved: number; targetDate: string;
  autoContribute?: SinkingFundAutoContribute;
  // Watermarks preventing the same roundup/payday from being credited twice.
  roundupProcessedCount?: number; percentProcessedOccurrenceIds?: string[];
};
export type IouDirection = "i_owe" | "owed_to_me";
export type Iou = {
  id: string; person: string; amount: number; direction: IouDirection; reason: string; date: string;
  accountId: string; settled: boolean; settledDate: string; receiptDocumentId?: string;
};
export type Friend = { id: string; name: string; email: string; invitedAt: string };
export type AccountType = "checking" | "savings" | "cash" | "credit_card" | "other";
export type Account = {
  id: string; name: string; type: AccountType; openingBalance: number;
  netWorthAssetId: string; netWorthLiabilityId: string; createdAt: string;
  // A closed account still allows backdated entries (on/before closedAt) but blocks any new
  // transaction/paycheck-deposit/transfer dated after it - see accountAllowsDate in the web app.
  closedAt?: string;
};
export type Transfer = { id?: string; fromAccountId: string; toAccountId: string; amount: number; date: string; memo?: string };
export type PaycheckRecurrence = "once" | "bonus" | "weekly" | "biweekly" | "monthly";
export type Paycheck = {
  id: string; date: string; name: string; amount: number; recurrence: PaycheckRecurrence;
  endDate?: string; assignedLineIds: string[]; depositAccountId?: string;
  // Self-healing materialization watermark (see ensurePaycheckOccurrencesGenerated on web) - not
  // meant to be hand-edited by the client, just preserved on save.
  generatedThroughDate?: string; generatedRecurrence?: string; generatedAnchorDate?: string; generatedEndDate?: string;
};
// Materialized, individually editable/deletable real pay dates for a recurring paycheck - one row
// per actual payday, generated on demand server/web-side (not part of the seeded default state, so
// it may be absent entirely on a household that has never opened the Paychecks page).
export type PaycheckOccurrence = { id: string; seriesId: string; date: string; amount: number; depositAccountId?: string };
export type RecurringExpense = {
  id: string; payee: string; amount: number; lineId: string; accountId?: string;
  recurrence: "weekly" | "biweekly" | "monthly"; anchorDate: string; endDate?: string; postedDates: string[];
};
export type BudgetHistoryEntry = { month: string; income: number; categories: BudgetCategory[] };
export type DecisionComment = { id: string; text: string; authorKey: string; authorName: string };
// Attachments are stored inline as data URLs on web (5 max, 5MB each) rather than through Documents, because
// decisions sync across a user's households while documents are per-household. Mobile doesn't show or add
// them yet, but every edit spreads the existing decision so they are preserved untouched.
export type DecisionAttachment = { id: string; name: string; contentType: string; sizeBytes: number; dataUrl: string; createdAt: string };
export type Decision = {
  id: string; title: string; notes: string; status: "open" | "decided"; outcome: string; decidedAt: string;
  pros: DecisionComment[]; cons: DecisionComment[]; createdAt: string; attachments?: DecisionAttachment[];
};
export type InboxDraft = { id?: string; lineId: string; payee?: string; amount?: number; date?: string; accountId?: string };
export type HouseholdState = {
  household: { name: string; country: string; currency: string };
  budget: { month: string; income: number; categories: BudgetCategory[]; taxonomyUnified?: boolean; dismissedReminders?: Record<string, string[]> };
  // One frozen snapshot per past month, taken when switching months, since budget.categories became a
  // single taxonomy shared across every month (only line.planned still varies per month) - see
  // "categories/subcategories became a shared taxonomy" in the web app's git history.
  budgetHistory: BudgetHistoryEntry[];
  transactions: Transaction[];
  paychecks: Paycheck[];
  paycheckOccurrences?: PaycheckOccurrence[];
  recurringExpenses: RecurringExpense[];
  calendar: { events: CalendarEvent[]; chores: Chore[] };
  notes: { entries: Note[] };
  decisions: Decision[];
  meals: { recipes: Recipe[]; plannedWeek: PlannedMeal[]; savedWeeks?: string[]; nutritionGoals?: { calories: number; protein: number }; selectedWeekByMonth?: Record<string, number>; feedback?: string; groceryEstimate?: number };
  goals?: { sinkingFunds?: SinkingFund[]; debts?: Debt[]; netWorth?: NetWorth };
  ious: Iou[];
  friends?: Friend[];
  accounts: Account[];
  transfers: Transfer[];
  transactionInboxDrafts?: InboxDraft[];
};

export type JournalPhoto = { id: string; dataUrl: string; createdAt: string };
export type JournalEntry = {
  id: string; entryDate: string; title: string; body: string; mood: string; tags: string[];
  photos: JournalPhoto[]; createdAt: string; updatedAt: string; gratitude?: string;
};
export type PlanBucket = "daily" | "weekly" | "monthly";
export type PlanRecurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";
export type PlanSubtask = { id: string; text: string; done: boolean };
export type PlanTask = {
  id: string; title: string; notes: string; bucket: PlanBucket; anchorDate: string; createdAt: string;
  subtasks?: PlanSubtask[];
  // Weekly/monthly tasks use this plain boolean; daily tasks use completedDates instead (see below).
  done?: boolean;
  // Weekly/monthly-only: links this task to a savings goal (state.goals.sinkingFunds[].name) -
  // daily tasks don't get this on web either.
  goalName?: string;
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
  // Set by POST /api/documents/:id/open, distinct from the download-url fetch that also runs in
  // the background to rasterize thumbnails - only an explicit Open/Download click counts, matching
  // Google Drive's "You opened" semantics (see app.js's comment on the same endpoint).
  lastOpenedBy?: string | null; lastOpenedByName?: string | null; lastOpenedAt?: string | null;
  expiryDate?: string | null;
};
export type DocumentsData = { folders: DocumentFolder[]; documents: Document[] };
