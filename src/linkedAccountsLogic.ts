// Linked accounts (SimpleFIN Bridge bank/card feeds, SnapTrade brokerage positions): the client-side half. The server only fetches and
// normalizes; these pure functions turn a sync payload into Bank stream rows, balance adjustments and holdings, mirroring web's helpers
// in lib/shared-logic.js. Types only are imported - see the logic-file import rule - so the current balance is passed in as a callback.
import type { Account, Debt, HouseholdState, InboxDraft, WealthAsset, WealthLiability } from "./types";

export const LINKED_IMPORTED_ID_LIMIT = 3000;

export type LinkedMapping = { accountId?: string; groupId?: string; groupName?: string; debtId?: string; skipped?: boolean };
export type LinkedLink = { id: string; provider: "simplefin" | "snaptrade"; label: string; status: string; lastSyncAt: string | null; lastError: string; mappings: Record<string, LinkedMapping>; newAccounts?: Array<{ remoteId: string; name: string; orgName: string }>; stagedCount?: number; hasStaged?: boolean; lastRun?: LinkedRun };
// What the last overnight run did for a link: loaded (applied), waiting for a person, or failed with a reason.
export type LinkedRun = { at?: string; ok?: boolean; stage?: string; error?: string; reason?: string; imported?: number; added?: number; left?: number; newRows?: number };
export type LinkedOverview = { configured: boolean; providers: { simplefin?: boolean; snaptrade?: boolean }; links: LinkedLink[] };
export type RemoteAccount = { remoteId: string; name: string; orgName: string; currency: string; balance: number | null; balanceDate: string; transactionCount?: number; oldestTransactionDate?: string };
// A bank that returned only part of the history a history import asked for: the server leaves those whole months out (trimPartialHistory).
export type HistoryGap = { remoteId: string; name: string; fromMonth: string; toMonth: string; oldestReturned: string; skippedRows: number };
export type LinkedTransaction = { externalId: string; remoteAccountId: string; date: string; payee: string; amount: number; pending: boolean };
export type LinkedPosition = { remoteAccountId: string; symbol: string; name: string; units: number; price: number; costBasis: number; currency: string; holdingType: "stock" | "fund" };
export type SyncPayload = { provider: "simplefin" | "snaptrade"; stagedAt?: string; accounts: RemoteAccount[]; transactions?: LinkedTransaction[]; positions?: LinkedPosition[]; cash?: Record<string, number>; errors: string[]; historyGaps?: HistoryGap[]; coverage?: Record<string, { from: string }> };

// The one-line notice for accounts a link has reported that the user has not decided about yet ('' when there are none).
export function newAccountsNotice(link: Pick<LinkedLink, "newAccounts">): string {
  const accounts = link.newAccounts || [];
  if (!accounts.length) return "";
  return `${accounts.length} new account${accounts.length === 1 ? "" : "s"} found (${accounts.map((account) => account.name).join(", ")}) - choose where ${accounts.length === 1 ? "it goes" : "they go"}.`;
}

// A remote account the user has made no decision about (no mapping entry at all; a deliberate skip is stored as { skipped: true }).
export function isNewRemoteAccount(mappings: Record<string, LinkedMapping>, remoteId: string): boolean {
  return !Object.prototype.hasOwnProperty.call(mappings || {}, remoteId);
}

// What the last overnight run did for a link, in words ('' before it has run).
export function linkedRunSummary(link: Pick<LinkedLink, "lastRun">, formatTime: (iso: string) => string): string {
  const run = link.lastRun;
  if (!run?.at) return "";
  const time = formatTime(run.at);
  if (run.ok === false) return `Overnight sync ${time} did not finish: ${run.error || "unknown problem"}`;
  if (run.stage === "waiting") return `Overnight sync ${time}: ${run.reason || "new transactions are waiting for you to open the app."}`;
  if (run.stage === "applied") return `Overnight sync ${time}: complete - ${run.imported || 0} new from the bank, ${run.added || 0} added to the ledger${run.left ? `, ${run.left} need a look` : ""}.`;
  return `Overnight sync ${time}: fetched${run.newRows ? ` ${run.newRows} new` : ""} - not loaded yet.`;
}

