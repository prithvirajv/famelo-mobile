// Pure helpers for household sharing (members, invitations, scopes) and the Profile screen, mirroring web's handlers in app.js.
// Server calls live in api.ts; these only reshape household state, returning new objects so the result can go straight to the
// whole-state save. Types only are imported - see the logic-file import rule.
import type { HouseholdState } from "./types";

export const ACCESS_ROLES = ["Co-owner, full edit", "Adult, budget and calendar", "Viewer, read only", "Meals and chores only"];
export const ALL_SCOPES = [
  "Budget", "Transactions", "Bank sync", "Paychecks", "Calendar", "Chores", "Birthday reminders", "Anniversary reminders", "Notes",
  "Documents", "Meals", "Grocery lists", "Reminders", "Goals", "Debt payoff", "Net worth", "Reports"
];

type Household = HouseholdState["household"];
type Member = NonNullable<Household["members"]>[number];

function withHousehold(state: HouseholdState, change: Partial<Household>, activity?: string): HouseholdState {
  const household = { ...state.household, ...change };
  if (activity && state.household.activity) household.activity = [activity, ...state.household.activity];
  return { ...state, household };
}

export function sharedScopesOf(state: HouseholdState): string[] {
  return state.household.sharedScopes || [];
}

export function toggleScope(state: HouseholdState, scope: string): HouseholdState {
  const current = sharedScopesOf(state);
  return withHousehold(state, { sharedScopes: current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope] });
}

// "Share everything" on selects every area; off clears them (web's toggle).
export function setShareEverything(state: HouseholdState, on: boolean): HouseholdState {
  return withHousehold(state, { sharedScopes: on ? [...ALL_SCOPES] : [] });
}

export function allScopesShared(state: HouseholdState): boolean {
  return sharedScopesOf(state).length === ALL_SCOPES.length;
}

export type Invitation = { name: string; email: string; role: string; inviteCode?: string; householdName?: string };

// Records an invitation sent for the current household as a pending ("Invited") member, replacing any entry for the same email.
export function recordInvitation(state: HouseholdState, invitation: Invitation): HouseholdState {
  const members: Member[] = state.household.members || [];
  const invitedRole = `${invitation.role} - Invited`;
  const email = invitation.email.toLowerCase();
  const exists = members.some((member) => member.email.toLowerCase() === email);
  const nextMembers = exists
    ? members.map((member) => member.email.toLowerCase() === email ? { ...member, name: invitation.name, email: invitation.email, role: invitedRole } : member)
    : [...members, { name: invitation.name, email: invitation.email, role: invitedRole }];
  return withHousehold(state, { members: nextMembers, ...(invitation.inviteCode ? { inviteCode: invitation.inviteCode } : {}) }, `${invitation.name} was invited to ${state.household.name}`);
}

export function recordRevoked(state: HouseholdState, email: string): HouseholdState {
  const members = (state.household.members || []).filter((member) => member.email.toLowerCase() !== email.toLowerCase());
  return withHousehold(state, { members }, `Access revoked for ${email}`);
}

export function recordAccessLevel(state: HouseholdState, email: string, accessLevel: "edit" | "view"): HouseholdState {
  return withHousehold(state, {}, `${accessLevel === "view" ? "View-only" : "Edit"} access set for ${email}`);
}

// Human summary of the server's outbound-email result for an invite/revoke.
export function emailOutcomeMessage(email: { queued?: boolean; preview?: boolean } | undefined, address: string, action: "invite" | "revoke"): string {
  const noun = action === "invite" ? "Invitation" : "Access revoked";
  if (email?.queued) return action === "invite" ? `${noun} queued for ${address}. Check Inbox, Spam, and All Mail.` : `${noun} and an email was queued for ${address}.`;
  if (email?.preview) return `${noun} saved. Email is not configured on this server, so only a local preview was created for ${address}.`;
  return `${noun} saved, but the email provider did not accept mail for ${address}.`;
}

export function validateNewPassword(current: string, next: string, confirm: string): string | null {
  if (!current) return "Enter your current password.";
  if (next.length < 8) return "New password must be at least 8 characters.";
  if (next !== confirm) return "New passwords don't match.";
  return null;
}

export const DEMO_EMAIL = "demo@familyloop.net";
export function isDemoAccount(email: string | undefined): boolean {
  return String(email || "").toLowerCase() === DEMO_EMAIL;
}
