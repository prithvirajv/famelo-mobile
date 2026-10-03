import assert from "node:assert/strict";
import test from "node:test";
import { visibleNotes, allLabels, toggleLabel, setNoteReminder, setNoteBill, trashNote, restoreNote, purgeExpiredTrash, duplicateNote, editChecklistText, deleteChecklistItem, toggleIndent, moveChecklistItem, bucketChecklistItems } from "../src/notesLogic.ts";

const note = (id, overrides = {}) => ({ id, title: id, body: "", checklist: [], pinned: false, archived: false, trashed: false, color: "#ffffff", createdAt: "2026-07-01T00:00:00.000Z", ...overrides });
const item = (id, overrides = {}) => ({ id, text: id, done: false, ...overrides });

test("visibleNotes shows the right notes for each view, pinned first then newest, and never a trashed note outside Trash", () => {
  const notes = [
    note("old", { createdAt: "2026-06-01T00:00:00.000Z" }), note("new", { createdAt: "2026-07-05T00:00:00.000Z" }), note("pin", { pinned: true, createdAt: "2026-05-01T00:00:00.000Z" }),
    note("arch", { archived: true }), note("bin", { trashed: true }), note("rem", { reminder: "2026-08-01T09:00", labels: ["Home"] }), note("trashed-arch", { archived: true, trashed: true })
  ];
  assert.deepEqual(visibleNotes(notes, "notes").map((n) => n.id), ["pin", "new", "rem", "old"]);
  assert.equal(visibleNotes(notes, "notes")[0].id, "pin");
  assert.ok(!visibleNotes(notes, "notes").some((n) => ["arch", "bin", "trashed-arch"].includes(n.id)));
  assert.deepEqual(visibleNotes(notes, "archive").map((n) => n.id), ["arch"]);
  assert.deepEqual(visibleNotes(notes, "trash").map((n) => n.id).sort(), ["bin", "trashed-arch"]);
  assert.deepEqual(visibleNotes(notes, "reminders").map((n) => n.id), ["rem"]);
  assert.deepEqual(visibleNotes(notes, "label", "", "Home").map((n) => n.id), ["rem"]);
  assert.deepEqual(visibleNotes(notes, "label", "", "Work"), []);
});

test("visibleNotes search matches title, body, labels and checklist text case-insensitively, and works inside a view", () => {
  const notes = [
    note("a", { title: "Groceries", checklist: [item("1", { text: "Oat milk" })] }), note("b", { body: "call the plumber" }), note("c", { labels: ["Garden"] }), note("d", { title: "Hidden", archived: true })
  ];
  assert.deepEqual(visibleNotes(notes, "notes", "MILK").map((n) => n.id), ["a"]);
  assert.deepEqual(visibleNotes(notes, "notes", "plumb").map((n) => n.id), ["b"]);
  assert.deepEqual(visibleNotes(notes, "notes", "garden").map((n) => n.id), ["c"]);
  assert.deepEqual(visibleNotes(notes, "notes", "hidden"), []);
  assert.deepEqual(visibleNotes(notes, "archive", "hidden").map((n) => n.id), ["d"]);
  assert.equal(visibleNotes(notes, "notes", "  ").length, 3);
});

test("labels: allLabels is de-duplicated A-Z from live notes only; toggleLabel adds/removes ignoring case and keeps the existing spelling", () => {
  const notes = [note("a", { labels: ["Home", "work"] }), note("b", { labels: ["home", "Garden"] }), note("c", { labels: ["Secret"], trashed: true })];
  assert.deepEqual(allLabels(notes), ["Garden", "Home", "work"]);
  const withLabel = toggleLabel(note("x"), "  Errands ");
  assert.deepEqual(withLabel.labels, ["Errands"]);
  assert.deepEqual(toggleLabel(withLabel, "errands").labels, []);
  assert.deepEqual(toggleLabel(note("y", { labels: ["Home"] }), "HOME").labels, []);
  const blank = note("z");
  assert.equal(toggleLabel(blank, "   "), blank);
});

test("setNoteReminder needs a real date AND a time, stores the instant for the server, clears on blank, and rejects anything else", () => {
  const set = setNoteReminder(note("a"), "2026-08-01", "09:30");
  assert.equal(set.reminder, "2026-08-01T09:30");
  assert.equal(set.reminderAt, new Date(2026, 7, 1, 9, 30).toISOString());
  assert.deepEqual([setNoteReminder(set, "", "").reminder, setNoteReminder(set, "", "").reminderAt], ["", ""]);
  assert.equal(setNoteReminder(note("a"), "2026-08-01", ""), null);
  assert.equal(setNoteReminder(note("a"), "", "09:30"), null);
  assert.equal(setNoteReminder(note("a"), "2026-02-30", "09:30"), null);
  assert.equal(setNoteReminder(note("a"), "2026-08-01", "25:00"), null);
  assert.equal(setNoteBill(note("a"), "rent").billLineId, "rent");
  assert.equal(setNoteBill(note("a", { billLineId: "rent" }), "").billLineId, null);
});

