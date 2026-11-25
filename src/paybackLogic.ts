// @ts-nocheck - a direct port of loosely typed web logic; covered by test/payback-logic.test.mjs.
// Ported from the web app's lib/shared-logic.js (repayment linking, statement gaps, bank-sync helpers). Keep in step with it.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const PEER_PAYMENT_PAYEE = /zelle|venmo|cash\s?app|paypal|apple\s?cash|google\s?pay|splitwise/i;

export const PAYBACK_WINDOW_DAYS = 60;

const PAYBACK_NAME_STOP = new Set(["sq", "tst", "pp", "pos", "www", "com", "net", "org", "inc", "llc", "ltd", "corp", "the", "and", "for", "from", "with", "payment", "payments", "pmts", "purchase", "online", "store", "shop", "mktplace", "marketplace", "debit", "credit", "card", "checkcard", "recurring", "autopay", "ach", "web", "bill", "pay", "zelle", "venmo", "paypal", "cash", "app"]);

export function paybackLineOf(charge: any) {
  if (!charge) return "";
  if (Array.isArray(charge.splits) && charge.splits.length) {
    const biggest = charge.splits.filter((part) => part && part.lineId).sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
    return biggest ? biggest.lineId : "";
  }
  return charge.lineId || "";
}


export function paybackSummary(charge: any, transactions: any) {
  const total = Math.round(Math.max(0, Number(charge && charge.amount) || 0) * 100) / 100;
  const rows = charge && charge.id ? (transactions || []).filter((row) => row && row !== charge && row.paidBackFor === charge.id) : [];
  const paid = Math.round(rows.reduce((sum, row) => sum + Math.max(0, -Number(row.amount || 0)), 0) * 100) / 100;
  return { rows, count: rows.length, total, paid, share: Math.round(Math.max(0, total - paid) * 100) / 100, covered: total > 0 && paid >= total - 0.005 };
}


export function paybackChargesFor(deposit: any, transactions: any) {
  if (!deposit || !(Number(deposit.amount) < 0) || !/^\d{4}-\d{2}-\d{2}/.test(String(deposit.date || ""))) return [];
  const day = 86400000;
  const at = Date.parse(`${String(deposit.date).slice(0, 10)}T00:00:00Z`);
  return (transactions || [])
    .filter((row) => {
      if (!row || row === deposit || !(Number(row.amount) > 0) || Number(row.amount) + 0.005 < -Number(deposit.amount)) return false;
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(row.date || ""))) return false;
      const gap = (at - Date.parse(`${String(row.date).slice(0, 10)}T00:00:00Z`)) / day;
      return gap >= -3 && gap <= PAYBACK_WINDOW_DAYS;
    })
    .map((row) => ({ row, sameLine: Boolean(deposit.lineId && paybackLineOf(row) === deposit.lineId), gap: Math.abs((at - Date.parse(`${String(row.date).slice(0, 10)}T00:00:00Z`)) / day) }))
    .sort((a, b) => (a.sameLine !== b.sameLine ? (a.sameLine ? -1 : 1) : a.gap - b.gap))
    .slice(0, 8);
}


