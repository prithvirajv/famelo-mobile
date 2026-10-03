// Pure helpers for Notes beyond add/edit: views (notes / reminders / archive / trash / by label), search, labels, a reminder, a
// bill link, copying, trash with a 7-day auto-purge, and checklist editing (rename, delete, indent, reorder). Ported from web's
// app.js handlers. Every function returns new data and never mutates its input.
import type { Note, NoteItem } from "./types";

export type NotesView = "notes" | "reminders" | "archive" | "trash" | "label";

const newestPinnedFirst = (a: Note, b: Note) => Number(b.pinned) - Number(a.pinned) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));

// What a view shows, filtered by an optional search over title, body, labels and checklist text, pinned first then newest.
export function visibleNotes(notes: Note[], view: NotesView, query = "", label = ""): Note[] {
  const needle = query.trim().toLowerCase();
  return notes.filter((note) => {
    if (view === "archive" && !(note.archived && !note.trashed)) return false;
    if (view === "trash" && !note.trashed) return false;
    if (view === "notes" && (note.archived || note.trashed)) return false;
    if (view === "reminders" && (note.archived || note.trashed || !note.reminder)) return false;
    if (view === "label" && (note.archived || note.trashed || !(note.labels || []).includes(label))) return false;
    if (!needle) return true;
    return [note.title, note.body, ...(note.labels || []), ...note.checklist.map((item) => item.text)].join(" ").toLowerCase().includes(needle);
  }).sort(newestPinnedFirst);
}

