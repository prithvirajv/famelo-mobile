// Pure helpers for the global search overlay and the first-run onboarding prompt, mirroring web's
// globalSearchResults / shouldShowOnboarding (app.js). Types only are imported - see the logic-file import rule.
import type { HouseholdState } from "./types";

export type SearchTarget = "budget" | "notes" | "documents" | "decisions";
export type SearchResult = { type: "Transaction" | "Note" | "Document" | "Decision"; title: string; detail: string; target: SearchTarget };

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_RESULTS = 40;

// Documents are passed in separately because they are fetched on demand, not held in household state.
export function globalSearchResults(state: HouseholdState, documents: Array<{ name: string }>, query: string): SearchResult[] {
  const needle = String(query || "").trim().toLowerCase();
  if (needle.length < SEARCH_MIN_LENGTH) return [];
  const results: SearchResult[] = [];

  for (const transaction of state.transactions || []) {
    if (String(transaction.payee || "").toLowerCase().includes(needle)) {
      results.push({ type: "Transaction", title: transaction.payee, detail: `${Number(transaction.amount || 0).toFixed(2)} · ${transaction.date}`, target: "budget" });
    }
  }
  for (const note of state.notes?.entries || []) {
    if (note.trashed) continue;
    if (`${note.title || ""} ${note.body || ""}`.toLowerCase().includes(needle)) {
      results.push({ type: "Note", title: note.title || "Untitled note", detail: (note.body || "").slice(0, 60), target: "notes" });
    }
  }
  for (const document of documents || []) {
    if (String(document.name || "").toLowerCase().includes(needle)) results.push({ type: "Document", title: document.name, detail: "Document", target: "documents" });
  }
  for (const decision of state.decisions || []) {
    if (String(decision.title || "").toLowerCase().includes(needle)) {
      results.push({ type: "Decision", title: decision.title, detail: decision.status === "decided" || decision.decidedAt ? "Decided" : "Open", target: "decisions" });
    }
  }
  return results.slice(0, SEARCH_MAX_RESULTS);
}

// Only a genuinely fresh household is offered onboarding; state.onboarding.dismissed sticks once set.
export function shouldShowOnboarding(state: HouseholdState): boolean {
  if (state.onboarding?.dismissed) return false;
  return (state.accounts || []).length === 0 && (state.budget?.categories || []).length === 0 && (state.paychecks || []).length === 0;
}

export function dismissOnboarding(state: HouseholdState): HouseholdState {
  return { ...state, onboarding: { dismissed: true } };
}

export type OnboardingStep = { title: string; body: string; target: "wealth" | "budget" | "sharing" | "home"; cta: string };
export const ONBOARDING_STEPS: OnboardingStep[] = [
  { title: "Add an account", body: "Add a bank or credit-card account so balances stay in one place instead of being tracked by hand.", target: "wealth", cta: "Add an account" },
  { title: "Invite your household", body: "Bring in the rest of the household - everyone sees the same budget, calendar and shared expenses.", target: "sharing", cta: "Invite someone" },
  { title: "Set a starting budget", body: "Add a first category or two - you can always add more later. Income comes from your paychecks.", target: "budget", cta: "Start planning" },
  { title: "You're set", body: "That's the basics - explore the rest of FamilyLoop whenever you're ready. ", target: "home", cta: "Go to Home" }
];
