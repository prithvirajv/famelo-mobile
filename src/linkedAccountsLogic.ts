// Linked accounts (SimpleFIN Bridge bank/card feeds, SnapTrade brokerage positions): the client-side half. The server only fetches and
// normalizes; these pure functions turn a sync payload into Bank stream rows, balance adjustments and holdings, mirroring web's helpers
// in lib/shared-logic.js. Types only are imported - see the logic-file import rule - so the current balance is passed in as a callback.
import type { Account, HouseholdState, InboxDraft, WealthAsset } from "./types";

export const LINKED_IMPORTED_ID_LIMIT = 3000;

export type LinkedMapping = { accountId?: string; groupId?: string; groupName?: string };
export type LinkedLink = { id: string; provider: "simplefin" | "snaptrade"; label: string; status: string; lastSyncAt: string | null; lastError: string; mappings: Record<string, LinkedMapping> };
export type LinkedOverview = { configured: boolean; providers: { simplefin?: boolean; snaptrade?: boolean }; links: LinkedLink[] };
export type RemoteAccount = { remoteId: string; name: string; orgName: string; currency: string; balance: number | null; balanceDate: string };
export type LinkedTransaction = { externalId: string; remoteAccountId: string; date: string; payee: string; amount: number; pending: boolean };
export type LinkedPosition = { remoteAccountId: string; symbol: string; name: string; units: number; price: number; costBasis: number; currency: string; holdingType: "stock" | "fund" };
export type SyncPayload = { provider: "simplefin" | "snaptrade"; accounts: RemoteAccount[]; transactions?: LinkedTransaction[]; positions?: LinkedPosition[]; cash?: Record<string, number>; errors: string[] };

export function linkedStatusText(link: LinkedLink, formatTime: (iso: string) => string): string {
  if (link.status === "needs_reconnect") return "Needs reconnecting - remove it and link again";
  const when = link.lastSyncAt ? `Last synced ${formatTime(link.lastSyncAt)}` : "Not synced yet";
  return link.lastError ? `${when} - ${link.lastError}` : when;
}

// Whether opening the screen should quietly refresh this link: it has accounts chosen and has not synced for six hours.
export function linkNeedsAutoSync(link: LinkedLink, now: number = Date.now()): boolean {
  return link.status === "active" && Object.keys(link.mappings || {}).length > 0 && (!link.lastSyncAt || now - new Date(link.lastSyncAt).getTime() > 6 * 3600 * 1000);
}

// Splits a sync's transactions into ones to import (mapped to a local account, never imported before) and counts of what was skipped.
export function selectNewLinkedTransactions(transactions: LinkedTransaction[], mappings: Record<string, LinkedMapping>, knownIds: Iterable<string>): { fresh: Array<LinkedTransaction & { accountId: string }>; unmapped: number; alreadyImported: number } {
  const known = new Set(knownIds);
  const fresh: Array<LinkedTransaction & { accountId: string }> = [];
  let unmapped = 0;
  let alreadyImported = 0;
  for (const transaction of transactions || []) {
    const accountId = mappings?.[transaction.remoteAccountId]?.accountId;
    if (!accountId) { unmapped += 1; continue; }
    if (known.has(transaction.externalId)) { alreadyImported += 1; continue; }
    known.add(transaction.externalId);
    fresh.push({ ...transaction, accountId });
  }
  return { fresh, unmapped, alreadyImported };
}

// The imported-id memory is capped (oldest dropped) so household state stays well inside the server's 1 MB save limit.
export function rememberLinkedImportedIds(existingIds: string[] | undefined, newIds: string[]): string[] {
  const existing = existingIds || [];
  const merged = [...existing, ...newIds.filter((id) => !existing.includes(id))];
  return merged.length > LINKED_IMPORTED_ID_LIMIT ? merged.slice(merged.length - LINKED_IMPORTED_ID_LIMIT) : merged;
}

export function knownLinkedIds(state: Pick<HouseholdState, "linkedImportedIds" | "transactions" | "transactionInboxDrafts">): string[] {
  return [...(state.linkedImportedIds || []), ...state.transactions.map((t) => t.externalId).filter((id): id is string => Boolean(id)), ...(state.transactionInboxDrafts || []).map((d) => d.externalId).filter((id): id is string => Boolean(id))];
}

// Rows still waiting in Bank stream count toward an account's balance (accepting one later changes nothing). A card tracks the amount owed.
export function pendingDraftEffect(account: Pick<Account, "id" | "type">, drafts: InboxDraft[] | undefined): number {
  const total = (drafts || []).filter((draft) => draft.accountId === account.id).reduce((sum, draft) => sum + Number(draft.amount || 0), 0);
  return account.type === "credit_card" ? total : -total;
}

// Brings an account's balance in line with the bank's by adjusting its opening balance. bankBalance follows SimpleFIN's sign (a card you
// owe money on is negative); for a card the app tracks the amount owed as a positive number.
export function reconcileOpeningBalance(account: Pick<Account, "type" | "openingBalance">, currentBalance: number, bankBalance: number): number {
  const target = account.type === "credit_card" ? -Number(bankBalance) : Number(bankBalance);
  if (!Number.isFinite(target) || !Number.isFinite(Number(currentBalance))) return Number(account.openingBalance || 0);
  return Math.round((Number(account.openingBalance || 0) + (target - Number(currentBalance))) * 100) / 100;
}