export function linkedStatusText(link: LinkedLink, formatTime: (iso: string) => string): string {
  if (link.status === "needs_reconnect") return "Needs reconnecting - remove it and link again";
  const when = link.lastSyncAt ? `Last synced ${formatTime(link.lastSyncAt)}` : "Not synced yet";
  const base = link.lastError ? `${when} - ${link.lastError}` : when;
  const run = linkedRunSummary(link, formatTime);
  return run ? `${base} · ${run}` : base;
}

// Mirrors web's markAccountsSynced: the date each bank-fed account's data runs through (the bank's own balance date, never in the future, else
// today) and when it was last pulled. Returns the same state object when nothing changed.
export function markAccountsSynced(state: HouseholdState, mappings: Record<string, LinkedMapping>, remote: RemoteAccount[], todayKey: string, nowIso: string): HouseholdState {
  let changed = false;
  const accounts = (state.accounts || []).map((account) => {
    const entry = remote.find((item) => mappings[item.remoteId]?.accountId === account.id);
    if (!entry) return account;
    const reported = /^\d{4}-\d{2}-\d{2}/.test(String(entry.balanceDate || "")) ? String(entry.balanceDate).slice(0, 10) : todayKey;
    const through = reported > todayKey ? todayKey : reported;
    changed = true;
    return { ...account, syncedThrough: through, lastSyncedAt: nowIso };
  });
  return changed ? { ...state, accounts } : state;
}

