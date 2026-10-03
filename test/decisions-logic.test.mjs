import assert from "node:assert/strict";
import test from "node:test";
import { sortDecisions, createDecision, updateDecision, addDecisionItem, editDecisionItem, removeDecisionItem, moveDecisionItem, markDecided, reopenDecision } from "../src/decisionsLogic.ts";

const author = { key: "a@x.com", name: "Alex" };
function decision(overrides = {}) {
  return { id: "d1", title: "Move?", notes: "", status: "open", outcome: "", decidedAt: "", pros: [], cons: [], createdAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

test("sortDecisions puts open decisions first, newest first within each group, without mutating the input", () => {
  const input = [
    decision({ id: "old-open", createdAt: "2026-06-01T00:00:00.000Z" }),
    decision({ id: "decided", status: "decided", createdAt: "2026-07-09T00:00:00.000Z" }),
    decision({ id: "new-open", createdAt: "2026-07-05T00:00:00.000Z" })
  ];
  assert.deepEqual(sortDecisions(input).map((item) => item.id), ["new-open", "old-open", "decided"]);
  assert.equal(input[0].id, "old-open");
});

test("createDecision trims, starts open with empty pros/cons, and rejects a blank question", () => {
  const made = createDecision("  Bigger apartment? ", " some context ", () => "id-1", new Date("2026-07-02T10:00:00.000Z"));
  assert.deepEqual(made, { id: "id-1", title: "Bigger apartment?", notes: "some context", status: "open", outcome: "", decidedAt: "", pros: [], cons: [], createdAt: "2026-07-02T10:00:00.000Z" });
  assert.equal(createDecision("   ", "x", () => "id"), null);
});

test("addDecisionItem appends a trimmed pro/con credited to its author, and ignores blank text", () => {
  const added = addDecisionItem(decision(), "pros", "  Closer to work ", author, () => "i1");
  assert.deepEqual(added.pros, [{ id: "i1", text: "Closer to work", authorKey: "a@x.com", authorName: "Alex" }]);
  assert.deepEqual(added.cons, []);
  const base = decision();
  assert.equal(addDecisionItem(base, "cons", "   ", author, () => "i2"), base);
  assert.equal(addDecisionItem(base, "cons", "x", { key: "", name: "" }, () => "i3").cons[0].authorName, "Household member");
});

test("editDecisionItem updates the text but keeps the old text when blanked out; removeDecisionItem drops only that item", () => {
  let d = addDecisionItem(addDecisionItem(decision(), "pros", "A", author, () => "a"), "pros", "B", author, () => "b");
  assert.equal(editDecisionItem(d, "pros", "a", " A2 ").pros[0].text, "A2");
  assert.equal(editDecisionItem(d, "pros", "a", "  ").pros[0].text, "A");
  assert.deepEqual(removeDecisionItem(d, "pros", "a").pros.map((item) => item.id), ["b"]);
});

test("moveDecisionItem reorders by one position and is a no-op at either end or for an unknown id", () => {
  let d = decision();
  for (const id of ["a", "b", "c"]) d = addDecisionItem(d, "cons", id, author, () => id);
  assert.deepEqual(moveDecisionItem(d, "cons", "c", "up").cons.map((item) => item.id), ["a", "c", "b"]);
  assert.deepEqual(moveDecisionItem(d, "cons", "a", "down").cons.map((item) => item.id), ["b", "a", "c"]);
  assert.equal(moveDecisionItem(d, "cons", "a", "up"), d);
  assert.equal(moveDecisionItem(d, "cons", "c", "down"), d);
  assert.equal(moveDecisionItem(d, "cons", "zzz", "up"), d);
});

test("markDecided records a trimmed outcome and timestamp, and reopenDecision clears them again", () => {
  const decided = markDecided(decision(), "  Yes, move ", new Date("2026-07-03T08:00:00.000Z"));
  assert.deepEqual({ status: decided.status, outcome: decided.outcome, decidedAt: decided.decidedAt }, { status: "decided", outcome: "Yes, move", decidedAt: "2026-07-03T08:00:00.000Z" });
  assert.deepEqual({ ...reopenDecision(decided) }, { ...decision(), status: "open", outcome: "", decidedAt: "" });
});

test("updateDecision only replaces the matching decision", () => {
  const list = [decision({ id: "x" }), decision({ id: "y" })];
  const next = updateDecision(list, "y", (item) => ({ ...item, title: "Changed" }));
  assert.deepEqual(next.map((item) => item.title), ["Move?", "Changed"]);
});
