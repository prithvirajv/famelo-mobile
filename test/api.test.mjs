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
