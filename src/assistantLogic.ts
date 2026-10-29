// "Ask FamilyLoop" (mirrors web's lib/shared-logic.js): the household types a request, the AI only PLANS a short list from a fixed set of
// actions that name real objects by id, and everything here is deterministic - ids are checked against the household's own data, the
// confirmation text is written from the checked action (never from the AI), and nothing changes until the household confirms. The AI can never
// delete anything, touch ledger transactions, or run an action outside ASSISTANT_ACTIONS.
// Logic files do not import each other's values, so the few helpers that live elsewhere (holdings grouping, asset value, setting a payee rule)
// are passed in as `deps`.
import type { HouseholdState, WealthAsset } from "./types";

export type AssistantAction =
  | { type: "close_account"; accountId: string; closedAt?: string }
  | { type: "merge_holdings_group"; fromGroupId: string; intoGroupId: string }
  | { type: "rename_account"; accountId: string; name: string }
  | { type: "rename_holdings_group"; groupId: string; name: string }
  | { type: "set_payee_category"; payee: string; lineId: string };

export type AssistantPlan = { say: string; clarify: string; actions: AssistantAction[] };
type Group = { groupId: string; groupName: string; items: WealthAsset[] };
export type AssistantDeps = {
  groupStockHoldings: (assets: WealthAsset[]) => Group[];
  assetValue: (asset: WealthAsset) => number;
  setPayeeRule: (state: HouseholdState, payee: string, lineId: string) => HouseholdState;
};

const assetsOf = (state: HouseholdState): WealthAsset[] => state.goals?.netWorth?.assets || [];
const linesOf = (state: HouseholdState) => (state.budget?.categories || []).flatMap((category) => (category.lines || []).map((line) => ({ ...line, category: category.name })));

// The small, id-bearing picture of the household the AI plans against (no transactions, no balances beyond group sizes).
export function assistantContext(state: HouseholdState, deps: Pick<AssistantDeps, "groupStockHoldings">) {
  return {
    accounts: (state.accounts || []).map((account) => ({ id: account.id, name: account.name, type: account.type, closed: Boolean(account.closedAt) })),
    groups: deps.groupStockHoldings(assetsOf(state)).map((group) => ({ groupId: group.groupId, name: group.groupName, holdings: group.items.length })),
    lines: linesOf(state).map((line) => ({ id: line.id, label: `${line.category} - ${line.name}` }))
  };
}

// Why an action cannot run against the household's current data ("" when it can).
export function assistantActionProblem(action: AssistantAction, state: HouseholdState, todayKey: string, deps: Pick<AssistantDeps, "groupStockHoldings">): string {
  const groups = deps.groupStockHoldings(assetsOf(state));
  const accountOf = (id: string) => (state.accounts || []).find((item) => item.id === id);
  if (action.type === "close_account") {
    const account = accountOf(action.accountId);
    if (!account) return "That account no longer exists.";
    if (account.closedAt) return `${account.name} is already closed.`;
    return action.closedAt && action.closedAt > todayKey ? "A close date cannot be in the future." : "";
  }
  if (action.type === "merge_holdings_group") {
    if (!groups.some((item) => item.groupId === action.fromGroupId)) return "The group to move no longer exists.";
    if (!groups.some((item) => item.groupId === action.intoGroupId)) return "The group to move into no longer exists.";
    return action.fromGroupId === action.intoGroupId ? "Those are the same group." : "";
  }
  if (action.type === "rename_account") {
    const account = accountOf(action.accountId);
    if (!account) return "That account no longer exists.";
    const name = action.name.trim();
    return !name || name.length > 80 ? "Use a name of 1 to 80 characters." : (state.accounts || []).some((item) => item.id !== account.id && item.name.toLowerCase() === name.toLowerCase()) ? `Another account is already called ${name}.` : "";
  }
  if (action.type === "rename_holdings_group") {
    if (!groups.some((item) => item.groupId === action.groupId)) return "That group no longer exists.";
    return !action.name.trim() || action.name.trim().length > 80 ? "Use a name of 1 to 80 characters." : "";
  }
  if (action.type === "set_payee_category") {
    return linesOf(state).some((line) => line.id === action.lineId) ? (action.payee.trim() ? "" : "No payee given.") : "That Subcategory no longer exists.";
  }
  return "That kind of change is not supported.";
}

