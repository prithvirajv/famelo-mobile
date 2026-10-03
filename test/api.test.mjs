import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("mobile API uses the production FamilyLoop endpoint by default", () => {
  const source = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(source, /https:\/\/familyloop\.net/);
  assert.match(source, /credentials: "include"/);
});

test("mobile app exposes all primary phone workflows", () => {
  const source = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  for (const label of ["Home", "Budget", "Calendar", "Notes", "Meals", "More"]) assert.match(source, new RegExp(`label: "${label}"`));
  assert.match(source, /api\.saveState/);
  assert.match(source, /api\.selectHousehold/);
});

test("mobile calendar and meal workflows use shared members and persistent state", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(api, /householdAccess/);
  assert.match(api, /\/api\/households\/access/);
  assert.match(app, /Assign to/);
  // One meal per day+slot (Snack included), like web: planning an occupied slot replaces it.
  assert.match(app, /planMealSlot\(next\.meals\.plannedWeek/);
  assert.match(app, /Save week/);
  assert.match(app, /Post groceries/);
  assert.match(app, /Add a Groceries subcategory before posting/);
});

// Extracts one top-level `function <name>(` body out of App.tsx by finding the next
// top-level `function ` after it (this file has no nested top-level function
// declarations, so this is a reliable-enough boundary without a real parser).
function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in App.tsx`);
  const next = source.indexOf("\nfunction ", start + 1);
  return next > 0 ? source.slice(start, next) : source.slice(start);
}

// Every mutation in a whole-state screen must clone the full `state` (`...state, ...`)
// rather than hand-constructing a partial object - a partial save would 400 against the
// server's REQUIRED_STATE_KEYS check (accounts/transfers/paychecks/budgetHistory/etc. are
// all required on every PUT /api/state).

// The shared save() normalizes the state every screen hands it (derived income, recurring bills, chore completion shape,
// goal auto-contribution). Tests check each step is in that function rather than matching the exact chain, so adding a step
// doesn't break the checks for the others.
function sharedSaveSource(app) {
  const start = app.indexOf("const save = useCallback(");
  assert.ok(start >= 0, "shared save() not found");
  return app.slice(start, app.indexOf("}, []);", start));
}

function assertOnlyWholeStateSaves(body, label) {
  const saveCalls = body.match(/onSave\(\{/g) || [];
  // `...latest` is the same full-state clone, read from a ref after an await (the closed-over `state` may be stale).
  const spreadStateCalls = body.match(/onSave\(\{\s*\.\.\.(?:state|latest),/g) || [];
  assert.ok(saveCalls.length > 0, `${label} should actually call onSave somewhere`);
  assert.equal(saveCalls.length, spreadStateCalls.length, `every onSave call in ${label} must spread the full state, not a hand-built partial object`);
}

test("Wealth is reachable from More and saves through the same whole-state pattern as every other screen", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /subScreen === "wealth"/);
  assert.match(app, /onOpenWealth=\{\(\) => setSubScreen\("wealth"\)\}/);
  const body = extractFunctionSource(app, "Wealth");
  assertOnlyWholeStateSaves(body, "Wealth");
  assert.match(body, /sinkingFunds/, "Wealth should also cover savings goals (state.goals.sinkingFunds), not just accounts/debts");
});

test("Bills is reachable from More and reads dueDay bills straight off the shared Budget state", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /subScreen === "bills"/);
  assert.match(app, /onOpenBills=\{\(\) => setSubScreen\("bills"\)\}/);
  const body = extractFunctionSource(app, "Bills");
  assert.match(body, /bill\.dueDay/);
  assert.doesNotMatch(body, /onSave/, "Bills has no add/edit UI of its own - it only reads state, same as web");
});

test("Journal entries support a gratitude field, matching web", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /gratitude\?: string/);
  const body = extractFunctionSource(app, "Journal");
  assert.match(body, /gratitude/);
});

test("Paychecks is reachable from More, materializes occurrences on load, and saves through the whole-state pattern", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /subScreen === "paychecks"/);
  assert.match(app, /onOpenPaychecks=\{\(\) => setSubScreen\("paychecks"\)\}/);
  const body = extractFunctionSource(app, "Paychecks");
  assert.match(body, /ensurePaycheckOccurrencesGenerated/);
  assertOnlyWholeStateSaves(body, "Paychecks");
});

test("Calendar reminders support a repeat recurrence, matching web's advance-on-complete pattern", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /recurrence\?: ReminderRecurrence/);
  const body = extractFunctionSource(app, "Calendar");
  assert.match(body, /advanceRecurringReminder/);
  assert.match(body, /isReminderComplete/);
  // Calendar predates the onSave({ ...state, ... }) literal convention used by newer screens -
  // it already clones the full state up front (structuredClone(state)) and saves that clone,
  // which is the same whole-state guarantee, just written differently.
  assert.match(body, /structuredClone\(state\)/);
  assert.match(body, /onSave\(next\)/);
});

test("Calendar supports adding a chore (not just editing existing ones), deleting events/chores, and chore completion", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Calendar");
  assert.match(body, /addKind/, "should support choosing to add a chore, not just a reminder");
  assert.match(body, /next\.calendar\.chores\.push/);
  assert.match(body, /deleteEvent/);
  assert.match(body, /deleteChore/);
  assert.match(body, /toggleChoreCompletion\(/, "chore completion must be the date-keyed map web reads");
  assert.match(body, /currentChoreOccurrenceDate\(/);
  assert.doesNotMatch(body, /startDate = nextDate|target\.startDate/, "completing a chore must never move its recurrence anchor");
});

test("Notes support real CRUD (add/edit/pin/archive/delete/checklist-add), not just checklist toggling", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /createdAt\?: string/);
  const body = extractFunctionSource(app, "Notes");
  assert.match(body, /trashNote\(item\)/, "delete should soft-delete via the trash (which stamps trashedAt so it is purged after 7 days), matching web");
  assert.match(body, /pinned: !entry\.pinned/);
  assert.match(body, /archived: !entry\.archived/);
  assert.match(body, /checklist: \[\.\.\.entry\.checklist,/, "should support adding a new checklist item, not just toggling existing ones");
  assertOnlyWholeStateSaves(body, "Notes");
});

test("Wealth displays stock/fund holdings (grouped, with gain/loss) instead of just a bare count", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Wealth");
  assert.match(body, /groupStockHoldings/);
  assert.match(body, /assetClassLabelForHoldings/);
  assert.match(body, /groupGainLoss/);
  assert.match(body, /holdingGainLoss/);
  assert.doesNotMatch(body, /view on web/, "should no longer just show a bare count deferring to web");
});

test("Documents track expiry date and last-opened metadata, matching web", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /expiryDate\?: string \| null/);
  assert.match(types, /lastOpenedAt\?: string \| null/);
  assert.match(api, /openDocument:/);
  assert.match(api, /\/api\/documents\/\$\{documentId\}\/open/);
  const documentRow = extractFunctionSource(app, "DocumentRow");
  assert.match(documentRow, /documentExpiryBadge/);
  assert.match(documentRow, /documentOpenedLabel/);
  const screen = extractFunctionSource(app, "DocumentsScreen");
  assert.match(screen, /api\.openDocument/);
  assert.match(screen, /expiryDate/);
});

test("Plan tasks can link to a savings goal, matching web's legacy weekly/monthly goalName field", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /goalName\?: string/);
  const body = extractFunctionSource(app, "Plan");
  assert.match(body, /sinkingFundNames/);
  assert.match(body, /changeTaskGoal/);
  assert.match(body, /task\.goalName/);
});

test("Budget is editable: lines/categories/transactions save through whole-state onSave, and income is derived from paychecks", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Budget");
  assert.match(body, /onSave\(updateLine\(/);
  assert.match(body, /deleteBudgetLines\(/);
  assert.match(body, /addCategory\(/);
  assert.match(body, /makeTransaction\(/);
  assert.match(body, /accountAllowsDate/, "closed accounts must block new transactions dated after closedAt, same as web");
  assert.match(body, /spentByLineInMonth/, "spent must be month-scoped and split-aware, not a raw sum of every transaction");
  assert.match(body, /onOpenPaychecks/);
  assert.doesNotMatch(body, /budget: \{ \.\.\.state\.budget, income/, "income is derived from paychecks (web overwrites it on every render) - never edit it directly");
  assert.match(app, /budgetIncomeFromPaychecks\(nextState\)/, "the shared save keeps budget.income in sync with paychecks, like web's per-render recompute");
  assert.match(app, /tab === "budget" \? <Budget state=\{state\} members=\{/);
  assert.match(app, /onSave=\{save\} onOpenPaychecks=/);
});

test("Wealth lets you record and delete transfers between accounts, newest-first, blocking closed accounts", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Wealth");
  assert.match(body, /buildTransfer\(/);
  assert.match(body, /transfersNewestFirst\(/);
  assert.match(body, /accountAllowsDate\(account, transferDate\)/);
  assert.match(body, /transfers: \[transfer, \.\.\.transfers\]/);
  assertOnlyWholeStateSaves(body, "Wealth");
});

test("Decisions is reachable from More, saves through the whole-state pattern, and supports pros/cons ranking and deciding", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /subScreen === "decisions"/);
  assert.match(app, /onOpenDecisions=\{\(\) => setSubScreen\("decisions"\)\}/);
  const body = extractFunctionSource(app, "Decisions");
  assertOnlyWholeStateSaves(body, "Decisions");
  for (const name of ["createDecision", "addDecisionItem", "moveDecisionItem", "markDecided", "reopenDecision", "sortDecisions"]) {
    assert.match(body, new RegExp(name), `Decisions should use ${name}`);
  }
  // decisions sync across households server-side (user_shared_modules) on every PUT /api/state - no dedicated endpoint exists
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.doesNotMatch(api, /\/api\/decisions/);
});

test("Savings goals support auto-contribute (round-up / % of paycheck), applied on every save and when Wealth opens", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Wealth");
  assert.match(body, /setAutoContributeMode\(/);
  assert.match(body, /setAutoContributePercent\(/);
  assert.match(body, /withGoalAutoContributions\(/);
  assert.match(body, /ensurePaycheckOccurrencesGenerated/, "percent goals need paycheck occurrences materialized before they can be counted");
  assertOnlyWholeStateSaves(body, "Wealth");
  assert.match(sharedSaveSource(app), /withGoalAutoContributions\(/, "the shared save must keep goals current as purchases/paychecks are recorded");
});

test("Notes can attach photos via the Documents pipeline (linked by noteId) and remove them", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Notes");
  assert.match(body, /requestDocumentUploadUrl\(\{[^}]*noteId: note\.id/, "the upload must link the document to the note");
  assert.match(body, /confirmDocumentUpload\(documentId\)/);
  assert.match(body, /noteLinkedImages\(documents, note\.id\)/);
  assert.match(body, /api\.deleteDocument\(photo\.id\)/);
  assert.match(body, /api\.documentDownloadUrl/, "thumbnails use the plain download URL, not /open, so viewing a note doesn't count as opening the file");
  assert.doesNotMatch(body, /openDocument/);
  assertOnlyWholeStateSaves(body, "Notes");
});

test("Calendar can draft a reminder from a photo via the server's vision endpoint, reviewed before anything is added", () => {
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(api, /\/api\/calendar\/reminder-from-image/);
  assert.match(api, /imageBase64, mimeType/);
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Calendar");
  assert.match(body, /api\.reminderFromImage\(asset\.base64/);
  assert.match(body, /normalizeReminderPhotoDraft\(/);
  assert.match(body, /buildPhotoReminderEvent\(photoDraft/);
  // AI output is only ever a draft: the event is added in submitPhotoDraft, never straight from the API response
  assert.doesNotMatch(body.slice(body.indexOf("pickPhotoReminder"), body.indexOf("submitPhotoDraft")), /calendar\.events\.push/);
  assert.match(app, /<Calendar state=\{state\} access=\{access\} user=\{user\}/);
});

test("Reminders created or rescheduled on mobile carry a notifyAt (the server skips events without one), and recurring ones roll it forward", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Calendar");
  assert.match(body, /reminderTiming\(date, time\)/);
  assert.match(body, /advanceRecurringReminder\(target\)/);
  assert.match(body, /completionKeyFor\(/, "completion keys must match web's assignee keys or the two apps disagree on done");
  assert.match(sharedSaveSource(app), /repairChoreCompletion\(/, "the shared save repairs the old flat-array chore completion shape");
});

test("expo-file-system is imported from its /legacy entry - the package root's uploadAsync/writeAsStringAsync throw at runtime in SDK 54+", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /from "expo-file-system\/legacy"/);
  assert.doesNotMatch(app, /from "expo-file-system";/);
});

test("Calendar can export .ics/.csv through the share sheet and import them behind a selectable preview", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Calendar");
  assert.match(body, /buildCalendarIcs\(/);
  assert.match(body, /buildCalendarCsv\(/);
  assert.match(body, /Share\.share\(/);
  assert.match(body, /DocumentPicker\.getDocumentAsync/);
  assert.match(body, /sanitizeCalendarDrafts\(/, "an imported file is untrusted: validate before building items");
  assert.match(body, /calendarDraftToItem\(/);
  assert.match(body, /importSelected/, "the user chooses which rows to import, as in web's preview");
  // nothing is added to the calendar by merely picking a file
  assert.doesNotMatch(body.slice(body.indexOf("pickImportFile"), body.indexOf("submitImport")), /calendar\.(events|chores)\.push/);
});

test("Reports shows a 'Where your income went' breakdown driven by paycheck income, with category/subcategory drill-down", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Reports");
  assert.match(body, /paycheckIncomeForMonth\(state, monthKey\)/, "income comes from paychecks like web, not from negative transactions");
  assert.match(body, /flowSegments\(categories, totalIncome, totalExpenses, theme\.palette, theme\.accent\)/);
  assert.match(body, /resolveFlowSelection\(flow, flowSelectedKey\)/);
  assert.match(body, /transactionsForLines\(/);
  assert.match(body, /transactionAmountForLines\(/, "split transactions show only their share so the list adds up to the segment");
  assert.doesNotMatch(body, /react-native-svg/);
});

test("Wealth holdings are editable (add account, edit holdings, live prices) through whole-state saves, with a quote API that exists", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(api, /\/api\/stock-quote\?symbol=/);
  const wealth = extractFunctionSource(app, "Wealth");
  assert.match(wealth, /<HoldingsEditor /);
  assert.match(wealth, /api\.stockQuote\(/);
  assert.match(wealth, /stateRef\.current/, "quote results must apply onto the LATEST state after the await, not a stale closure");
  assert.match(wealth, /newHoldingGroup\(/);
  assert.match(wealth, /adoptHoldingGroup\(/);
  assert.match(wealth, /priceLastUpdated/);
  assert.doesNotMatch(wealth, /setInterval/, "no silent background polling on a phone");
  assertOnlyWholeStateSaves(wealth, "Wealth");
  const editor = extractFunctionSource(app, "HoldingsEditor");
  for (const name of ["updateHolding", "renameHoldingGroup", "changeHoldingGroupClass", "purgeBlankHoldings", "removeHoldingGroup", "newHoldingRow"]) assert.match(editor, new RegExp(name + "\\("), `HoldingsEditor should use ${name}`);
  assertOnlyWholeStateSaves(editor, "HoldingsEditor");
  assert.match(editor, /\.\.\.netWorth, assets/, "saving holdings must keep netWorth.priceLastUpdated and liabilities");
});

test("Bank stream is reachable from More, imports CSV/PDF into reviewable drafts, and every change goes through the pure logic and whole-state saves", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(app, /subScreen === "bankStream"/);
  assert.match(app, /onOpenBankStream=\{\(\) => setSubScreen\("bankStream"\)\}/);
  assert.match(api, /\/api\/bank-statement\/parse-pdf/);
  assert.match(api, /\/api\/transactions\/suggest-subcategory/);
  assert.match(api, /\/api\/transactions\/suggest-account/);
  const body = extractFunctionSource(app, "BankStream");
  for (const name of ["parseBankCsvTransactions", "buildBankStreamDrafts", "reviewDrafts", "acceptDraft", "dismissDraft", "updateDraft", "clearDraftsForAccount", "moveDraftToTransfer", "setCategorizationRule"]) {
    assert.match(body, new RegExp(name + "\\("), `BankStream should use ${name}`);
  }
  assertOnlyWholeStateSaves(body, "BankStream");
  assert.match(body, /EncodingType\.Base64/, "a PDF is sent to the server as base64");
  // an AI suggestion is only ever applied as an editable choice on the row, never accepted automatically
  assert.doesNotMatch(body.slice(body.indexOf("const suggestLine"), body.indexOf("const openTransfer")), /acceptDraft/);
});

test("Budget can split a ledger transaction across categories, only saving a split that adds up, and leaves a split's amount alone when editing it", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Budget");
  assert.match(body, /applySplit\(state, splitIndex, numericSplitRows\)/);
  assert.match(body, /removeSplit\(state, splitIndex\)/);
  assert.match(body, /canSaveSplit\(splitTransaction, numericSplitRows\)/, "Save split is disabled until every cent is allocated");
  assert.match(body, /existing\.splits\?\.length\s*\?\s*\{ \.\.\.existing, date: input\.date, payee: input\.payee, accountId: input\.accountId, tags: input\.tags \}/, "editing a split transaction must not touch its amount or categories");
  assert.doesNotMatch(body, /edit the split on the web/, "splits are editable on mobile now");
  const reports = fs.readFileSync(new URL("../src/reportsLogic.ts", import.meta.url), "utf8");
  assert.match(reports, /transaction\.splits\.filter\(\(split\) => split\.lineId === lineId\)/, "spent totals must read through splits or a split transaction vanishes from the budget");
});

test("Tags are editable as chips on bank-stream rows and ledger transactions, with duplicate-proof entry and one-tap suggestions", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const chips = extractFunctionSource(app, "TagChips");
  assert.match(chips, /addTagsDeduped\(tags, value\)/);
  assert.match(chips, /removeTag\(tags, tag\)/);
  assert.match(chips, /onEndEditing/);
  const bankStream = extractFunctionSource(app, "BankStream");
  assert.match(bankStream, /<TagChips tags=\{draft\.tags \|\| \[\]\}/);
  assert.match(bankStream, /updateDraft\(state, id, \{ tags \}\)/);
  const budget = extractFunctionSource(app, "Budget");
  assert.match(budget, /<TagChips tags=\{item\.tags \|\| \[\]\}/);
  assert.match(budget, /setTransactionTags\(state, index, tags\)/);
  assert.match(budget, /addTagsDeduped\(\[\], txTags\)/, "the add form's typed tags dedupe too");
});

test("Cross-platform: no long Alert pickers (Android shows 3 buttons max), Back button handled, safe areas work on Android, taps work with the keyboard open", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  // Alert.alert is for short confirmations only - never given a built-up list of options
  assert.doesNotMatch(app, /Alert\.alert\([^)]*,\s*options\)/, "a dynamic options list passed to Alert.alert loses everything past the 3rd button on Android");
  assert.match(app, /function OptionList\(/);
  assert.match(app, /BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.match(app, /SafeAreaView[^;]*from "react-native-safe-area-context"|import \{[^}]*SafeAreaView[^}]*\} from "react-native-safe-area-context"/, "react-native's own SafeAreaView does nothing on Android");
  assert.doesNotMatch(app.split('from "react-native";')[0], /SafeAreaView/);
  assert.match(app, /keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets/);
  // every horizontal chip row must let a tap through while a text field has focus
  const horizontal = app.match(/<ScrollView horizontal [^>]*>/g) || [];
  assert.ok(horizontal.length > 10);
  horizontal.forEach((tag) => assert.match(tag, /keyboardShouldPersistTaps="handled"/));
});

test("Cross-platform: reminder times are built from numeric parts, never by parsing a zone-less date-time string", () => {
  const logic = fs.readFileSync(new URL("../src/calendarLogic.ts", import.meta.url), "utf8");
  assert.doesNotMatch(logic, /new Date\(`\$\{[^}]*\}T\$\{/, "'YYYY-MM-DDTHH:MM' parsing can differ between JS engines");
  assert.doesNotMatch(logic, /new Date\((dateTime|nextReminderAt)\)/);
});

