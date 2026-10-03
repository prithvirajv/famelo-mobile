import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTags, validateEntryInput, createEntry, updateEntry, removePhoto, sortedEntries, writingStreak, entriesInYear, allTags, filterEntries, moodTrend, todaysJournalContext
} from "../src/journalLogic.ts";

const entry = (overrides = {}) => ({ id: "e1", entryDate: "2026-07-10", title: "T", body: "B", mood: "Happy", tags: [], photos: [], createdAt: "2026-07-10T10:00:00.000Z", updatedAt: "2026-07-10T10:00:00.000Z", ...overrides });
const input = (overrides = {}) => ({ entryDate: "2026-07-10", title: "T", body: "", mood: "", gratitude: "", tags: "", ...overrides });

test("parseTags splits on commas and trims", () => {
  assert.deepEqual(parseTags(" travel, ,family ,work"), ["travel", "family", "work"]);
});

test("entry input needs some content and a real calendar date", () => {
  assert.equal(validateEntryInput(input()), null);
  assert.equal(validateEntryInput(input({ title: "", gratitude: "sunshine" })), null);
  assert.match(validateEntryInput(input({ title: " " })), /Write/);
  assert.match(validateEntryInput(input({ entryDate: "2026-02-30" })), /real date/);
  assert.match(validateEntryInput(input({ entryDate: "07/10/2026" })), /real date/);
});

test("createEntry and updateEntry trim, parse tags, stamp updatedAt and keep photos and createdAt", () => {
  const created = createEntry(input({ title: " Hi ", tags: "a, b", gratitude: " thanks " }), () => "new", new Date("2026-07-11T00:00:00.000Z"));
  assert.deepEqual([created.id, created.title, created.tags, created.gratitude, created.photos], ["new", "Hi", ["a", "b"], "thanks", []]);
  assert.equal(created.createdAt, created.updatedAt);
  const photo = { id: "p1", dataUrl: "data:x", createdAt: "" };
  const original = [entry({ photos: [photo] }), entry({ id: "e2" })];
  const updated = updateEntry(original, "e1", input({ title: "New", mood: "Calm", tags: "x" }), new Date("2026-08-01T00:00:00.000Z"));
  assert.deepEqual([updated[0].title, updated[0].mood, updated[0].tags, updated[0].updatedAt], ["New", "Calm", ["x"], "2026-08-01T00:00:00.000Z"]);
  assert.deepEqual(updated[0].photos, [photo]);
  assert.equal(updated[0].createdAt, original[0].createdAt);
  assert.equal(updated[1], original[1]);
  assert.equal(original[0].title, "T");
  assert.deepEqual(removePhoto(original, "e1", "p1")[0].photos, []);
});

test("sortedEntries is newest date first, ties by creation time", () => {
  const list = [entry({ id: "a", entryDate: "2026-07-01" }), entry({ id: "b", entryDate: "2026-07-05", createdAt: "2026-07-05T08:00:00.000Z" }), entry({ id: "c", entryDate: "2026-07-05", createdAt: "2026-07-05T09:00:00.000Z" })];
  assert.deepEqual(sortedEntries(list).map((e) => e.id), ["c", "b", "a"]);
});

test("writing streak counts consecutive days back from the latest entry, across month ends, and entries-this-year counts by year", () => {
  const days = ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-07-20"].map((entryDate, i) => entry({ id: `d${i}`, entryDate }));
  assert.equal(writingStreak(days), 4);
  assert.equal(writingStreak([]), 0);
  assert.equal(writingStreak([entry({ entryDate: "2026-03-01" }), entry({ id: "x", entryDate: "2026-03-01" })]), 1);
  assert.equal(entriesInYear([entry(), entry({ id: "o", entryDate: "2025-12-31" })], 2026), 1);
});

test("tags are collected sorted and unique; filtering searches title, body and tags and honours the tag filter", () => {
  const list = [entry({ id: "a", title: "Beach day", tags: ["travel", "family"] }), entry({ id: "b", body: "Quiet evening", tags: ["family"] })];
  assert.deepEqual(allTags(list), ["family", "travel"]);
  assert.deepEqual(filterEntries(list, "BEACH", "").map((e) => e.id), ["a"]);
  assert.deepEqual(filterEntries(list, "quiet", "").map((e) => e.id), ["b"]);
  assert.deepEqual(filterEntries(list, "travel", "").map((e) => e.id), ["a"], "tags are searchable text too");
  assert.deepEqual(filterEntries(list, "", "family").map((e) => e.id), ["a", "b"]);
  assert.deepEqual(filterEntries(list, "evening", "travel"), []);
});

test("mood trend is the latest 12 oldest-first with a short bar for no mood", () => {
  const many = Array.from({ length: 14 }, (_, i) => entry({ id: `m${i}`, entryDate: `2026-07-${String(i + 1).padStart(2, "0")}`, mood: i === 13 ? "" : "Sad" }));
  const trend = moodTrend(many);
  assert.equal(trend.length, 12);
  assert.equal(trend[0].id, "m2");
  assert.deepEqual([trend[11].id, trend[11].heightPercent, trend[0].heightPercent], ["m13", 10, 20]);
});

test("the reflection context covers only the viewer's own day and never includes note bodies", () => {
  const me = "me@example.com";
  const state = {
    calendar: {
      chores: [{ title: "Dishes", completedBy: { "2026-07-10": [me], "2026-07-09": [me] } }, { title: "Trash", completedBy: { "2026-07-10": ["other@example.com"] } }],
      events: [
        { type: "reminder", title: "Call mom", date: "2026-07-10", completedBy: [me] },
        { type: "reminder", title: "Not done", date: "2026-07-10", completedBy: [] },
        { type: "birthday", title: "Sam's birthday", monthDay: "07-10", wishedBy: { 2026: [me] } },
        { type: "birthday", title: "Old wish", monthDay: "07-10", wishedBy: { 2025: [me] } }
      ]
    },
    notes: { entries: [{ title: "Plan trip", body: "SECRET", trashed: false, updatedAt: "2026-07-10T09:00:00.000Z" }, { title: "", body: "x", trashed: false, updatedAt: "2026-07-10T10:00:00.000Z" }, { title: "Gone", trashed: true, updatedAt: "2026-07-10T09:00:00.000Z" }] }
  };
  const context = todaysJournalContext(state, me, "2026-07-10");
  assert.equal(context, "Completed chores today: Dishes. Completed reminders today: Call mom. Wished today: Sam's birthday. Notes worked on today: Plan trip, an untitled note.");
  assert.ok(!context.includes("SECRET"));
  assert.equal(todaysJournalContext({ calendar: { chores: [], events: [] }, notes: { entries: [] } }, me, "2026-07-10"), "");
});
