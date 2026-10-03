import assert from "node:assert/strict";
import test from "node:test";
import { ALL_SCOPES, toggleScope, setShareEverything, allScopesShared, recordInvitation, recordRevoked, recordAccessLevel, emailOutcomeMessage, validateNewPassword, isDemoAccount } from "../src/sharingLogic.ts";

const base = (household = {}) => ({ household: { name: "Home", country: "US", currency: "USD", activity: ["old"], members: [{ name: "Owner", email: "o@example.com", role: "owner" }], sharedScopes: [], ...household } });

test("scopes toggle on and off, and Share everything selects all or none without mutating the input", () => {
  const state = base();
  const on = toggleScope(state, "Budget");
  assert.deepEqual(on.household.sharedScopes, ["Budget"]);
  assert.deepEqual(state.household.sharedScopes, []);
  assert.deepEqual(toggleScope(on, "Budget").household.sharedScopes, []);
  const all = setShareEverything(state, true);
  assert.equal(allScopesShared(all), true);
  assert.deepEqual(all.household.sharedScopes, ALL_SCOPES);
  assert.deepEqual(setShareEverything(all, false).household.sharedScopes, []);
  assert.equal(allScopesShared(on), false);
  assert.deepEqual(toggleScope({ household: { name: "x" } }, "Notes").household.sharedScopes, ["Notes"], "state with no scopes yet");
});

test("recordInvitation adds a pending member, replaces one with the same email, saves the code and logs activity", () => {
  const added = recordInvitation(base(), { name: "Sam", email: "Sam@Example.com", role: "Adult, budget and calendar", inviteCode: "HUB-ABC123" });
  assert.deepEqual(added.household.members[1], { name: "Sam", email: "Sam@Example.com", role: "Adult, budget and calendar - Invited" });
  assert.equal(added.household.inviteCode, "HUB-ABC123");
  assert.equal(added.household.activity[0], "Sam was invited to Home");
  const again = recordInvitation(added, { name: "Samuel", email: "sam@example.com", role: "Viewer, read only" });
  assert.equal(again.household.members.length, 2);
  assert.equal(again.household.members[1].name, "Samuel");
  assert.equal(again.household.inviteCode, "HUB-ABC123", "no new code leaves the old one");
  assert.equal(recordInvitation({ household: { name: "H" } }, { name: "A", email: "a@b.co", role: "R" }).household.members.length, 1);
});

test("recordRevoked drops the member case-insensitively; recordAccessLevel only logs", () => {
  const state = recordInvitation(base(), { name: "Sam", email: "sam@example.com", role: "R" });
  const revoked = recordRevoked(state, "SAM@example.com");
  assert.deepEqual(revoked.household.members.map((m) => m.email), ["o@example.com"]);
  assert.equal(revoked.household.activity[0], "Access revoked for SAM@example.com");
  const level = recordAccessLevel(base(), "x@y.co", "view");
  assert.equal(level.household.activity[0], "View-only access set for x@y.co");
  assert.deepEqual(level.household.members, base().household.members);
});

test("email outcome messages cover queued, preview and rejected for both actions", () => {
  assert.match(emailOutcomeMessage({ queued: true }, "a@b.co", "invite"), /queued/);
  assert.match(emailOutcomeMessage({ preview: true }, "a@b.co", "revoke"), /not configured/);
  assert.match(emailOutcomeMessage({}, "a@b.co", "invite"), /did not accept/);
  assert.match(emailOutcomeMessage(undefined, "a@b.co", "revoke"), /did not accept/);
});

test("password validation and demo-account detection", () => {
  assert.match(validateNewPassword("", "longenough", "longenough"), /current/);
  assert.match(validateNewPassword("old", "short", "short"), /8 characters/);
  assert.match(validateNewPassword("old", "longenough", "different1"), /match/);
  assert.equal(validateNewPassword("old", "longenough", "longenough"), null);
  assert.equal(isDemoAccount("Demo@FamilyLoop.net"), true);
  assert.equal(isDemoAccount("me@example.com"), false);
});