test("Bank stream has bulk set-account, clear-suggested-categories and sorting, all through the pure logic", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "BankStream");
  for (const name of ["setAccountForUnlinkedDrafts", "clearHistorySuggestions", "sortDrafts"]) assert.match(body, new RegExp(name + "\\("));
  assertOnlyWholeStateSaves(body, "BankStream");
});

test("Budget's ledger can be sorted and bulk-categorized (split rows are skipped, not overwritten)", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Budget");
  assert.match(body, /sortLedgerEntries\(/);
  assert.match(body, /applyLineToTransactions\(state, selectedTx, bulkLineId\)/);
  assert.match(body, /skippedSplit/);
});

test("Budget can switch months (with rollover and history), copy an earlier month, and manage recurring bills; recurring bills stay derived on every save", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Budget");
  for (const name of ["switchBudgetMonth", "copyBudgetFromMonth", "availablePreviousBudgets", "toggleRollover", "enableRecurringBill", "disableRecurringBill", "updateRecurringBill"]) assert.match(body, new RegExp(name + "\\("));
  assert.match(body, /spentByLineInMonth\(state\.transactions, lineId, monthKey\)/, "rollover needs the previous month's real spend");
  assert.match(sharedSaveSource(app), /ensureRecurringBudgetBills\(/, "web re-derives recurring bills on every render, so the shared save does too");
  assert.doesNotMatch(body, /managed on the web app/);
});