export function paybackNameToken(payee: any) {
  const words = String(payee || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.find((word) => word.length >= 3 && /^[a-z]/.test(word) && !PAYBACK_NAME_STOP.has(word)) || "";
}


export function paybackMemoHits(deposit: any, transactions: any) {
  if (!deposit || deposit.paidBackFor || !(Number(deposit.amount) < 0) || !PEER_PAYMENT_PAYEE.test(String(deposit.payee || ""))) return [];
  const note = ` ${String(deposit.payee).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return paybackChargesFor(deposit, transactions).filter(({ row }) => {
    const token = paybackNameToken(row.payee);
    return token && note.includes(` ${token} `);
  }).map(({ row }) => row);
}


export function paybackAutoMatch(deposit: any, transactions: any) {
  if (!deposit || deposit.paybackAutoDeclined) return null;
  // Not a transfer or a micro-deposit, and not a merchant echoing its own charge (a refund of the same purchase is the refund logic's job).
  if (/^\s*transfer\b/i.test(String(deposit.payee || "")) || -Number(deposit.amount) < 1) return null;
  const hits = paybackMemoHits(deposit, transactions);
  if (hits.length !== 1) return null;
  const charge = hits[0];
  // Only a merchant charge is repaid by friends: a Zelle to a person met by a Zelle from the same person is two people settling up, not a split bill.
  if (PEER_PAYMENT_PAYEE.test(String(charge.payee || ""))) return null;
  const words = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const echo = words(charge.payee).slice(0, 14);
  if (echo.length >= 6 && words(deposit.payee).includes(echo)) return null;
  if (!paybackLineOf(charge)) return null;
  const left = Number(charge.amount) - paybackSummary(charge, transactions).paid;
  return -Number(deposit.amount) <= left + 0.005 ? charge : null;
}


export function foundRepayments(transactions: any, todayKey: any, days = 270) {
  const list = transactions || [];
  const cutoff = Date.parse(`${String(todayKey).slice(0, 10)}T00:00:00Z`) - days * 86400000;
  const groups = new Map();
  list.filter((row) => row && Number(row.amount) < 0 && !row.paidBackFor && !row.paybackAutoDeclined && Date.parse(`${String(row.date || "").slice(0, 10)}T00:00:00Z`) >= cutoff)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((row) => {
      const charge = paybackAutoMatch(row, list);
      if (!charge) return;
      const group = groups.get(charge) || { charge, rows: [], total: 0 };
      const left = Number(charge.amount) - paybackSummary(charge, list).paid - group.total;
      if (-Number(row.amount) > left + 0.005) return;
      group.rows.push(row);
      group.total = Math.round((group.total - Number(row.amount)) * 100) / 100;
      groups.set(charge, group);
    });
  return [...groups.values()].map((group) => ({ ...group, share: Math.round((Number(group.charge.amount) - paybackSummary(group.charge, list).paid - group.total) * 100) / 100 }));
}


export function applyPayback(charge: any, deposits: any) {
  const lineId = paybackLineOf(charge);
  if (!charge) return { ok: false, error: "That charge is no longer in the ledger.", linked: 0 };
  if (!lineId) return { ok: false, error: "Choose a subcategory for the charge first, so the repayments know which budget line to reduce.", linked: 0 };
  charge.id ||= `tx-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  let linked = 0;
  (deposits || []).forEach((row) => {
    if (!row || row === charge || row.paidBackFor || !(Number(row.amount) < 0)) return;
    row.paidBackPrev = { lineId: row.lineId || "", lineSource: row.lineSource || "", splits: Array.isArray(row.splits) && row.splits.length ? row.splits : null };
    row.paidBackFor = charge.id;
    row.lineId = lineId;
    row.lineSource = "payback";
    delete row.splits;
    linked += 1;
  });
  return { ok: true, error: "", linked };
}


export function removePayback(row: any) {
  if (!row || !row.paidBackFor) return false;
  const prev = row.paidBackPrev || {};
  row.lineId = prev.lineId || "";
  if (prev.lineSource) row.lineSource = prev.lineSource; else delete row.lineSource;
  if (prev.splits) row.splits = prev.splits;
  delete row.paidBackFor;
  delete row.paidBackPrev;
  delete row.paidBackAuto;
  return true;
}


const STATEMENT_GAP_TYPES = ["checking", "savings", "credit_card"];

const STATEMENT_GAP_MIN_ROWS = 5;

const STATEMENT_GAP_MAX_MONTHS = 12;

export function statementGaps({ accounts, transactions, drafts, notices, ignored, today }) {
  const monthOf = (value) => String(value || "").slice(0, 7);
  const thisMonth = monthOf(today);
  if (!/^\d{4}-\d{2}$/.test(thisMonth)) return [];
  const step = (key, by) => { const [year, month] = key.split("-").map(Number); const at = year * 12 + (month - 1) + by; return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`; };
  const rows = [...(transactions || []), ...(drafts || [])].filter((row) => row && /^\d{4}-\d{2}/.test(String(row.date || "")));
  if (!rows.length) return [];
  const last = step(thisMonth, -1);
  const earliest = rows.reduce((min, row) => (monthOf(row.date) < min ? monthOf(row.date) : min), thisMonth);
  const first = earliest > step(last, -(STATEMENT_GAP_MAX_MONTHS - 1)) ? earliest : step(last, -(STATEMENT_GAP_MAX_MONTHS - 1));
  if (first > last) return [];
  const window = [];
  for (let key = first; key <= last; key = step(key, 1)) window.push(key);
  const skip = new Set(ignored || []);
  return (accounts || []).filter((account) => account && !account.closedAt && STATEMENT_GAP_TYPES.includes(account.type)).map((account) => {
    const own = rows.filter((row) => row.accountId === account.id);
    if (own.length < STATEMENT_GAP_MIN_ROWS) return null;
    const seen = new Set(own.map((row) => monthOf(row.date)));
    // Only months between the account's own first and last record: before it a card may simply not have existed yet, and after it the account may be unused.
    // (A bank that did not return early history raises its own notice, which is why leading gaps are not guessed at here.)
    const ownFirst = [...seen].sort()[0];
    const ownLast = [...seen].sort().pop();
    const named = new Set();
    (notices || []).filter((notice) => notice && notice.accountId === account.id && notice.fromMonth && notice.toMonth).forEach((notice) => {
      for (let key = notice.fromMonth, guard = 0; key <= notice.toMonth && guard < 240; key = step(key, 1), guard += 1) named.add(key);
    });
    const months = window.filter((key) => key > ownFirst && key < ownLast && !seen.has(key) && !named.has(key) && !skip.has(`${account.id}|${key}`));
    return months.length ? { accountId: account.id, accountName: account.name || "Account", months } : null;
  }).filter(Boolean);
}


export function monthRunsLabel(months: any) {
  const list = [...new Set(months || [])].filter((key) => /^\d{4}-\d{2}$/.test(key)).sort();
  const name = (key) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(key.slice(5)) - 1];
  const index = (key) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5)) - 1;
  const groups = [];
  list.forEach((key) => {
    const year = key.slice(0, 4);
    let group = groups[groups.length - 1];
    if (!group || group.year !== year) { group = { year, runs: [] }; groups.push(group); }
    const run = group.runs[group.runs.length - 1];
    if (run && index(key) === index(run.to) + 1) run.to = key; else group.runs.push({ from: key, to: key });
  });
  return groups.map((group) => `${group.runs.map((run) => (run.from === run.to ? name(run.from) : `${name(run.from)}–${name(run.to)}`)).join(", ")} ${group.year}`).join("; ");
}


export function stuckPendingAccounts(accounts: any, todayKey: any, days = 3) {
  const cutoff = Date.parse(`${String(todayKey).slice(0, 10)}T00:00:00Z`) - days * 86400000;
  return (accounts || []).filter((account) => account && !account.closedAt && Array.isArray(account.pendingRows) && account.pendingRows.length).map((account) => {
    const dates = account.pendingRows.map((row) => String(row.date || "").slice(0, 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
    const old = dates.filter((date) => Date.parse(`${date}T00:00:00Z`) <= cutoff);
    return old.length ? { accountId: account.id, name: account.name || "Account", count: old.length, oldest: old[0] } : null;
  }).filter(Boolean);
}


export function bankSyncOkText(links: any, pending: any, when: any) {
  const active = (links || []).filter((link) => link.status === "active" && Object.keys(link.mappings || {}).length);
  if (!active.length) return "";
  const healthy = active.every((link) => link.lastRun && link.lastRun.ok !== false && link.lastRun.stage === "applied");
  if (!healthy) return "";
  const latest = active.map((link) => link.lastRun).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  const imported = active.reduce((sum, link) => sum + Number(link.lastRun.added || 0), 0);
  return `Bank sync: last ran ${when(latest.at)}, ${imported ? `${imported} new transaction${imported === 1 ? "" : "s"} added` : "nothing new"}, all loaded${pending ? `; ${pending} still pending at the bank` : ""}.`;
}


const SIZE_LABELS = {
  transactions: ["Transactions", "Transactions > Clean up removes rows before a date, saving a backup file first."],
  transactionInboxDrafts: ["Bank stream rows waiting", "Review or dismiss the rows waiting in Bank stream."],
  transactionInboxDone: ["Bank stream history", ""],
  budgetHistory: ["Budget history", ""],
  linkedImportedIds: ["Bank import memory", ""],
  household: ["Household settings and activity", ""],
  calendar: ["Calendar", ""],
  notes: ["Notes", "Delete notes and photos you no longer need."],
  meals: ["Meals and recipes", "Delete recipes you no longer use."],
  goals: ["Goals and net worth", ""],
  transfers: ["Transfers", ""],
  paycheckOccurrences: ["Paychecks", ""],
  decisions: ["Decisions", "Delete old decisions and their attachments."],
  documents: ["Documents", ""]
};

export function householdSizeBreakdown(state: any) {
  const entries = Object.entries(state || {}).map(([key, value]) => ({ key, bytes: JSON.stringify(value === undefined ? null : value).length }));
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0) || 1;
  return entries.sort((a, b) => b.bytes - a.bytes).map((entry) => ({ key: entry.key, label: (SIZE_LABELS[entry.key] || [entry.key])[0], bytes: entry.bytes, pct: Math.round((entry.bytes / total) * 100), hint: (SIZE_LABELS[entry.key] || ["", ""])[1] })).filter((entry) => entry.pct >= 3).slice(0, 6);
}

