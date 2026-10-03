import assert from "node:assert/strict";
import test from "node:test";
import { globalSearchResults, shouldShowOnboarding, dismissOnboarding, ONBOARDING_STEPS } from "../src/searchLogic.ts";

const baseState = (overrides = {}) => ({
  accounts: [], paychecks: [], budget: { categories: [] },
  transactions: [{ payee: "Sample Grocer", amount: 12.5, date: "2026-07-01" }, { payee: "Gas", amount: 30, date: "2026-07-02" }],
  notes: { entries: [{ title: "Grocery list", body: "milk", trashed: false }, { title: "Secret grocer", body: "", trashed: true }] },
  decisions: [{ title: "Buy a grocer van", status: "open", decidedAt: "" }, { title: "Grocer plan", status: "decided", decidedAt: "2026-01-01" }],
  ...overrides
});

test("search needs 2+ characters and is case-insensitive across all four sources", () => {
  const state = baseState();
  assert.deepEqual(globalSearchResults(state, [], "g"), []);
  assert.deepEqual(globalSearchResults(state, [], "  "), []);
  const results = globalSearchResults(state, [{ name: "Grocer receipt.pdf" }, { name: "Passport" }], "GROCER");
  assert.deepEqual(results.map((r) => [r.type, r.target]), [["Transaction", "budget"], ["Note", "notes"], ["Document", "documents"], ["Decision", "decisions"], ["Decision", "decisions"]]);
  assert.equal(results[4].detail, "Decided");
  assert.equal(results[3].detail, "Open");
});

test("search skips trashed notes, matches note bodies, and caps results at 40", () => {
  const state = baseState({ transactions: Array.from({ length: 60 }, (_, i) => ({ payee: `Shop ${i}`, amount: 1, date: "2026-07-01" })) });
  assert.equal(globalSearchResults(state, [], "shop").length, 40);
  assert.deepEqual(globalSearchResults(baseState(), [], "milk").map((r) => r.title), ["Grocery list"]);
  assert.equal(globalSearchResults(baseState(), [], "secret").length, 0);
});

test("onboarding is offered only to a fresh household and sticks once dismissed", () => {
  assert.equal(shouldShowOnboarding(baseState()), true);
  assert.equal(shouldShowOnboarding(baseState({ accounts: [{ id: "a" }] })), false);
  assert.equal(shouldShowOnboarding(baseState({ paychecks: [{ id: "p" }] })), false);
  assert.equal(shouldShowOnboarding(baseState({ budget: { categories: [{}] } })), false);
  const dismissed = dismissOnboarding(baseState());
  assert.deepEqual(dismissed.onboarding, { dismissed: true });
  assert.equal(shouldShowOnboarding(dismissed), false);
  assert.ok(ONBOARDING_STEPS.length >= 3);
});