test("Calendar can add and edit birthdays/anniversaries (yearly, remind N days before) and track who has wished them each year", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Calendar");
  for (const name of ["buildAnnualEvent", "updateAnnualEvent", "toggleAnnualWished", "nextPendingAnnualOccurrence", "annualEventDisplayTitle"]) assert.match(body, new RegExp(name + "\\("));
  assert.match(body, /REMIND_BEFORE_OPTIONS/);
  assert.match(body, /Mark wished/);
  assert.match(body, /Birthday/);
  assert.match(body, /Anniversary/);
});

test("Recurring bills can be created from the transaction form, managed, and surface themselves in Bank stream as time passes", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const budget = extractFunctionSource(app, "Budget");
  for (const name of ["addRecurringExpense", "updateRecurringExpense", "deleteRecurringExpense"]) assert.match(budget, new RegExp(name + "\\("));
  assert.match(sharedSaveSource(app), /ensureRecurringExpensesPosted\(/, "the shared save surfaces due periods");
  assert.match(extractFunctionSource(app, "BankStream"), /ensureRecurringExpensesPosted\(state, localDateKey\(\), uniqueId\)/, "opening Bank stream catches time passing without a save");
});

test("A bank-stream row or ledger transaction can be split with friends: your share stays, each friend's share becomes an IOU", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /function SplitWithFriends\(/);
  assert.match(app, /computeBillSplitAmounts\(splitType, total,/, "same split maths as the Shared Expenses screen");
  assert.match(app, /splitRecordWithFriends\(state, source, shares, options, uniqueId\)/);
  assert.match(extractFunctionSource(app, "BankStream"), /applySplitWithFriends\(state, onSave, \{ type: "draft", id \}/);
  assert.match(extractFunctionSource(app, "Budget"), /applySplitWithFriends\(state, onSave, \{ type: "ledger", index \}/);
});

test("Reports uses what was actually planned in each month (budget history), offers year-over-year comparison and color themes", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Reports");
  assert.match(body, /budgetVsActualByCategory\(state\.budget, state\.budgetHistory \|\| \[\], state\.transactions, monthKeys\)/);
  assert.match(body, /priorYearMonthKeys\(monthKeys\)/);
  assert.match(body, /yoyDelta\(/);
  assert.match(body, /REPORT_THEMES/);
  const logic = fs.readFileSync(new URL("../src/reportsLogic.ts", import.meta.url), "utf8");
  assert.doesNotMatch(logic, /constant approximation/, "planned is no longer a live-budget approximation");
});

test("Wealth shows asset allocation and can display net worth in another currency using real server rates, never a guessed one", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(api, /\/api\/fx-rates/);
  const body = extractFunctionSource(app, "Wealth");
  assert.match(body, /assetAllocationBreakdown\(netWorthAssets\)/);
  assert.match(body, /convertCurrency\(amount, currency, shownCurrency, fxRates\?\.rates\) \?\? amount/, "a missing rate falls back to the original amount");
  assertOnlyWholeStateSaves(body, "Wealth");
});

test("Bulk imports are refused (with a clear message) before they push the household state past the server's 1 MB request limit", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(extractFunctionSource(app, "BankStream"), /exceedsStateLimit\(importedState\)/);
  assert.match(extractFunctionSource(app, "Calendar"), /exceedsStateLimit\(next\)/);
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(api, /response\.status === 413/, "an oversized save must not surface as a meaningless 'Request failed'");
});