test("trash: trashing unpins and unarchives and stamps the time, restore clears it, and anything trashed over a week is purged", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const trashed = trashNote(note("a", { pinned: true, archived: true }), now);
  assert.deepEqual([trashed.trashed, trashed.pinned, trashed.archived, trashed.trashedAt], [true, false, false, "2026-07-20T12:00:00.000Z"]);
  const back = restoreNote(trashed);
  assert.deepEqual([back.trashed, back.trashedAt], [false, ""]);
  const notes = [
    note("live"), note("fresh", { trashed: true, trashedAt: "2026-07-15T12:00:00.000Z" }), note("stale", { trashed: true, trashedAt: "2026-07-10T12:00:00.000Z" }), note("unstamped", { trashed: true })
  ];
  assert.deepEqual(purgeExpiredTrash(notes, now).map((n) => n.id), ["live", "fresh", "unstamped"]);
});

test("duplicateNote makes an unpinned live copy with fresh ids and remapped sub-item parents, leaving the original alone", () => {
  let n = 0;
  const createId = (prefix) => `${prefix}-${++n}`;
  const original = note("orig", { title: "Trip", pinned: true, archived: true, labels: ["Fun"], checklist: [item("p"), item("c", { parentId: "p" }), item("o", { parentId: "gone" })] });
  const copy = duplicateNote(original, createId, new Date("2026-07-20T12:00:00.000Z"));
  assert.equal(copy.title, "Trip copy");
  assert.equal(copy.id, "note-4");
  assert.deepEqual([copy.pinned, copy.archived, copy.trashed, copy.createdAt], [false, false, false, "2026-07-20T12:00:00.000Z"]);
  assert.deepEqual(copy.checklist.map((i) => [i.id, i.parentId]), [["item-1", ""], ["item-2", "item-1"], ["item-3", ""]]);
  assert.deepEqual(copy.labels, ["Fun"]);
  assert.notEqual(copy.labels, original.labels);
  assert.equal(original.checklist[1].parentId, "p");
  assert.equal(duplicateNote(note("x", { title: "" }), createId).title, "Untitled note copy");
});

test("checklist editing: rename keeps the old text when blanked, deleting a parent promotes its children", () => {
  const list = [item("a"), item("b", { parentId: "a" }), item("c")];
  assert.equal(editChecklistText(list, "a", "  Milk ")[0].text, "Milk");
  assert.equal(editChecklistText(list, "a", "  "), list);
  assert.deepEqual(deleteChecklistItem(list, "a").map((i) => [i.id, i.parentId || ""]), [["b", ""], ["c", ""]]);
  assert.deepEqual(deleteChecklistItem(list, "c").map((i) => i.id), ["a", "b"]);
});

test("toggleIndent nests a top-level item under the one above (one level only) and un-nests a sub-item", () => {
  const list = [item("a"), item("b"), item("c", { parentId: "a" })];
  assert.equal(toggleIndent(list, "b").find((i) => i.id === "b").parentId, "a");
  assert.equal(toggleIndent(list, "a"), list, "nothing above to nest under");
  assert.equal(toggleIndent(list, "c").find((i) => i.id === "c").parentId, "");
  const withChild = [item("a"), item("b"), item("kid", { parentId: "b" })];
  assert.equal(toggleIndent(withChild, "b"), withChild, "a parent with its own children can't be nested a second level");
  assert.equal(toggleIndent(list, "zzz"), list);
});

test("moveChecklistItem moves an item among its siblings, takes a parent's sub-items with it, and is a no-op at the ends", () => {
  const list = [item("a"), item("a1", { parentId: "a" }), item("a2", { parentId: "a" }), item("b"), item("c")];
  assert.deepEqual(moveChecklistItem(list, "b", "up").map((i) => i.id), ["b", "a", "a1", "a2", "c"]);
  assert.deepEqual(moveChecklistItem(list, "a", "down").map((i) => i.id), ["b", "a", "a1", "a2", "c"]);
  assert.deepEqual(moveChecklistItem(list, "a2", "up").map((i) => i.id), ["a", "a2", "a1", "b", "c"]);
  assert.deepEqual(moveChecklistItem(list, "c", "up").map((i) => i.id), ["a", "a1", "a2", "c", "b"]);
  assert.equal(moveChecklistItem(list, "a", "up"), list);
  assert.equal(moveChecklistItem(list, "c", "down"), list);
  assert.equal(moveChecklistItem(list, "a1", "up"), list);
  assert.equal(moveChecklistItem(list, "nope", "up"), list);
  assert.deepEqual(list.map((i) => i.id), ["a", "a1", "a2", "b", "c"]);
});

test("bucketChecklistItems keeps a sub-item with its parent until the whole group is done", () => {
  const list = [item("p", { done: false }), item("kid", { parentId: "p", done: true }), item("solo", { done: true }), item("p2", { done: true }), item("kid2", { parentId: "p2", done: false })];
  const { open, completed } = bucketChecklistItems(list);
  assert.deepEqual(open.map((i) => i.id), ["p", "kid"]);
  assert.deepEqual(completed.map((i) => i.id), ["solo", "p2", "kid2"]);
});
