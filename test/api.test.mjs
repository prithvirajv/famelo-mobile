import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("mobile API uses the production Famelo endpoint by default", () => {
  const source = fs.readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(source, /https:\/\/famelo\.net/);
  assert.match(source, /credentials: "include"/);
});

test("mobile app exposes all primary phone workflows", () => {
  const source = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  for (const label of ["Home", "Budget", "Calendar", "Notes", "More"]) assert.match(source, new RegExp(`label: "${label}"`));
  assert.match(source, /api\.saveState/);
  assert.match(source, /api\.selectHousehold/);
});