// The "Bank sync" facts the Home briefing is given (mirrors web's bankSyncFacts): whether each connection's overnight run finished, how far each
// bank-fed account's data runs, and months that were not imported - so the summary can say what is missing and give FYIs.
export function bankSyncFacts(links: LinkedLink[], accounts: HouseholdState["accounts"], gapNotices: HouseholdState["historyGapNotices"], todayKey: string, formatTime: (iso: string) => string, dayLabel: (dateKey: string) => string, monthLabel: (monthKey: string) => string): string[] {
  const fed = (accounts || []).filter((account) => account.syncedFrom || account.syncedThrough);
  if (!links.length && !fed.length) return [];
  const facts = ["Bank sync:"];
  for (const link of links) {
    const run = link.lastRun || {};
    const when = run.at ? formatTime(run.at) : "";
    if (link.status === "needs_reconnect") facts.push(`- Connection "${link.label}" needs signing in again; nothing new can sync until then.`);
    else if (!run.at) facts.push(`- Connection "${link.label}" has not had an overnight run yet.`);
    else if (run.ok === false) facts.push(`- Connection "${link.label}": the overnight run (${when}) did NOT finish - ${run.error || "unknown problem"}.`);
    else if (run.stage === "waiting") facts.push(`- Connection "${link.label}": fetched overnight (${when}) but the new transactions are waiting for the household to open the app.`);
    else if (run.stage === "applied") facts.push(`- Connection "${link.label}": the overnight run (${when}) completed - ${run.imported || 0} new from the bank, ${run.added || 0} added to the ledger${run.left ? `, ${run.left} held for review` : ""}.`);
    else facts.push(`- Connection "${link.label}": fetched overnight (${when}); not loaded yet.`);
  }
  const behind = (() => { const d = new Date(`${todayKey}T00:00:00`); d.setDate(d.getDate() - 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  for (const account of fed.slice(0, 10)) {
    facts.push(`- ${account.name}: bank records ${account.syncedFrom ? `from ${dayLabel(account.syncedFrom)} ` : ""}${account.syncedThrough ? `through ${dayLabel(account.syncedThrough)}${account.syncedThrough < behind ? " (BEHIND - the bank has not reported anything newer)" : ""}` : ""}.`);
  }
  for (const notice of gapNotices || []) {
    const months = notice.fromMonth === notice.toMonth ? monthLabel(notice.fromMonth) : `${monthLabel(notice.fromMonth)} to ${monthLabel(notice.toMonth)}`;
    facts.push(`- NOT imported (the bank did not return it; needs a statement import): ${accounts.find((account) => account.id === notice.accountId)?.name || notice.accountName}, ${months}.`);
  }
  return facts;
}

// Whether opening the screen should quietly refresh this link: it has accounts chosen and either the nightly job has data waiting or it
// has not synced for six hours.
export function linkNeedsAutoSync(link: LinkedLink, now: number = Date.now()): boolean {
  return link.status === "active" && Object.keys(link.mappings || {}).length > 0 && (Boolean(link.hasStaged) || !link.lastSyncAt || now - new Date(link.lastSyncAt).getTime() > 6 * 3600 * 1000);
}

// Splits a sync's transactions into ones to import (mapped to a local account, never imported before) and counts of what was skipped.
export function selectNewLinkedTransactions(transactions: LinkedTransaction[], mappings: Record<string, LinkedMapping>, knownIds: Iterable<string>): { fresh: Array<LinkedTransaction & { accountId: string }>; unmapped: number; alreadyImported: number } {
  const known = new Set(knownIds);
  const fresh: Array<LinkedTransaction & { accountId: string }> = [];
  let unmapped = 0;
  let alreadyImported = 0;
  for (const transaction of transactions || []) {
    const accountId = mappings?.[transaction.remoteAccountId]?.accountId;
    if (!accountId) {
      // An account mapped to a holdings group or a debt has no transactions to import by design; only an account left unmapped counts as skipped.
      if (!mappings?.[transaction.remoteAccountId]?.groupId && !mappings?.[transaction.remoteAccountId]?.debtId) unmapped += 1;
      continue;
    }
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

// includeRemembered=false is for an explicit history import: rows imported before and since removed (Clean up, dismissed) come back, and only
// what is currently in the ledger or waiting in Bank stream is skipped.
export function knownLinkedIds(state: Pick<HouseholdState, "linkedImportedIds" | "transactions" | "transactionInboxDrafts">, includeRemembered = true): string[] {
  return [...(includeRemembered ? state.linkedImportedIds || [] : []), ...state.transactions.map((t) => t.externalId).filter((id): id is string => Boolean(id)), ...(state.transactionInboxDrafts || []).map((d) => d.externalId).filter((id): id is string => Boolean(id))];
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

// Reconciles every mapped account to the balances in a sync payload; currentBalanceOf must return the account's derived balance now. The ledger
// alone is matched to the bank (so the balance shown is the bank's); a Bank stream row posted later hands its amount back through the
// opening balance (acceptDraft in bankStreamLogic), which keeps it there.
export function reconcileMappedBalances(state: HouseholdState, mappings: Record<string, LinkedMapping>, remote: RemoteAccount[], currentBalanceOf: (state: HouseholdState, accountId: string) => number): { state: HouseholdState; updated: number } {
  let updated = 0;
  const accounts = (state.accounts || []).map((account) => {
    const entry = remote.find((item) => mappings[item.remoteId]?.accountId === account.id);
    if (!entry || entry.balance === null) return account;
    const opening = reconcileOpeningBalance(account, currentBalanceOf(state, account.id), entry.balance);
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

// Makes a holdings group's total equal a bank-reported balance (a SimpleFIN investment/retirement account, which reports only a total)
// WITHOUT discarding per-holding detail: the listed holdings keep their own shares and prices, and one "balance adjustment" holding in the
// group carries whatever they don't explain. If the listed holdings already meet or exceed the balance, no adjustment is kept (assets
// can't go negative).
export function applyBalanceToHoldingsGroup(assets: WealthAsset[], input: { linkId: string; remoteId: string; groupId: string; groupName: string; balance: number }, createId: (seed: string) => string): { assets: WealthAsset[]; adjustment: number } {
  const linkedTo = `${input.linkId}:${input.remoteId}:adjust`;
  const inGroup = assets.filter((asset) => asset.groupId === input.groupId && asset.linkedTo !== linkedTo);
  const explained = inGroup.reduce((sum, asset) => sum + assetValueOf(asset), 0);
  const gap = Math.round((Number(input.balance) - explained) * 100) / 100;
  const without = assets.filter((asset) => asset.linkedTo !== linkedTo);
  if (!Number.isFinite(gap) || gap <= 0.004) return { assets: without, adjustment: 0 };
  const existing = assets.find((asset) => asset.linkedTo === linkedTo);
  const adjustment: WealthAsset = {
    ...(existing || { id: createId(`${input.groupName}-balance`), name: "", value: 0 }), name: `${input.groupName} balance adjustment`, assetClass: "stock", symbol: "", shares: 1, price: gap, costBasis: 0,
    holdingType: "fund", groupId: input.groupId, groupName: inGroup[0]?.groupName || input.groupName, linkedTo, value: gap
  };
  return { assets: [...without, adjustment], adjustment: gap };
}

// Brings a debt's remaining balance (and its net-worth liability) in line with a loan balance reported by the bank. SimpleFIN reports what you
// owe as a negative number, but the sign is not guaranteed across institutions, so the amount owed is the absolute value. Payments already in
// the ledger on the debt's linked subcategory are marked applied: the bank's balance already reflects them, and the Ledger auto-EMI pass would
// otherwise subtract them from the new balance a second time.
export function matchDebtToBankBalance(input: { debts: Debt[]; liabilities: WealthLiability[]; transactions: Array<{ lineId: string; date: string; amount: number }> }, target: { debtId: string; balance: number }, signatureOf: (transaction: { date: string; amount: number }) => string): { debts: Debt[]; liabilities: WealthLiability[]; changed: boolean } {
  const debt = input.debts.find((item) => item.id === target.debtId);
  const owed = Math.round(Math.abs(Number(target.balance)) * 100) / 100;
  if (!debt || !Number.isFinite(owed)) return { debts: input.debts, liabilities: input.liabilities, changed: false };
  const signatures = new Set(debt.appliedPaymentSignatures || []);
  if (debt.lineId) input.transactions.filter((transaction) => transaction.lineId === debt.lineId).forEach((transaction) => signatures.add(signatureOf(transaction)));
  const nextDebt: Debt = { ...debt, balance: owed, ...(debt.lineId ? { appliedPaymentSignatures: [...signatures] } : {}) };
  return {
    debts: input.debts.map((item) => (item.id === target.debtId ? nextDebt : item)),
    liabilities: input.liabilities.map((item) => (item.id === target.debtId ? { ...item, value: owed } : item)),
    changed: owed !== Number(debt.balance || 0)
  };
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

export function simplefinSummary(label: string, imported: number, balancesUpdated: number, pendingSkipped: number, unmapped: number, errors: string[], groupsMatched = 0, debtsMatched = 0): string {
  let text = `${label}: ${imported} new transaction${imported === 1 ? "" : "s"} sent to Bank stream${balancesUpdated ? `, ${balancesUpdated} balance${balancesUpdated === 1 ? "" : "s"} updated` : ""}${groupsMatched ? `, ${groupsMatched} investment account${groupsMatched === 1 ? "" : "s"} matched to the bank balance` : ""}${debtsMatched ? `, ${debtsMatched} loan${debtsMatched === 1 ? "" : "s"} matched to the amount owed` : ""}${pendingSkipped ? `; ${pendingSkipped} pending skipped until they post` : ""}${unmapped ? `; ${unmapped} from accounts you chose not to import` : ""}.`;
  if (errors.length) text += ` The bank reported: ${errors.join("; ")}`;
  return text;
}

// The app-level banner: how many bank transactions the nightly job has fetched that no screen has applied yet ('' when none).
export function waitingBanner(links: Array<Pick<LinkedLink, "stagedCount" | "hasStaged" | "status">>): string {
  const waiting = links.filter((link) => link.status === "active" && link.hasStaged).reduce((sum, link) => sum + Number(link.stagedCount || 0), 0);
  if (!waiting) return "";
  return `${waiting} bank transaction${waiting === 1 ? "" : "s"} fetched overnight - tap to review`;
}

// Whether a pull of this many rows still leaves the household inside the server's ~1 MB save limit (a row is roughly 400 bytes saved).
export function historyImportFits(currentStateBytes: number, rowCount: number, softLimitBytes = 900_000): boolean {
  return currentStateBytes + rowCount * 400 <= softLimitBytes;
}

export function isRealDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

// Mirrors web's historyGapDialogText / recordHistoryGapNotices: the months a bank only partly returned are left out whole, the person must
// agree before the rest is imported, and a reminder stays on Home until they mark the statement import done.
export function historyGapMonths(gap: Pick<HistoryGap, "fromMonth" | "toMonth">, monthLabel: (monthKey: string) => string): string {
  return gap.fromMonth === gap.toMonth ? monthLabel(gap.fromMonth) : `${monthLabel(gap.fromMonth)} to ${monthLabel(gap.toMonth)}`;
}

export function historyGapDialogText(gaps: HistoryGap[], nameOf: (remoteId: string) => string, monthLabel: (monthKey: string) => string): string {
  const lines = gaps.map((gap) => `\u2022 ${nameOf(gap.remoteId) || gap.name}: ${historyGapMonths(gap, monthLabel)} will NOT be imported (the bank's rows only start on ${gap.oldestReturned})`);
  return `The bank did not return all the history you asked for.\n\n${lines.join("\n")}\n\nThose whole months are left out on purpose - half a month would make the ledger wrong and double up when you import it yourself. After this, import those months for ${gaps.length === 1 ? "that account" : "those accounts"} from a bank statement (Bank stream, then Import a statement) and pick the account.\n\nImport everything else now?`;
}

export type HistoryGapNotice = { id: string; accountId: string; accountName: string; fromMonth: string; toMonth: string; oldestReturned: string; createdAt: string };

export function addHistoryGapNotices(existing: HistoryGapNotice[] | undefined, gaps: HistoryGap[], mappings: Record<string, LinkedMapping>, nameOf: (localAccountId: string) => string, createId: (prefix: string) => string, nowIso: string): HistoryGapNotice[] {
  const notices = [...(existing || [])];
  for (const gap of gaps) {
    const accountId = mappings[gap.remoteId]?.accountId || "";
    if (notices.some((notice) => notice.accountId === accountId && notice.fromMonth === gap.fromMonth && notice.toMonth === gap.toMonth)) continue;
    notices.push({ id: createId("history-gap"), accountId, accountName: nameOf(accountId) || gap.name, fromMonth: gap.fromMonth, toMonth: gap.toMonth, oldestReturned: gap.oldestReturned, createdAt: nowIso });
  }
  return notices;
}

// Mirrors web's updateAccountsSyncedFrom: the date each bank-fed account's records are complete from (account.syncedFrom), shown as a small tag.
// A sync that knows the coverage (a first sync or history import) supplies it; otherwise an account without one takes its earliest bank row (or
// today). An earlier date is never replaced by a later one. Returns the same state object when nothing changed.
export function updateAccountsSyncedFrom(state: HouseholdState, mappings: Record<string, LinkedMapping>, coverage: Record<string, { from: string }> | undefined, rows: Array<{ externalId?: string; accountId?: string; date?: string }>, todayKey: string): HouseholdState {
  let changed = false;
  const accounts = (state.accounts || []).map((account) => {
    const remoteId = Object.keys(mappings || {}).find((id) => mappings[id]?.accountId === account.id);
    if (!remoteId) return account;
    let from = coverage?.[remoteId]?.from || "";
    if (!from && !account.syncedFrom) {
      const dates = rows.filter((row) => row.externalId && row.accountId === account.id && row.date).map((row) => row.date as string).sort();
      from = dates[0] || todayKey;
    }
    if (!from || (account.syncedFrom && account.syncedFrom <= from)) return account;
    changed = true;
    return { ...account, syncedFrom: from };
  });
  return changed ? { ...state, accounts } : state;
}