// Reconciles every mapped account to the balances in a sync payload; currentBalanceOf must return the account's derived balance now.
export function reconcileMappedBalances(state: HouseholdState, mappings: Record<string, LinkedMapping>, remote: RemoteAccount[], currentBalanceOf: (state: HouseholdState, accountId: string) => number): { state: HouseholdState; updated: number } {
  let updated = 0;
  const accounts = (state.accounts || []).map((account) => {
    const entry = remote.find((item) => mappings[item.remoteId]?.accountId === account.id);
    if (!entry || entry.balance === null) return account;
    const current = currentBalanceOf(state, account.id) + pendingDraftEffect(account, state.transactionInboxDrafts);
    const opening = reconcileOpeningBalance(account, current, entry.balance);
    if (opening === Number(account.openingBalance || 0)) return account;
    updated += 1;
    return { ...account, openingBalance: opening };
  });
  return { state: updated ? { ...state, accounts } : state, updated };
}

export function assetValueOf(asset: WealthAsset): number {
  if ((asset.assetClass === "stock" || asset.assetClass === "retirement") && Number(asset.shares || 0) > 0) return Math.max(0, Number(asset.shares)) * Math.max(0, Number(asset.price || 0));
  return Math.max(0, Number(asset.value || 0));
}

// Merges brokerage positions into net-worth assets. Holdings this link created carry linkedTo = "<linkId>:<remoteAccountId>" so a later sync
// updates them in place and removes the ones that were sold; a hand-entered holding with the same symbol in the target group is adopted.
export function mergeBrokeragePositions(assets: WealthAsset[], input: { linkId: string; positions: LinkedPosition[]; cash: Record<string, number>; accounts: RemoteAccount[]; mappings: Record<string, LinkedMapping> }, createId: (seed: string) => string): { assets: WealthAsset[]; added: number; updated: number; removed: number } {
  let next = [...assets];
  let added = 0; let updated = 0; let removed = 0;
  for (const remoteId of Object.keys(input.mappings || {})) {
    const account = input.accounts.find((item) => item.remoteId === remoteId);
    const mapping = input.mappings[remoteId] || {};
    const linkedTo = `${input.linkId}:${remoteId}`;
    const groupId = mapping.groupId || `linked-${input.linkId}-${remoteId}`;
    const groupName = mapping.groupName || next.find((asset) => asset.groupId === groupId)?.groupName || account?.name || "Brokerage";
    const seen = new Set<string>();
    for (const position of input.positions.filter((item) => item.remoteAccountId === remoteId)) {
      const symbol = position.symbol.toUpperCase();
      seen.add(symbol);
      const index = next.findIndex((asset) => (asset.linkedTo === linkedTo || (!asset.linkedTo && asset.groupId === groupId)) && String(asset.symbol || "").toUpperCase() === symbol);
      const fields = { symbol, shares: position.units, price: position.price, costBasis: position.costBasis, holdingType: position.holdingType, groupId, groupName, linkedTo };
      if (index >= 0) {
        const merged: WealthAsset = { ...(next[index] as WealthAsset), ...fields };
        merged.value = assetValueOf(merged);
        next = next.map((asset, i) => (i === index ? merged : asset));
        updated += 1;
      } else {
        const asset: WealthAsset = { id: createId(symbol), name: position.name || symbol, assetClass: "stock", value: 0, ...fields };
        asset.value = assetValueOf(asset);
        next.push(asset);
        added += 1;
      }
    }
    const before = next.length;
    next = next.filter((asset) => !(asset.linkedTo === linkedTo && asset.assetClass !== "cash" && !seen.has(String(asset.symbol || "").toUpperCase())));
    removed += before - next.length;
    const cashAmount = Number(input.cash?.[remoteId] || 0);
    const cashIndex = next.findIndex((asset) => asset.linkedTo === `${linkedTo}:cash`);
    if (cashIndex >= 0) next = next.map((asset, i) => (i === cashIndex ? { ...asset, value: cashAmount, name: `${groupName} cash` } : asset));
    else if (cashAmount > 0.004) next.push({ id: createId(`${groupName}-cash`), name: `${groupName} cash`, assetClass: "cash", value: cashAmount, linkedTo: `${linkedTo}:cash` });
  }
  return { assets: next, added, updated, removed };
}

export function simplefinSummary(label: string, imported: number, balancesUpdated: number, pendingSkipped: number, unmapped: number, errors: string[]): string {
  let text = `${label}: ${imported} new transaction${imported === 1 ? "" : "s"} sent to Bank stream${balancesUpdated ? `, ${balancesUpdated} balance${balancesUpdated === 1 ? "" : "s"} updated` : ""}${pendingSkipped ? `; ${pendingSkipped} pending skipped until they post` : ""}${unmapped ? `; ${unmapped} from accounts you chose not to import` : ""}.`;
  if (errors.length) text += ` The bank reported: ${errors.join("; ")}`;
  return text;
}