test("Notes have views (Notes/Reminders/Archive/Trash/labels), search, labels, a reminder, a bill link, copy, restore, and checklist editing", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Notes");
  for (const name of ["visibleNotes", "allLabels", "toggleLabel", "setNoteReminder", "setNoteBill", "duplicateNote", "purgeExpiredTrash", "editChecklistText", "deleteChecklistItem", "toggleIndent", "moveNoteItem", "bucketChecklistItems"]) {
    assert.match(body, new RegExp(name + "\\("), `Notes should use ${name}`);
  }
  assertOnlyWholeStateSaves(body, "Notes");
  assert.match(body, /updateNote\(note\.id, restoreNote\)/);
  assert.match(body, /Delete permanently/);
  assert.match(body, /Search notes/);
});

test("Notes can be shared by email, public link, or with a FamilyLoop account, and notes shared with you can be ticked and added to", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  for (const route of ["/api/notes/share\"", "/api/notes/share-link", "/api/notes/share-user", "/api/notes/shared-with-me", "/shared-with-me/\\$\\{encodeURIComponent\\(shareId\\)\\}/toggle", "/shared-with-me/\\$\\{encodeURIComponent\\(shareId\\)\\}/items"]) {
    assert.match(api, new RegExp(route), `api.ts should call ${route}`);
  }
  const panel = extractFunctionSource(app, "NoteSharePanel");
  for (const name of ["shareNoteByEmail", "createNoteShareLink", "removeNoteShareLink", "shareNoteWithUser", "removeNoteUserShare"]) assert.match(panel, new RegExp(`api\\.${name}\\(`));
  assert.match(panel, /Share\.share\(\{ message: linkUrl \}\)/, "a link is shared as text so it works on both iOS and Android");
  const shared = extractFunctionSource(app, "SharedWithMe");
  for (const name of ["sharedWithMe", "toggleSharedNoteItem", "addSharedNoteItem", "deleteSharedNoteItem"]) assert.match(shared, new RegExp(`api\\.${name}\\(`));
  assert.match(extractFunctionSource(app, "Notes"), /<NoteSharePanel note=\{note\} \/>/);
});

