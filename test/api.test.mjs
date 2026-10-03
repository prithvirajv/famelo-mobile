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
  assert.match(app, /slot === "Snack" \? -1/);
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
function assertOnlyWholeStateSaves(body, label) {
  const saveCalls = body.match(/onSave\(\{/g) || [];
  const spreadStateCalls = body.match(/onSave\(\{\s*\.\.\.state,/g) || [];
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
  assert.match(body, /advanceReminderDate/);
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
  assert.match(body, /advanceChoreDate/);
});

test("Notes support real CRUD (add/edit/pin/archive/delete/checklist-add), not just checklist toggling", () => {
  const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const types = fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /createdAt\?: string/);
  const body = extractFunctionSource(app, "Notes");
  assert.match(body, /trashed: true/, "delete should soft-delete via trashed, matching web");
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
  assert.match(app, /tab === "budget" \? <Budget state=\{state\} onSave=\{save\}/);
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
  assert.match(app, /withGoalAutoContributions\(withIncome, localDateKey\(\)\)/, "the shared save must keep goals current as purchases/paychecks are recorded");
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
