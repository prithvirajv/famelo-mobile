import type { HouseholdState, JournalEntry } from "./types";

export function validateJournalPayload(body: { entries?: unknown } | null | undefined, maxPhotosPerEntry = 8): string | null {
  if (!body || !Array.isArray(body.entries)) return "Invalid journal payload";
  for (const entry of body.entries as Array<{ photos?: unknown[] }>) {
    if (Array.isArray(entry.photos) && entry.photos.length > maxPhotosPerEntry) {
      return "Each journal entry supports at most 8 photos";
    }
  }
  return null;
}

// ---- entries, stats, search and the day summary used for the AI reflection (mirrors web's journal helpers in app.js) ----
export const JOURNAL_MOODS = ["Happy", "Calm", "Neutral", "Stressed", "Sad", "Grateful", "Excited"];
export const JOURNAL_MOOD_EMOJI: Record<string, string> = { Happy: "😊", Calm: "😌", Neutral: "😐", Stressed: "😖", Sad: "😢", Grateful: "🙏", Excited: "🤩" };
export const JOURNAL_MOOD_COLOR: Record<string, string> = { Happy: "#f59e0b", Calm: "#38bdf8", Neutral: "#94a3b8", Stressed: "#ef4444", Sad: "#6366f1", Grateful: "#10b981", Excited: "#ec4899" };
const MOOD_VALENCE: Record<string, number> = { Excited: 5, Happy: 5, Grateful: 4, Calm: 4, Neutral: 3, Stressed: 2, Sad: 1 };
export const JOURNAL_MAX_PHOTOS = 8;

export function parseTags(text: string): string[] {
  return String(text || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

export type EntryInput = { entryDate: string; title: string; body: string; mood: string; gratitude: string; tags: string };

// Same blank rule as before: an entry needs a title, a body or a gratitude line. Dates must be real calendar days.
export function validateEntryInput(input: EntryInput): string | null {
  if (!input.title.trim() && !input.body.trim() && !input.gratitude.trim()) return "Write a title, a few words, or something you're grateful for.";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.entryDate);
  const real = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!match || !real || real.getUTCMonth() !== Number(match[2]) - 1 || real.getUTCDate() !== Number(match[3])) return "Use a real date as YYYY-MM-DD.";
  return null;
}

export function createEntry(input: EntryInput, createId: () => string, now: Date = new Date()): JournalEntry {
  const stamp = now.toISOString();
  return { id: createId(), entryDate: input.entryDate, title: input.title.trim(), body: input.body.trim(), mood: input.mood, gratitude: input.gratitude.trim(), tags: parseTags(input.tags), photos: [], createdAt: stamp, updatedAt: stamp };
}

export function updateEntry(entries: JournalEntry[], entryId: string, input: EntryInput, now: Date = new Date()): JournalEntry[] {
  return entries.map((entry) => entry.id === entryId
    ? { ...entry, entryDate: input.entryDate, title: input.title.trim(), body: input.body.trim(), mood: input.mood, gratitude: input.gratitude.trim(), tags: parseTags(input.tags), updatedAt: now.toISOString() }
    : entry);
}

export function removePhoto(entries: JournalEntry[], entryId: string, photoId: string): JournalEntry[] {
  return entries.map((entry) => entry.id === entryId ? { ...entry, photos: entry.photos.filter((photo) => photo.id !== photoId) } : entry);
}

export function sortedEntries(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function shiftDay(dateKey: string, days: number): string {
  const [year = 0, month = 1, day = 1] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// Consecutive days with an entry, counted back from the most recent entry's date (a streak that ended yesterday still counts).
export function writingStreak(entries: JournalEntry[]): number {
  const dates = new Set(entries.map((entry) => entry.entryDate).filter(Boolean));
  if (!dates.size) return 0;
  let cursor = [...dates].sort().pop() as string;
  let streak = 0;
  while (dates.has(cursor)) { streak += 1; cursor = shiftDay(cursor, -1); }
  return streak;
}

export function entriesInYear(entries: JournalEntry[], year: number): number {
  return entries.filter((entry) => (entry.entryDate || "").startsWith(String(year))).length;
}

export function allTags(entries: JournalEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.tags || []))].sort();
}

export function filterEntries(entries: JournalEntry[], query: string, tag: string): JournalEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (tag && !(entry.tags || []).includes(tag)) return false;
    if (!needle) return true;
    return `${entry.title || ""} ${entry.body || ""} ${(entry.tags || []).join(" ")}`.toLowerCase().includes(needle);
  });
}

// Bar heights for the mood trend: the 12 most recent entries, oldest first; an entry with no mood gets a short neutral bar.
export function moodTrend(entries: JournalEntry[]): Array<{ id: string; mood: string; heightPercent: number }> {
  return sortedEntries(entries).slice(0, 12).reverse().map((entry) => {
    const valence = MOOD_VALENCE[entry.mood] || 0;
    return { id: entry.id, mood: entry.mood, heightPercent: valence ? Math.round((valence / 5) * 100) : 10 };
  });
}

// A plain-text summary of the viewer's own day (titles only, never note bodies or journal text) for the AI "gentle reflection".
// Returns "" when there is nothing to reflect on so the caller can skip the request.
export function todaysJournalContext(state: HouseholdState, viewerKey: string, todayKey: string): string {
  const lines: string[] = [];
  const chores = (state.calendar?.chores || []).filter((chore) => ((chore.completedBy as Record<string, string[]> | undefined)?.[todayKey] || []).includes(viewerKey)).map((chore) => chore.title);
  if (chores.length) lines.push(`Completed chores today: ${chores.join(", ")}.`);
  const reminders = (state.calendar?.events || []).filter((event) => event.type === "reminder" && event.date === todayKey && Array.isArray(event.completedBy) && event.completedBy.includes(viewerKey)).map((event) => event.title);
  if (reminders.length) lines.push(`Completed reminders today: ${reminders.join(", ")}.`);
  const year = todayKey.slice(0, 4);
  const monthDay = todayKey.slice(5);
  const wished = (state.calendar?.events || []).filter((event) => event.monthDay === monthDay && ((event.wishedBy || {})[year] || []).includes(viewerKey)).map((event) => event.title);
  if (wished.length) lines.push(`Wished today: ${wished.join(", ")}.`);
  const notes = (state.notes?.entries || []).filter((note) => !note.trashed && (note.updatedAt || "").slice(0, 10) === todayKey).map((note) => note.title || "an untitled note");
  if (notes.length) lines.push(`Notes worked on today: ${notes.join(", ")}.`);
  return lines.join(" ");
}