// The confirmation sentence for an action, written from the household's own data. money(n) formats an amount.
export function describeAssistantAction(action: AssistantAction, state: HouseholdState, money: (value: number) => string, todayKey: string, deps: AssistantDeps): string {
  const groups = deps.groupStockHoldings(assetsOf(state));
  const groupName = (id: string) => groups.find((item) => item.groupId === id)?.groupName || "that group";
  const account = "accountId" in action ? (state.accounts || []).find((item) => item.id === action.accountId) : undefined;
  if (action.type === "close_account") {
    const closedAt = action.closedAt || todayKey;
    const later = (state.transactions || []).filter((row) => row.accountId === account?.id && row.date > closedAt).length;
    return `Mark "${account?.name}" closed as of ${closedAt}. Its history stays; nothing new can be dated after that day.${later ? ` ${later} existing transaction${later === 1 ? " is" : "s are"} dated after it and stay${later === 1 ? "s" : ""} as they are.` : ""}`;
  }
  if (action.type === "merge_holdings_group") {
    const from = groups.find((item) => item.groupId === action.fromGroupId);
    const total = (from?.items || []).reduce((sum, item) => sum + Number(deps.assetValue(item) || 0), 0);
    return `Move all ${from?.items.length || 0} holding${from?.items.length === 1 ? "" : "s"} (about ${money(total)}) from "${from?.groupName}" into "${groupName(action.intoGroupId)}". "${from?.groupName}" disappears as a separate group; your net worth stays the same.`;
  }
  if (action.type === "rename_account") return `Rename the account "${account?.name}" to "${action.name.trim()}".`;
  if (action.type === "rename_holdings_group") return `Rename the holdings group "${groupName(action.groupId)}" to "${action.name.trim()}".`;
  const line = linesOf(state).find((item) => item.id === action.lineId);
  return `From now on, file "${action.payee.trim()}" under ${line ? `${line.category} - ${line.name}` : "that Subcategory"} (new imports and the overnight sync; earlier transactions stay as they are).`;
}

type Patch = Partial<Pick<HouseholdState, "accounts" | "goals" | "transactionCategorizationRules" | "transactionCategorizationRuleLabels">>;

// Applies checked actions. Returns { patch, undo, applied, skipped }: patch holds the household-state keys that change (the caller spreads it
// into the state), undo holds those same keys as they were. Nothing in the household state is mutated here.
export function applyAssistantActions(state: HouseholdState, actions: AssistantAction[], todayKey: string, deps: AssistantDeps): { patch: Patch; undo: Patch; applied: AssistantAction[]; skipped: Array<{ action: AssistantAction; reason: string }> } {
  let draft: HouseholdState = state;
  const undo: Record<string, unknown> = {};
  const keep = (...keys: Array<keyof Patch>) => keys.forEach((key) => { if (!(key in undo)) undo[key] = draft[key]; });
  const applied: AssistantAction[] = [];
  const skipped: Array<{ action: AssistantAction; reason: string }> = [];
  for (const action of actions) {
    const reason = assistantActionProblem(action, draft, todayKey, deps);
    if (reason) { skipped.push({ action, reason }); continue; }
    if (action.type === "close_account") {
      keep("accounts");
      draft = { ...draft, accounts: (draft.accounts || []).map((account) => (account.id === action.accountId ? { ...account, closedAt: action.closedAt || todayKey } : account)) };
    } else if (action.type === "rename_account") {
      keep("accounts");
      draft = { ...draft, accounts: (draft.accounts || []).map((account) => (account.id === action.accountId ? { ...account, name: action.name.trim() } : account)) };
    } else if (action.type === "merge_holdings_group" || action.type === "rename_holdings_group") {
      keep("goals");
      const assets = assetsOf(draft);
      const groups = deps.groupStockHoldings(assets);
      const sourceId = action.type === "merge_holdings_group" ? action.fromGroupId : action.groupId;
      const target = action.type === "merge_holdings_group" ? groups.find((item) => item.groupId === action.intoGroupId) : undefined;
      const ids = new Set((groups.find((item) => item.groupId === sourceId)?.items || []).map((item) => item.id));
      const next = assets.map((asset) => (ids.has(asset.id) ? (target ? { ...asset, groupId: target.groupId, groupName: target.groupName } : { ...asset, groupName: (action as { name: string }).name.trim() }) : asset));
      const goals = draft.goals as NonNullable<HouseholdState["goals"]>;
      const netWorth = goals.netWorth || { assets: [], liabilities: [] };
      draft = { ...draft, goals: { ...goals, netWorth: { ...netWorth, liabilities: netWorth.liabilities || [], assets: next } } };
    } else {
      keep("transactionCategorizationRules", "transactionCategorizationRuleLabels");
      draft = deps.setPayeeRule(draft, action.payee, action.lineId);
    }
    applied.push(action);
  }
  const patch: Record<string, unknown> = {};
  Object.keys(undo).forEach((key) => { patch[key] = draft[key as keyof HouseholdState]; });
  return { patch: patch as Patch, undo: undo as Patch, applied, skipped };
}
