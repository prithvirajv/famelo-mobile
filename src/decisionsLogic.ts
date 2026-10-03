// Pure helpers for the Decisions (family pros/cons) screen, mirroring web's handlers in app.js.
// Every function returns new data and never mutates its input, so callers can hand the result
// straight to the whole-state save. Decisions are family-wide: the server syncs state.decisions
// across all of an owner's households on every PUT /api/state, so mobile needs no extra plumbing.
import type { Decision, DecisionComment } from "./types";

export type DecisionListKey = "pros" | "cons";

// Open decisions first, then newest first within each group (web's renderDecisions order).
export function sortDecisions(decisions: Decision[]): Decision[] {
  return [...decisions].sort((a, b) => {
    if ((a.status === "decided") !== (b.status === "decided")) return a.status === "decided" ? 1 : -1;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

export function createDecision(title: string, notes: string, createId: () => string, now: Date = new Date()): Decision | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  return { id: createId(), title: trimmed, notes: notes.trim(), status: "open", outcome: "", decidedAt: "", pros: [], cons: [], createdAt: now.toISOString() };
}

export function updateDecision(decisions: Decision[], decisionId: string, update: (decision: Decision) => Decision): Decision[] {
  return decisions.map((decision) => decision.id === decisionId ? update(decision) : decision);
}

export function addDecisionItem(decision: Decision, listKey: DecisionListKey, text: string, author: { key: string; name: string }, createId: () => string): Decision {
  const trimmed = text.trim();
  if (!trimmed) return decision;
  const item: DecisionComment = { id: createId(), text: trimmed, authorKey: author.key, authorName: author.name || "Household member" };
  return { ...decision, [listKey]: [...decision[listKey], item] };
}

// An edit that is blanked out keeps the previous text instead of leaving an empty item (web).
export function editDecisionItem(decision: Decision, listKey: DecisionListKey, itemId: string, text: string): Decision {
  const trimmed = text.trim();
  if (!trimmed) return decision;
  return { ...decision, [listKey]: decision[listKey].map((item) => item.id === itemId ? { ...item, text: trimmed } : item) };
}

export function removeDecisionItem(decision: Decision, listKey: DecisionListKey, itemId: string): Decision {
  return { ...decision, [listKey]: decision[listKey].filter((item) => item.id !== itemId) };
}

// Items are ranked by position (top = strongest); moving past either end is a no-op.
export function moveDecisionItem(decision: Decision, listKey: DecisionListKey, itemId: string, direction: "up" | "down"): Decision {
  const list = [...decision[listKey]];
  const index = list.findIndex((item) => item.id === itemId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= list.length) return decision;
  [list[index], list[target]] = [list[target] as DecisionComment, list[index] as DecisionComment];
  return { ...decision, [listKey]: list };
}

export function markDecided(decision: Decision, outcome: string, now: Date = new Date()): Decision {
  return { ...decision, status: "decided", outcome: outcome.trim(), decidedAt: now.toISOString() };
}

export function reopenDecision(decision: Decision): Decision {
  return { ...decision, status: "open", outcome: "", decidedAt: "" };
}
