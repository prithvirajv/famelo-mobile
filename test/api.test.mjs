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