// Every label in use on a live (not trashed) note, A-Z.
export function allLabels(notes: Note[]): string[] {
  const seen = new Map<string, string>();
  notes.filter((note) => !note.trashed).forEach((note) => (note.labels || []).forEach((label) => { const key = label.trim().toLowerCase(); if (key && !seen.has(key)) seen.set(key, label.trim()); }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// Adds or removes a label; matching ignores case so "Home" and "home" are one label (the existing spelling is kept).
export function toggleLabel(note: Note, label: string): Note {
  const clean = label.trim();
  if (!clean) return note;
  const labels = note.labels || [];
  const key = clean.toLowerCase();
  return { ...note, labels: labels.some((item) => item.toLowerCase() === key) ? labels.filter((item) => item.toLowerCase() !== key) : [...labels, clean] };
}

function localIso(date: string, time: string): string | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (![year, month, day, hour, minute].every((part) => Number.isInteger(part))) return null;
  const instant = new Date(year as number, (month as number) - 1, day as number, hour as number, minute as number);
  const real = instant.getFullYear() === year && instant.getMonth() === (month as number) - 1 && instant.getDate() === day && instant.getHours() === hour && instant.getMinutes() === minute;
  return real ? instant.toISOString() : null;
}

// A note reminder needs BOTH a date and a time (web clears it otherwise); returns null for an invalid pair so the caller can say so.
// Blank date AND time clears it.
export function setNoteReminder(note: Note, date: string, time: string): Note | null {
  const d = date.trim();
  const t = time.trim();
  if (!d && !t) return { ...note, reminder: "", reminderAt: "" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  const iso = localIso(d, t);
  return iso ? { ...note, reminder: `${d}T${t}`, reminderAt: iso } : null;
}

export function setNoteBill(note: Note, billLineId: string | null): Note {
  return { ...note, billLineId: billLineId || null };
}

// Trashing also unpins and unarchives it, and stamps when - trash is emptied after a week.
export function trashNote(note: Note, now: Date = new Date()): Note {
  return { ...note, trashed: true, trashedAt: now.toISOString(), archived: false, pinned: false };
}

export function restoreNote(note: Note): Note {
  return { ...note, trashed: false, trashedAt: "" };
}

const TRASH_DAYS = 7;

// Drops notes that have been in the trash longer than a week. A trashed note with no timestamp (trashed before web stamped it) is
// kept - there is nothing to measure its age by.
export function purgeExpiredTrash(notes: Note[], now: Date = new Date()): Note[] {
  const cutoff = now.getTime() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  return notes.filter((note) => !note.trashed || !note.trashedAt || new Date(note.trashedAt).getTime() > cutoff);
}

// A copy goes to the top, unpinned and live, titled "<title> copy"; its checklist gets fresh ids with the parent links remapped so
// the copy's sub-items point at the copy's own parents, not the original's.
export function duplicateNote(note: Note, createId: (prefix: string) => string, now: Date = new Date()): Note {
  const idMap = new Map(note.checklist.map((item) => [item.id, createId("item")]));
  return {
    ...note, id: createId("note"), title: `${note.title || "Untitled note"} copy`,
    checklist: note.checklist.map((item) => ({ ...item, id: idMap.get(item.id) as string, ...(item.parentId && idMap.has(item.parentId) ? { parentId: idMap.get(item.parentId) } : { parentId: "" }) })),
    labels: [...(note.labels || [])], pinned: false, archived: false, trashed: false, trashedAt: "", createdAt: now.toISOString()
  };
}

// ---- Checklist editing ------------------------------------------------------------------------------------------------------

export function editChecklistText(checklist: NoteItem[], itemId: string, text: string): NoteItem[] {
  const clean = text.trim();
  return clean ? checklist.map((item) => item.id === itemId ? { ...item, text: clean } : item) : checklist;
}

// Deleting a parent promotes its children to top level rather than deleting them too.
export function deleteChecklistItem(checklist: NoteItem[], itemId: string): NoteItem[] {
  return checklist.filter((item) => item.id !== itemId).map((item) => item.parentId === itemId ? { ...item, parentId: "" } : item);
}

// One level only: a top-level item becomes a sub-item of the nearest top-level item above it (nothing above = no change); a
// sub-item goes back to top level. A parent that has its own children cannot itself be indented (that would nest two deep).
export function toggleIndent(checklist: NoteItem[], itemId: string): NoteItem[] {
  const index = checklist.findIndex((item) => item.id === itemId);
  const item = checklist[index];
  if (!item) return checklist;
  if (item.parentId) return checklist.map((entry) => entry.id === itemId ? { ...entry, parentId: "" } : entry);
  if (checklist.some((entry) => entry.parentId === itemId)) return checklist;
  const parent = [...checklist.slice(0, index)].reverse().find((candidate) => !candidate.parentId);
  return parent ? checklist.map((entry) => entry.id === itemId ? { ...entry, parentId: parent.id } : entry) : checklist;
}

// Moves an item one place up or down among its siblings (a top-level item takes its sub-items with it). The phone stand-in for web's
// drag-to-reorder. No-op at either end.
export function moveChecklistItem(checklist: NoteItem[], itemId: string, direction: "up" | "down"): NoteItem[] {
  const item = checklist.find((entry) => entry.id === itemId);
  if (!item) return checklist;
  const blockOf = (entry: NoteItem) => checklist.filter((candidate) => candidate.id === entry.id || (!entry.parentId && candidate.parentId === entry.id));
  const siblings = checklist.filter((entry) => (entry.parentId || "") === (item.parentId || ""));
  const position = siblings.findIndex((entry) => entry.id === itemId);
  const neighbor = siblings[direction === "up" ? position - 1 : position + 1];
  if (!neighbor) return checklist;
  const moving = new Set(blockOf(item).map((entry) => entry.id));
  const neighborBlock = blockOf(neighbor).map((entry) => entry.id);
  const rest = checklist.filter((entry) => !moving.has(entry.id));
  const targetIndex = rest.findIndex((entry) => entry.id === (direction === "up" ? neighborBlock[0] : neighborBlock[neighborBlock.length - 1]));
  rest.splice(direction === "up" ? targetIndex : targetIndex + 1, 0, ...checklist.filter((entry) => moving.has(entry.id)));
  return rest;
}

// Splits a checklist into what is still open and what is done. A sub-item stays next to its parent until the whole group is done
// (its own tick doesn't strand it in the completed pile), so it counts as completed only when its parent is.
export function bucketChecklistItems(checklist: NoteItem[]): { open: NoteItem[]; completed: NoteItem[] } {
  const byId = new Map(checklist.map((item) => [item.id, item]));
  const isCompleted = (item: NoteItem) => item.parentId ? Boolean(byId.get(item.parentId)?.done) : Boolean(item.done);
  return { open: checklist.filter((item) => !isCompleted(item)), completed: checklist.filter(isCompleted) };
}