test("Budget lines can be given an owner and filtered by member", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const body = extractFunctionSource(app, "Budget");
  assert.match(body, /filterCategoriesByOwner\(state\.budget\.categories, memberFilter\)/);
  assert.match(body, /ownerId: lineOwner \|\| null/);
});

test("global search and onboarding are wired into the app shell with Android-safe modals", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /<GlobalSearchModal[\s\S]*?onPick=/);
  assert.match(extractFunctionSource(app, "GlobalSearchModal"), /<Modal[^>]*onRequestClose=\{onClose\}/);
  assert.match(extractFunctionSource(app, "GlobalSearchModal"), /keyboardShouldPersistTaps="handled"/);
  assert.match(extractFunctionSource(app, "OnboardingModal"), /<Modal[^>]*onRequestClose=\{onDismiss\}/);
  // dismissing onboarding goes through the shared whole-state save, never a partial write
  assert.match(app, /save\(dismissOnboarding\(state\)\)/);
});

test("recipes screen and meal planner save through the shared whole-state save and use the meals logic", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const recipes = extractFunctionSource(app, "Recipes");
  assertOnlyWholeStateSaves(recipes);
  assert.match(recipes, /saveRecipe\(/);
  assert.match(recipes, /deleteRecipe\(/);
  assert.match(recipes, /keyboardShouldPersistTaps="handled"/);
  const meals = extractFunctionSource(app, "Meals");
  assert.match(meals, /planMealSlot\(/);
  assert.match(meals, /clearMealSlot\(/);
  assert.match(meals, /groceryListByAisle\(/);
  assert.match(app, /<Recipes state=\{state\} onSave=\{save\}/);
});
