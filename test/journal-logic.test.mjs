import assert from "node:assert/strict";
import test from "node:test";
import { validateJournalPayload } from "../src/journalLogic.ts";

test("validateJournalPayload rejects a non-object or missing entries array", () => {
  assert.equal(validateJournalPayload(null), "Invalid journal payload");
  assert.equal(validateJournalPayload({}), "Invalid journal payload");
});

test("validateJournalPayload accepts entries within the photo limit", () => {
  const payload = { entries: [{ id: "1", photos: [{ id: "p1" }, { id: "p2" }] }] };
  assert.equal(validateJournalPayload(payload), null);
});

test("validateJournalPayload rejects an entry exceeding the photo limit", () => {
  const photos = Array.from({ length: 9 }, (_, index) => ({ id: `p${index}` }));
  const payload = { entries: [{ id: "1", photos }] };
  assert.equal(validateJournalPayload(payload), "Each journal entry supports at most 8 photos");
});
