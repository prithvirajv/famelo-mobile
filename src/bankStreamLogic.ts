// Bank Stream: importing a bank/credit-card statement into an inbox of unreviewed rows, spotting duplicates,
// refunds and account-to-account transfers among them, suggesting a category and account from the household's own
// history, and accepting/dismissing/moving them into the ledger. Ported from web's lib/shared-logic.js
// (parseBankCsvTransactions, isDuplicateTransaction, findTransferCandidate, refundMatch, suggest*FromHistory, ...)
// and the handlers in app.js, kept behaviorally identical on purpose - see each function's comment for the real-world
// bug it exists to avoid, carried over from web. Amount convention everywhere: positive = money out (a purchase),
// negative = money in (refund/deposit), regardless of account type.
//
// Self-contained on purpose: logic files cannot import each other's values (see the repo notes), so the few small
// helpers it shares with other logic files (CSV splitting, closed-account rule, line snapshots) are repeated here.
import type { Account, HouseholdState, InboxDraft, Iou, IouDirection, Transaction } from "./types";

// ---- small shared helpers (repeated copies, see header) ----------------------------------------------------------
function parseDateKey(value: string): Date {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}
function absoluteDaysBetweenDateKeys(left: string, right: string): number {
  return Math.abs(parseDateKey(left).getTime() - parseDateKey(right).getTime()) / (24 * 60 * 60 * 1000);
}
function accountAllowsDate(account: Account | undefined, date: string): boolean {
  return !account?.closedAt || date <= account.closedAt;
}
function lineSnapshot(state: Pick<HouseholdState, "budget">, lineId: string): { categoryName: string; subcategoryName: string } {
  for (const category of state.budget.categories) {
    const line = category.lines.find((item) => item.id === lineId);
    if (line) return { categoryName: category.name, subcategoryName: line.name };
  }
  if (!lineId) return { categoryName: "", subcategoryName: "" };
  return { categoryName: "Deleted category", subcategoryName: lineId || "Deleted subcategory" };
}

// A lenient character-by-character CSV parser: a quote closes a field only when immediately followed by a comma,
// newline or end of input, so an unescaped literal quote inside a quoted field (real bank memos have them) survives.
export function parseDelimitedText(text: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = String(text || "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        const next = source[i + 1];
        if (next === '"') { field += '"'; i += 1; }
        else if (next === "," || next === "\n" || next === "\r" || next === undefined) inQuotes = false;
        else field += '"';
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") inQuotes = true;
    else if (char === ",") { fields.push(field); field = ""; }
    else if (char === "\r") { /* skipped - \n ends the row */ }
    else if (char === "\n") { fields.push(field); rows.push(fields); fields = []; field = ""; }
    else field += char;
  }
  if (field !== "" || fields.length) { fields.push(field); rows.push(fields); }
  return rows;
}

// ---- CSV import ---------------------------------------------------------------------------------------------------
export type ParsedBankRow = { date: string; payee: string; amount: number; isDeposit?: boolean; isPayment?: boolean; isPending?: boolean; orderNumber?: string; externalId?: string };

function parseCsvAmount(value: unknown): number {
  const cleaned = String(value ?? "").replace(/[,$]/g, "").trim();
  if (!cleaned) return NaN;
  return Number(cleaned);
}

// MM/DD/YYYY (the common US bank format) or an already-ISO YYYY-MM-DD; anything else is unparseable. Unlike web's
// version this also rejects a date that doesn't exist (13/45/2026, 2026-02-30): a bank file is untrusted input, and an
// impossible date stored on a transaction silently breaks every date comparison downstream (duplicate and refund
// windows, closed-account checks, month totals).
export function normalizeCsvDate(value: unknown): string {
  const trimmed = String(value || "").trim();
  let year = 0;
  let month = 0;
  let day = 0;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else if (us) { month = Number(us[1]); day = Number(us[2]); year = Number(us[3]); }
  else return "";
  const real = new Date(year, month - 1, day);
  if (real.getFullYear() !== year || real.getMonth() !== month - 1 || real.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Real header text from real issuers' exports: "Posting Date" (Chase), "Post Date"/"Trans. Date" (Discover).
const CSV_DATE_HEADERS = ["date", "transaction date", "posted date", "trans date", "posting date", "post date", "trans. date"];
const CSV_PAYEE_HEADERS = ["description", "payee", "merchant", "name"];
const CSV_AMOUNT_HEADERS = ["amount"];
const CSV_DEBIT_HEADERS = ["debit"];
const CSV_CREDIT_HEADERS = ["credit"];
// DCU and other credit unions: a signed Amount plus a "Transaction Type" column holding the literal DEBIT/CREDIT per
// row - authoritative for which way the money moved, so it beats any guess from sign counts or payee text.
const CSV_TRANSACTION_TYPE_HEADERS = ["transaction type"];

// A credit-card statement's own payoff ("AUTOMATIC PAYMENT - THANK YOU") is money moving from a bank account to pay
// the card down - not a purchase or a refund. It belongs in a transfer, so it is flagged rather than dropped.
export const STATEMENT_PAYMENT_DESCRIPTION = /payment.*thank you|automatic payment|online payment|electronic payment|internet payment|autopay|auto-pmt/i;

// Wells Fargo's plain CSV has no header row at all: "date","amount","*","","description" per line, recognized by
// structure (every row has 5 fields, the first two a date and a number).
function parseHeaderlessWellsFargoCsv(rows: string[][]): ParsedBankRow[] {
  const looksRight = rows.length > 0 && rows.every((row) => row.length === 5 && normalizeCsvDate(row[0]) && Number.isFinite(parseCsvAmount(row[1])));
  if (!looksRight) return [];
  const results: ParsedBankRow[] = [];
  rows.forEach((row) => {
    const date = normalizeCsvDate(row[0]);
    const payee = String(row[4] || "").trim();
    const signed = parseCsvAmount(row[1]);
    if (!date || !payee || !Number.isFinite(signed) || signed === 0) return;
    if (signed < 0) results.push({ date, payee, amount: Math.abs(signed) });
    else results.push({ date, payee, amount: -signed, isDeposit: true });
  });
  return results;
}

// Exports vary in two ways this handles. (1) Some bury the transaction table under a summary block, so this scans for
// the first row that looks like a header instead of assuming row 0. (2) A single signed Amount column means opposite
// things by account type: a checking export is money-out-negative, a credit-card export money-out-positive. That is
// detected per file from the data itself (an explicit Transaction Type column wins; else a payment-looking negative row,
// else more positive rows than negative) so no per-account setting is needed.
export function parseBankCsvTransactions(text: string): ParsedBankRow[] {
  const rows = parseDelimitedText(text).filter((row) => row.some((cell) => String(cell || "").trim() !== ""));
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map((cell) => String(cell || "").trim().toLowerCase());
    return cells.some((cell) => CSV_DATE_HEADERS.includes(cell)) && cells.some((cell) => CSV_PAYEE_HEADERS.includes(cell))
      && cells.some((cell) => CSV_AMOUNT_HEADERS.includes(cell) || CSV_DEBIT_HEADERS.includes(cell));
  });
  if (headerIndex === -1) return parseHeaderlessWellsFargoCsv(rows);
  const header = (rows[headerIndex] as string[]).map((cell) => String(cell || "").trim().toLowerCase());
  const indexIn = (names: string[]) => header.findIndex((cell) => names.includes(cell));
  const dateIndex = indexIn(CSV_DATE_HEADERS);
  const payeeIndex = indexIn(CSV_PAYEE_HEADERS);
  const amountIndex = indexIn(CSV_AMOUNT_HEADERS);
  const debitIndex = indexIn(CSV_DEBIT_HEADERS);
  const creditIndex = indexIn(CSV_CREDIT_HEADERS);
  const typeIndex = indexIn(CSV_TRANSACTION_TYPE_HEADERS);
  const dataRows = rows.slice(headerIndex + 1);
  const cell = (row: string[], index: number) => (index === -1 ? "" : row[index] ?? "");

  let isCreditCardStyle = false;
  // The explicit per-row type label is authoritative, so the guess is skipped whenever that column exists (a checking
  // account's own "CITI AUTOPAY" withdrawal looks like a card payoff and used to flip a whole file to the wrong sign).
  if (debitIndex === -1 && typeIndex === -1 && amountIndex !== -1) {
    const signedAmounts = dataRows.map((row) => parseCsvAmount(cell(row, amountIndex))).filter(Number.isFinite);
    const positiveCount = signedAmounts.filter((value) => value > 0).length;
    const negativeCount = signedAmounts.filter((value) => value < 0).length;
    // A "...PAYMENT, THANK YOU" negative row is a strong signal on its own regardless of volume - a checking account
    // never describes its own deposits that way - so a small mixed file isn't misread by the volume tiebreak.
    const hasPaymentSignal = dataRows.some((row) => {
      const value = parseCsvAmount(cell(row, amountIndex));
      return Number.isFinite(value) && value < 0 && STATEMENT_PAYMENT_DESCRIPTION.test(cell(row, payeeIndex));
    });
    isCreditCardStyle = hasPaymentSignal || (positiveCount > negativeCount && positiveCount > 0);
  }

  const results: ParsedBankRow[] = [];
  dataRows.forEach((row) => {
    const date = normalizeCsvDate(cell(row, dateIndex));
    const payee = String(cell(row, payeeIndex)).trim();
    let amount = NaN;
    let isDeposit = false;
    let isPayment = false;
    if (typeIndex !== -1) {
      const label = String(cell(row, typeIndex)).trim().toLowerCase();
      const magnitude = Math.abs(parseCsvAmount(cell(row, amountIndex)));
      if (Number.isFinite(magnitude) && magnitude !== 0 && (label === "debit" || label === "credit")) {
        if (label === "debit") amount = magnitude;
        else { amount = -magnitude; if (STATEMENT_PAYMENT_DESCRIPTION.test(payee)) isPayment = true; else isDeposit = true; }
      }
    } else if (debitIndex !== -1) {
      const debit = parseCsvAmount(cell(row, debitIndex));
      if (Number.isFinite(debit) && debit > 0) amount = debit;
      else if (creditIndex !== -1) {
        // A Credit row is an autopay/card payment or real money in - both kept (never silently dropped, a household still
        // has to reconcile a payoff) and flagged differently. Some exports store Credit as negative, others as a positive
        // magnitude; both normalize to negative, this parser's convention for money coming back.
        const credit = parseCsvAmount(cell(row, creditIndex));
        if (Number.isFinite(credit) && credit !== 0) { amount = -Math.abs(credit); if (STATEMENT_PAYMENT_DESCRIPTION.test(payee)) isPayment = true; else isDeposit = true; }
      }
    } else if (amountIndex !== -1) {
      const signed = parseCsvAmount(cell(row, amountIndex));
      if (!Number.isFinite(signed) || signed === 0) amount = NaN;
      else if (isCreditCardStyle) { amount = signed; isPayment = STATEMENT_PAYMENT_DESCRIPTION.test(payee); }
      else if (signed < 0) amount = Math.abs(signed);
      else { amount = -signed; isDeposit = true; }
    }
    if (date && payee && Number.isFinite(amount) && amount !== 0) {
      results.push({ date, payee, amount, ...(isDeposit ? { isDeposit: true } : {}), ...(isPayment ? { isPayment: true } : {}) });
    }
  });
  return results;
}

// ---- Matching -----------------------------------------------------------------------------------------------------
type Matchable = { id?: string; externalId?: string; payee?: string; amount?: number | string; date?: string; accountId?: string; lineId?: string; orderNumber?: string };

export function normalizeForAccountMatch(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Matches text hints (a filename, a label read from the file's own content) to an account by name, so
// "Costco Citi Jul 142026.CSV" lands on an account named "Costco Citi". Each hint is normalized and may either contain or
// be contained by an account's normalized name; hints are tried in order and the first match wins.
export function matchAccountByHints(hints: Array<string | undefined>, accounts: Account[]): Account | null {
  for (const hint of hints) {
    const normalized = normalizeForAccountMatch(String(hint || "").replace(/\.[^.]+$/, ""));
    if (!normalized) continue;
    const match = accounts.find((account) => {
      const accountNormalized = normalizeForAccountMatch(account.name);
      return accountNormalized && (normalized.includes(accountNormalized) || accountNormalized.includes(normalized));
    });
    if (match) return match;
  }
  return null;
}

const DUPLICATE_TOLERANCE_DAYS = 2;

// A CSV re-imported over an overlapping range reproduces the same amount with the date drifting a day or two (a pending
// charge posts later). Payee text is deliberately not compared: a CSV payee is the bank's raw description while the same
// charge in the ledger may carry a short hand-typed name.
// Two linked-bank rows each carry the bank's own transaction id: the same id is the same transaction, two different ids are two real
// transactions, so the amount-and-date guess only applies when at least one side has no bank id (a hand-entered row or a file).
export function isDuplicateTransaction(candidate: Matchable, existing: Matchable[]): boolean {
  const amount = Number(candidate.amount);
  return existing.some((other) => {
    if (candidate.externalId && other.externalId) return candidate.externalId === other.externalId;
    return Number(other.amount) === amount && absoluteDaysBetweenDateKeys(other.date || "", candidate.date || "") <= DUPLICATE_TOLERANCE_DAYS;
  });
}

// The other side of an account-to-account transfer (checking's "-500 Payment to Card" and the card's "+500 Payment
// Received"): the OPPOSITE amount on a DIFFERENT account within the same short window.
export function findTransferCandidate<T extends Matchable>(candidate: Matchable, others: T[]): T | null {
  if (!candidate.accountId) return null;
  const amount = Number(candidate.amount);
  return others.find((other) => other.accountId && other.accountId !== candidate.accountId && Number(other.amount) === -amount
    && absoluteDaysBetweenDateKeys(other.date || "", candidate.date || "") <= DUPLICATE_TOLERANCE_DAYS) || null;
}

export function normalizeForPayeeMatch(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const PAYEE_FUZZY_PREFIX_LENGTH = 4;
const REFUND_WINDOW_DAYS = 180;

// "TARGET.COM" vs "TARGET STORE 1147": neither contains the other, they share a merchant-name prefix. Safe ONLY because
// refund matching also requires the exact opposite amount in a date window - never use this on payee text alone.
export function payeesFuzzyMatch(payeeA: unknown, payeeB: unknown): boolean {
  const a = normalizeForPayeeMatch(payeeA);
  const b = normalizeForPayeeMatch(payeeB);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  if (a.length < PAYEE_FUZZY_PREFIX_LENGTH || b.length < PAYEE_FUZZY_PREFIX_LENGTH) return false;
  return a.slice(0, PAYEE_FUZZY_PREFIX_LENGTH) === b.slice(0, PAYEE_FUZZY_PREFIX_LENGTH);
}

export function orderRefundMatch<T extends Matchable>(candidate: Matchable, pool: T[]): T | null {
  if (!candidate.orderNumber || Number(candidate.amount) >= 0) return null;
  return pool.find((transaction) => transaction.orderNumber === candidate.orderNumber && Number(transaction.amount) > 0) || null;
}

// A return can never precede its purchase, so the window only looks backward from the refund's date.
export function refundFuzzyMatch<T extends Matchable>(candidate: Matchable, pool: T[]): T | null {
  const amount = Number(candidate.amount);
  if (amount >= 0 || !normalizeForPayeeMatch(candidate.payee)) return null;
  return pool.find((transaction) => Number(transaction.amount) === -amount && (transaction.date || "") <= (candidate.date || "")
    && absoluteDaysBetweenDateKeys(transaction.date || "", candidate.date || "") <= REFUND_WINDOW_DAYS && sameOrUnknownAccount(candidate, transaction) && payeesFuzzyMatch(candidate.payee, transaction.payee)) || null;
}

// A return lands on the card or account that made the purchase, so a fuzzy payee+amount guess only counts when both rows are on the
// same account (or one of them doesn't say which yet). An exact order number is strong enough to pair across accounts.
function sameOrUnknownAccount(a: Matchable, b: Matchable): boolean {
  return !a.accountId || !b.accountId || a.accountId === b.accountId;
}

// An order-number match is the stronger signal and tried first; the fuzzy fallback also runs when it comes up empty,
// since a pair doesn't always carry the same order id on both lines.
export function refundMatch<T extends Matchable>(candidate: Matchable, pool: T[]): T | null {
  return orderRefundMatch(candidate, pool) || refundFuzzyMatch(candidate, pool);
}

// The single most RECENTLY categorized transaction for a payee wins outright (not the most frequent line), so a household
// that changed how it categorizes a payee gets the new choice immediately. EXACT normalized-payee match only: a fuzzy
// prefix match is unsafe on payee text alone - a real incident collapsed dozens of unrelated "Zelle payment to/from X"
// rows onto whichever one was categorized last.
export function suggestSubcategoryFromHistory(payee: string, transactions: Matchable[]): string | null {
  const target = normalizeForPayeeMatch(payee);
  if (!target) return null;
  let best: { lineId: string; date: string } | null = null;
  transactions.forEach((transaction) => {
    if (!transaction.lineId || normalizeForPayeeMatch(transaction.payee) !== target) return;
    const date = String(transaction.date || "");
    if (!best || date > best.date) best = { lineId: transaction.lineId, date };
  });
  if (best) return (best as { lineId: string }).lineId;
  // Nothing under this exact payee: the same merchant written differently (a different store or reference number) counts.
  const loose = payeeLearnKey(payee);
  if (!loose) return null;
  transactions.forEach((transaction) => {
    if (!transaction.lineId || payeeLearnKey(transaction.payee) !== loose) return;
    const date = String(transaction.date || "");
    if (!best || date > best.date) best = { lineId: transaction.lineId, date };
  });
  return best ? (best as { lineId: string }).lineId : null;
}

// ---- Learning from category changes (mirrors web's shared-logic) ------------------------------------------------------------
// A Subcategory the household picks by hand becomes the payee's rule; rules already win over the history guess. A rule is stored under the
// payee's exact key and, for a merchant written with varying store numbers or reference codes, also under a looser key. People and transfers
// only ever match exactly.
const LEARN_EXACT_ONLY_PAYEE = /zelle|venmo|cash\s?app|paypal|transfer|withdrawal|deposit|payroll|check\s?#|\bpayment\b|\batm\b/i;
const LEARN_PROCESSOR_PREFIX = /^(sq|tst|sp|pp|paypal|pos|ach|dbt|debit|purchase)\s*[*:\-]\s*/i;

export function payeeLearnKey(payee: unknown): string {
  const raw = String(payee || "");
  if (!raw.trim() || LEARN_EXACT_ONLY_PAYEE.test(raw)) return "";
  const text = raw.toLowerCase().replace(LEARN_PROCESSOR_PREFIX, "").split(/[*#]/)[0] || "";
  const words = text.split(/[^a-z.]+/).filter((word) => word.replace(/[^a-z]/g, "").length >= 2);
  const first = words[0];
  if (!first) return "";
  const picked = first.includes(".") ? [first] : words.slice(0, 2);
  const key = picked.join("").replace(/[^a-z]/g, "");
  return key.length >= 4 ? key : "";
}

// Sets (lineId) or clears ("") the rule for a payee under both keys, retiring rules made earlier from other writings of the same merchant, and
// remembers how the payee was written so a rules list can show it.
export function setPayeeRule(state: HouseholdState, payee: string, lineId: string): HouseholdState {
  const exact = normalizeForPayeeMatch(payee);
  const loose = payeeLearnKey(payee);
  const keys = [...new Set([exact, loose].filter(Boolean))];
  if (!keys.length) return state;
  const rules = { ...(state.transactionCategorizationRules || {}) };
  const labels = { ...(state.transactionCategorizationRuleLabels || {}) };
  if (loose) Object.keys(labels).forEach((key) => { if (payeeLearnKey(labels[key]) === loose) { delete rules[key]; delete labels[key]; } });
  keys.forEach((key) => { if (lineId) { rules[key] = lineId; labels[key] = String(payee).trim().slice(0, 80); } else { delete rules[key]; delete labels[key]; } });
  return { ...state, transactionCategorizationRules: rules, transactionCategorizationRuleLabels: labels };
}

// The household's "always categorize this way" rules, one entry per payee (a rule lives under an exact and a looser key; both belong to one entry).
export function categoryRuleEntries(state: Pick<HouseholdState, "transactionCategorizationRules" | "transactionCategorizationRuleLabels">): Array<{ label: string; lineId: string; keys: string[] }> {
  const groups = new Map<string, { label: string; lineId: string; keys: string[] }>();
  Object.entries(state.transactionCategorizationRules || {}).forEach(([key, lineId]) => {
    const label = state.transactionCategorizationRuleLabels?.[key] || key;
    const id = `${label.toLowerCase()}|${lineId}`;
    const group = groups.get(id) || { label, lineId, keys: [] };
    group.keys.push(key);
    groups.set(id, group);
  });
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function removeCategoryRule(state: HouseholdState, keys: string[]): HouseholdState {
  const rules = { ...(state.transactionCategorizationRules || {}) };
  const labels = { ...(state.transactionCategorizationRuleLabels || {}) };
  keys.forEach((key) => { delete rules[key]; delete labels[key]; });
  return { ...state, transactionCategorizationRules: rules, transactionCategorizationRuleLabels: labels };
}

// Earlier ledger transactions of the same payee (exact or loose match) filed under a different Subcategory than the one just chosen: the
// ones to offer to move. Returns indexes into `transactions`; the changed row itself is never included.
export function planCategoryRelearn(transactions: Array<{ payee?: string; lineId?: string }>, changedIndex: number, lineId: string): number[] {
  const changed = transactions[changedIndex];
  if (!changed || !lineId) return [];
  const exact = normalizeForPayeeMatch(changed.payee);
  const loose = payeeLearnKey(changed.payee);
  const matches: number[] = [];
  transactions.forEach((transaction, index) => {
    if (index === changedIndex || transaction.lineId === lineId) return;
    if ((exact && normalizeForPayeeMatch(transaction.payee) === exact) || (loose && payeeLearnKey(transaction.payee) === loose)) matches.push(index);
  });
  return matches;
}

// After a ledger transaction's Subcategory was changed by hand: remember it as the payee's rule, move waiting Bank stream rows of the payee
// to it, and report which earlier ledger transactions could follow (the caller asks before moving them).
export function learnFromLineChange(state: HouseholdState, ledgerIndex: number): { state: HouseholdState; others: number[]; waiting: number } {
  const transaction = state.transactions[ledgerIndex];
  if (!transaction || !transaction.lineId || !String(transaction.payee || "").trim()) return { state, others: [], waiting: 0 };
  let next = setPayeeRule(state, transaction.payee, transaction.lineId);
  let waiting = 0;
  const drafts = (next.transactionInboxDrafts || []).map((draft) => {
    if (draft.lineId === transaction.lineId || categorizationRuleForPayee(next.transactionCategorizationRules, draft.payee || "") !== transaction.lineId) return draft;
    waiting += 1;
    return { ...draft, lineId: transaction.lineId, lineSource: "rule" as const, historyMatch: false };
  });
  next = { ...next, transactionInboxDrafts: drafts };
  return { state: next, others: planCategoryRelearn(next.transactions, ledgerIndex, transaction.lineId), waiting };
}

export type CategorizationConfidence = { lineId: string; confidence: number; sampleSize: number };

// A real computed confidence (never a fabricated score): the share of this payee's past categorized transactions that
// used the same line as the one about to be suggested.
export function payeeCategorizationConfidence(payee: string, transactions: Matchable[]): CategorizationConfidence | null {
  const lineId = suggestSubcategoryFromHistory(payee, transactions);
  if (!lineId) return null;
  const target = normalizeForPayeeMatch(payee);
  let total = 0;
  let matching = 0;
  transactions.forEach((transaction) => {
    if (!transaction.lineId || normalizeForPayeeMatch(transaction.payee) !== target) return;
    total += 1;
    if (transaction.lineId === lineId) matching += 1;
  });
  return total ? { lineId, confidence: Math.round((matching / total) * 100), sampleSize: total } : null;
}

// Same exact-match, most-recent-wins rule, for which Wealth account a payee's transactions were linked to.
export function suggestAccountFromHistory(payee: string, transactions: Matchable[]): string | null {
  const target = normalizeForPayeeMatch(payee);
  if (!target) return null;
  let best: { accountId: string; date: string } | null = null;
  transactions.forEach((transaction) => {
    if (!transaction.accountId || normalizeForPayeeMatch(transaction.payee) !== target) return;
    const date = String(transaction.date || "");
    if (!best || date > best.date) best = { accountId: transaction.accountId, date };
  });
  return best ? (best as { accountId: string }).accountId : null;
}

// ---- Categorization rules ("always categorize this payee this way") ---------------------------------------------
export function categorizationRuleForPayee(rules: Record<string, string> | undefined, payee: string): string {
  if (!rules) return "";
  const exact = normalizeForPayeeMatch(payee);
  if (exact && rules[exact]) return rules[exact];
  const loose = payeeLearnKey(payee);
  return (loose && rules[loose]) || "";
}

export function setCategorizationRule(rules: Record<string, string> | undefined, payee: string, lineId: string): Record<string, string> {
  const key = normalizeForPayeeMatch(payee);
  const next = { ...(rules || {}) };
  if (!key) return next;
  if (lineId) next[key] = lineId; else delete next[key];
  return next;
}

// ---- Display sign -------------------------------------------------------------------------------------------------
// Stored amounts are always positive = money out. A checking/savings row reads like a bank statement (deposit +,
// expense -), so its sign is flipped for display and editing only; a credit-card purchase already reads "+" and a row
// with no linked account has nothing to key off, so both are shown as stored.
export function displayDraftAmount(amount: number, account: Account | undefined): number {
  return account && account.type !== "credit_card" ? -Number(amount || 0) : Number(amount || 0);
}
export function storedDraftAmount(displayValue: number, account: Account | undefined): number {
  return account && account.type !== "credit_card" ? -displayValue : displayValue;
}

// ---- Building drafts from a parsed file ---------------------------------------------------------------------------
export type BuildDraftsInput = {
  rows: ParsedBankRow[]; fileName: string; accountHint?: string; idPrefix: string; transactions: Transaction[]; existingDrafts: InboxDraft[];
  accounts: Account[]; rules?: Record<string, string>; createId: (prefix: string) => string;
  // A linked-account feed already knows which Wealth account its rows belong to; skips the filename/content-hint guess.
  forcedAccountId?: string;
};
export type BuildDraftsResult = { drafts: InboxDraft[]; matchedAccount: Account | null; duplicateCount: number; message: string };

// Each imported row becomes a draft pre-filled as far as is safe: the file-level filename/content hint picks the account
// for every row; a refund match pins the line to its purchase; otherwise the household's "always categorize" rule, then
// the most recent history for that exact payee, fill the line (and, with no file-level account, history fills the
// account). New drafts go on top, in reverse file order (web unshifts each row).
export function buildBankStreamDrafts(input: BuildDraftsInput): BuildDraftsResult {
  const matchedAccount = input.forcedAccountId ? input.accounts.find((account) => account.id === input.forcedAccountId) || null : matchAccountByHints([input.accountHint, input.fileName], input.accounts);
  const alreadyKnown: Matchable[] = [...input.transactions, ...input.existingDrafts];
  const duplicateCount = input.rows.filter((row) => isDuplicateTransaction(row, alreadyKnown)).length;
  const refundPool: Matchable[] = [...alreadyKnown, ...input.rows];
  const created: InboxDraft[] = [];
  input.rows.forEach((row) => {
    const refund = refundMatch({ ...row, accountId: matchedAccount?.id || "" }, refundPool);
    // A refund match is tied to a specific purchase - a far stronger signal than history, which only applies without one.
    const historyLineId = refund ? "" : suggestSubcategoryFromHistory(row.payee, input.transactions) || "";
    const ruleLineId = refund ? "" : categorizationRuleForPayee(input.rules, row.payee);
    const historyAccountId = matchedAccount ? "" : suggestAccountFromHistory(row.payee, input.transactions) || "";
    created.unshift({
      id: input.createId(input.idPrefix), payee: row.payee, amount: row.amount,
      lineId: refund?.lineId || ruleLineId || historyLineId || "", accountId: matchedAccount?.id || historyAccountId || "",
      lineSource: refund?.lineId ? "refund" : ruleLineId ? "rule" : historyLineId ? "history" : "",
      date: row.date, orderNumber: row.orderNumber || "", externalId: row.externalId || "", isDeposit: Boolean(row.isDeposit), isPayment: Boolean(row.isPayment), isPending: Boolean(row.isPending),
      historyMatch: Boolean(!refund && !ruleLineId && historyLineId), accountHistoryMatch: Boolean(!matchedAccount && historyAccountId)
    });
  });
  const duplicateNote = duplicateCount ? ` ${duplicateCount} look${duplicateCount === 1 ? "s" : ""} like a duplicate of a transaction you already have — check before accepting.` : "";
  const message = `Imported ${input.rows.length} transaction${input.rows.length === 1 ? "" : "s"} from ${input.fileName}${matchedAccount ? ` — linked to ${matchedAccount.name}` : " — no matching account found, pick one per row below"}.${duplicateNote}`;
  return { drafts: [...created, ...input.existingDrafts], matchedAccount, duplicateCount, message };
}

// ---- Reviewing drafts ---------------------------------------------------------------------------------------------
export type DraftReview = InboxDraft & {
  possibleDuplicate: boolean; refundMatch: InboxDraft | Transaction | null; transferMatch: InboxDraft | Transaction | null;
  categorizationConfidence: CategorizationConfidence | null; categorizationRuleLineId: string;
};

type ReviewState = Pick<HouseholdState, "transactions" | "transactionInboxDrafts" | "transactionInboxDone" | "transactionCategorizationRules">;

// Match results are recomputed live and never trusted from storage: a row imported before a matching fix shipped (or
// before the transaction it now matches existed) must not stay stuck showing a stale answer.
export function reviewDrafts(state: ReviewState): DraftReview[] {
  const drafts = state.transactionInboxDrafts || [];
  const done = state.transactionInboxDone || [];
  return drafts.filter((draft) => !done.includes(draft.id || "")).map((draft) => {
    const others: Array<InboxDraft | Transaction> = [...state.transactions, ...drafts.filter((other) => other.id !== draft.id)];
    return {
      ...draft,
      possibleDuplicate: isDuplicateTransaction(draft, others),
      refundMatch: refundMatch(draft, others),
      transferMatch: findTransferCandidate(draft, others),
      categorizationConfidence: draft.lineId ? payeeCategorizationConfidence(draft.payee || "", state.transactions) : null,
      categorizationRuleLineId: categorizationRuleForPayee(state.transactionCategorizationRules, draft.payee || "")
    };
  });
}

export function pendingDraftCountsByAccount(reviews: InboxDraft[]): Record<string, number> {
  const counts: Record<string, number> = {};
  reviews.forEach((draft) => { if (draft.accountId) counts[draft.accountId] = (counts[draft.accountId] || 0) + 1; });
  return counts;
}

// ---- Acting on drafts ---------------------------------------------------------------------------------------------
export type ActionResult = { ok: true; state: HouseholdState } | { ok: false; error: string };

const accountNameOf = (state: Pick<HouseholdState, "accounts">, id: string | undefined) => (state.accounts || []).find((account) => account.id === id)?.name || "That account";
const withDone = (state: HouseholdState, id: string): string[] => ((state.transactionInboxDone || []).includes(id) ? state.transactionInboxDone || [] : [...(state.transactionInboxDone || []), id]);
const withActivity = (state: HouseholdState, message: string) => ({ ...state.household, activity: [message, ...(state.household.activity || [])] });

// Accepting turns a draft into a real ledger transaction (stamped with a name snapshot of its line and a memo saying
// where it came from). A closed account blocks a date after its close date. A truly unassigned draft becomes a truly
// unassigned transaction - never silently the first line alphabetically, which is indistinguishable from a real choice.
function localTodayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function acceptDraft(state: HouseholdState, draftId: string, memo = ""): ActionResult {
  const draft = (state.transactionInboxDrafts || []).find((item) => item.id === draftId);
  if (!draft) return { ok: false, error: "That row is no longer in Bank stream." };
  const account = (state.accounts || []).find((item) => item.id === draft.accountId);
  if (!accountAllowsDate(account, draft.date || "")) {
    return { ok: false, error: `${accountNameOf(state, draft.accountId)} is closed - "${draft.payee}" is dated after its close date. Change the date, pick a different account, or dismiss it.` };
  }
  const lineId = draft.lineId || "";
  const transaction: Transaction = {
    date: draft.date || "", payee: draft.payee || "", amount: Number(draft.amount), lineId, memo: memo || (draft.recurringId ? "Recurring bill" : "Accepted bank stream item"),
    accountId: draft.accountId || "", orderNumber: draft.orderNumber || "", tags: draft.tags || [], ...lineSnapshot(state, lineId),
    ...(draft.externalId ? { externalId: draft.externalId } : {})
  };
  const label = lineId ? `${transaction.categoryName} - ${transaction.subcategoryName}` : "no category";
  // A row from a linked bank feed is already inside the balance synced from the bank, so posting it hands its amount back through the
  // opening balance and the total stays the bank's (a card's owed amount moves the other way).
  const shift = draft.externalId && account && Number.isFinite(Number(draft.amount)) && (draft.date || "") <= localTodayKey()
    ? Math.round((account.type === "credit_card" ? -Number(draft.amount) : Number(draft.amount)) * 100) / 100 : 0;
  const accounts = shift ? (state.accounts || []).map((item) => item.id === account?.id ? { ...item, openingBalance: Math.round((Number(item.openingBalance || 0) + shift) * 100) / 100 } : item) : state.accounts;
  return { ok: true, state: {
    ...state, accounts, transactions: [transaction, ...state.transactions],
    transactionInboxDone: withDone(state, draftId),
    transactionInboxDrafts: (state.transactionInboxDrafts || []).filter((item) => item.id !== draftId),
    household: withActivity(state, `Assigned ${draft.payee} to ${label}`)
  } };
}

export function dismissDraft(state: HouseholdState, draftId: string): HouseholdState {
  const draft = (state.transactionInboxDrafts || []).find((item) => item.id === draftId);
  return {
    ...state, transactionInboxDone: withDone(state, draftId),
    transactionInboxDrafts: (state.transactionInboxDrafts || []).filter((item) => item.id !== draftId),
    household: withActivity(state, `Dismissed bank stream item: ${draft?.payee || draftId}`)
  };
}

export type DraftPatch = { payee?: string; date?: string; amount?: number; lineId?: string; accountId?: string; tags?: string[] };

// Edits one draft. Picking a different line/account clears its "from history" mark (the mark describes where the CURRENT
// value came from - keeping it would credit a hand-picked choice to the suggestion). A closed account rejects a draft
// dated after its close date, whether the date or the account is what changed.
export function updateDraft(state: HouseholdState, draftId: string, patch: DraftPatch): ActionResult {
  const draft = (state.transactionInboxDrafts || []).find((item) => item.id === draftId);
  if (!draft) return { ok: false, error: "That row is no longer in Bank stream." };
  const nextAccountId = patch.accountId !== undefined ? patch.accountId : draft.accountId;
  const nextDate = patch.date !== undefined ? patch.date : draft.date;
  if ((patch.accountId !== undefined || patch.date !== undefined) && nextAccountId) {
    const account = (state.accounts || []).find((item) => item.id === nextAccountId);
    if (!accountAllowsDate(account, nextDate || "")) {
      return { ok: false, error: patch.date !== undefined ? `${accountNameOf(state, nextAccountId)} is closed - pick a date on or before its close date.` : `${accountNameOf(state, nextAccountId)} is closed - this item is dated after its close date.` };
    }
  }
  const next: InboxDraft = {
    ...draft, ...patch,
    ...(patch.lineId !== undefined ? { historyMatch: false, lineSource: patch.lineId ? "manual" as const : "" as const } : {}),
    ...(patch.accountId !== undefined ? { accountHistoryMatch: false } : {})
  };
  let result: HouseholdState = { ...state, transactionInboxDrafts: (state.transactionInboxDrafts || []).map((item) => item.id === draftId ? next : item) };
  // A Subcategory picked by hand is remembered for the payee (like a change in the ledger), and other waiting rows of the payee follow it.
  if (patch.lineId && String(next.payee || "").trim()) {
    result = setPayeeRule(result, next.payee || "", patch.lineId);
    result = { ...result, transactionInboxDrafts: (result.transactionInboxDrafts || []).map((item) => item.id === draftId || item.lineId === patch.lineId || categorizationRuleForPayee(result.transactionCategorizationRules, item.payee || "") !== patch.lineId ? item : { ...item, lineId: patch.lineId, lineSource: "rule" as const, historyMatch: false }) };
  }
  return { ok: true, state: result };
}

// Hard-deletes every unreviewed row for ONE account (not added to the done list) - for clearing a stale backlog without
// touching any other account's still-relevant rows. Returns how many were removed.
export function clearDraftsForAccount(state: HouseholdState, accountId: string): { state: HouseholdState; removed: number } {
  const drafts = state.transactionInboxDrafts || [];
  const kept = drafts.filter((draft) => draft.accountId !== accountId);
  return { state: kept.length === drafts.length ? state : { ...state, transactionInboxDrafts: kept }, removed: drafts.length - kept.length };
}

// Turns a draft that is really money moving between two of the household's accounts into a Transfer record and removes
// the draft. If the offsetting entry on the CHOSEN counterpart account is still sitting there (as another draft or a ledger
// transaction), it is cleared too - otherwise the move would leave a stray half. A match on a different account than the one
// picked is unrelated and left alone.
export function moveDraftToTransfer(state: HouseholdState, draftId: string, counterpartAccountId: string, memo: string, createId: () => string): ActionResult {
  const draft = (state.transactionInboxDrafts || []).find((item) => item.id === draftId);
  if (!draft) return { ok: false, error: "This item is no longer in Bank stream." };
  if (!draft.accountId) return { ok: false, error: `Set an account on "${draft.payee}" before moving it to Transfers - a transfer needs to know which account the money left or landed in.` };
  if (!counterpartAccountId || counterpartAccountId === draft.accountId) return { ok: false, error: "Pick a different account." };
  const amount = Math.abs(Number(draft.amount));
  const movingOut = Number(draft.amount) > 0;
  const transfer = {
    id: createId(), date: draft.date || "", fromAccountId: movingOut ? draft.accountId : counterpartAccountId,
    toAccountId: movingOut ? counterpartAccountId : draft.accountId, amount, memo: (memo || draft.payee || "").trim()
  };
  const others: Array<InboxDraft | Transaction> = [...state.transactions, ...(state.transactionInboxDrafts || []).filter((item) => item.id !== draft.id)];
  const counterpart = findTransferCandidate(draft, others);
  const clear = counterpart && counterpart.accountId === counterpartAccountId ? counterpart : null;
  const clearedDraftId = clear && (state.transactionInboxDrafts || []).includes(clear as InboxDraft) ? (clear as InboxDraft).id : undefined;
  let done = withDone(state, draftId);
  if (clearedDraftId && !done.includes(clearedDraftId)) done = [...done, clearedDraftId];
  return { ok: true, state: {
    ...state, transfers: [transfer, ...(state.transfers || [])],
    transactions: clear && !clearedDraftId ? state.transactions.filter((item) => item !== clear) : state.transactions,
    transactionInboxDone: done,
    transactionInboxDrafts: (state.transactionInboxDrafts || []).filter((item) => item.id !== draftId && item.id !== clearedDraftId),
    household: withActivity(state, `Moved ${draft.payee} to Transfers`)
  } };
}

// ---- Settle waiting rows in bulk (same rules as the web Bank stream) -----------------------------------------------------
// Both planners only choose the rows; the caller shows the list and applies it after the household confirms. The Ledger is never
// touched, and a row whose other half is already in the Ledger is left for a one-by-one look.

export type TransferPair = { out: InboxDraft; in: InboxDraft };

// Both halves of a move between two own accounts (opposite amounts, different accounts, within the duplicate window), both still
// waiting. Paired greedily, nearest dates first; a row is used once. The positive amount is the side the money left.
// Never paired automatically: person-to-person payments and direct deposits (income, not a move between own accounts), and two card
// accounts (a card-to-card match is two unrelated purchases of the same amount). Those stay in Bank stream for a look.
const BULK_TRANSFER_EXCLUDED_PAYEE = /zelle|venmo|cash\s?app|paypal|direct\s?dep|payroll/i;

export function planBulkTransfers(drafts: InboxDraft[], accounts: Array<{ id: string; type?: string }> = []): TransferPair[] {
  const typeOf = (id?: string) => accounts.find((account) => account.id === id)?.type;
  const open = (drafts || []).filter((draft) => draft.accountId && !draft.isPending && Number(draft.amount) !== 0 && !BULK_TRANSFER_EXCLUDED_PAYEE.test(String(draft.payee || "")));
  const used = new Set<string | undefined>();
  const pairs: TransferPair[] = [];
  open.filter((draft) => Number(draft.amount) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((out) => {
    let best: InboxDraft | null = null;
    let bestGap = Infinity;
    open.forEach((other) => {
      if (used.has(other.id) || other.id === out.id || other.accountId === out.accountId || Number(other.amount) !== -Number(out.amount)) return;
      if (typeOf(out.accountId) === "credit_card" && typeOf(other.accountId) === "credit_card") return;
      const gap = absoluteDaysBetweenDateKeys(other.date || "", out.date || "");
      if (gap <= DUPLICATE_TOLERANCE_DAYS && gap < bestGap) { best = other; bestGap = gap; }
    });
    if (!best || used.has(out.id)) return;
    used.add(out.id);
    used.add((best as InboxDraft).id);
    pairs.push({ out, in: best });
  });
  return pairs;
}

function payeesShareAWord(a: unknown, b: unknown): boolean {
  const words = (value: unknown) => new Set(String(value || "").toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 4));
  const left = words(a);
  return [...words(b)].some((word) => left.has(word));
}

// Waiting rows that are certainly a transaction already recorded: the same bank id as a Ledger row or an earlier waiting row, or the
// same amount within the duplicate window as a hand-entered Ledger entry whose payee shares a word of four or more letters. Two
// waiting rows without bank ids are never judged against each other (two real $5 coffees).
export function planBulkDuplicateSkips(drafts: InboxDraft[], ledger: Transaction[]): InboxDraft[] {
  const seenIds = new Set((ledger || []).map((row) => row.externalId).filter(Boolean));
  const skips: InboxDraft[] = [];
  (drafts || []).forEach((draft) => {
    if (draft.externalId && seenIds.has(draft.externalId)) { skips.push(draft); return; }
    if (draft.externalId) seenIds.add(draft.externalId);
    const sameAsLedger = (ledger || []).some((row) => !(draft.externalId && row.externalId)
      && Number(row.amount) === Number(draft.amount)
      && absoluteDaysBetweenDateKeys(row.date || "", draft.date || "") <= DUPLICATE_TOLERANCE_DAYS
      && payeesShareAWord(row.payee, draft.payee));
    if (sameAsLedger) skips.push(draft);
  });
  return skips;
}

export function applyBulkTransfers(state: HouseholdState, createId: () => string): { state: HouseholdState; moved: number } {
  const pairs = planBulkTransfers(state.transactionInboxDrafts || [], state.accounts || []);
  if (!pairs.length) return { state, moved: 0 };
  const gone = new Set<string | undefined>(pairs.flatMap((pair) => [pair.out.id, pair.in.id]));
  const transfers = pairs.map((pair) => ({
    id: createId(), date: pair.out.date || "", fromAccountId: pair.out.accountId || "", toAccountId: pair.in.accountId || "",
    amount: Math.abs(Number(pair.out.amount)), memo: (pair.out.payee || "").trim()
  }));
  let done = state.transactionInboxDone || [];
  gone.forEach((id) => { if (id && !done.includes(id)) done = [...done, id]; });
  return { moved: pairs.length, state: {
    ...state, transfers: [...transfers.reverse(), ...(state.transfers || [])], transactionInboxDone: done,
    transactionInboxDrafts: (state.transactionInboxDrafts || []).filter((draft) => !gone.has(draft.id)),
    household: withActivity(state, `Moved ${pairs.length} waiting bank row pair${pairs.length === 1 ? "" : "s"} to Transfers`)
  } };
}

export function applyBulkDuplicateSkips(state: HouseholdState): { state: HouseholdState; skipped: number } {
  const skips = planBulkDuplicateSkips(state.transactionInboxDrafts || [], state.transactions);
  if (!skips.length) return { state, skipped: 0 };
  const gone = new Set(skips.map((draft) => draft.id));
  let done = state.transactionInboxDone || [];
  gone.forEach((id) => { if (id && !done.includes(id)) done = [...done, id]; });
  return { skipped: skips.length, state: {
    ...state, transactionInboxDone: done,
    transactionInboxDrafts: (state.transactionInboxDrafts || []).filter((draft) => !gone.has(draft.id)),
    household: withActivity(state, `Skipped ${skips.length} waiting bank row${skips.length === 1 ? "" : "s"} already in the Ledger`)
  } };
}

// ---- Bulk actions and sorting ---------------------------------------------------------------------------------------

export type BulkAccountResult = { state: HouseholdState; applied: number; skippedClosed: number };

// Links every row that has NO account yet to one account (a statement imported without an account match). Rows already
// linked - by the filename match or by hand - are never overwritten. A closed account is skipped for any row dated after it
// closed, and those are counted so the caller can say so.
export function setAccountForUnlinkedDrafts(state: HouseholdState, accountId: string): BulkAccountResult {
  const account = (state.accounts || []).find((item) => item.id === accountId);
  let applied = 0;
  let skippedClosed = 0;
  const drafts = (state.transactionInboxDrafts || []).map((draft) => {
    if (draft.accountId) return draft;
    if (!accountAllowsDate(account, draft.date || "")) { skippedClosed += 1; return draft; }
    applied += 1;
    return { ...draft, accountId, accountHistoryMatch: false };
  });
  return { state: applied ? { ...state, transactionInboxDrafts: drafts } : state, applied, skippedClosed };
}

// Resets the category on every row whose category came from a history guess (never a hand-picked one, a rule, or a
// refund match - those don't carry the history mark), so the user can redo them by hand or with the AI suggestion.
export function clearHistorySuggestions(state: HouseholdState): { state: HouseholdState; cleared: number } {
  let cleared = 0;
  const drafts = (state.transactionInboxDrafts || []).map((draft) => {
    if (!draft.historyMatch) return draft;
    cleared += 1;
    return { ...draft, lineId: "", historyMatch: false, lineSource: "" as const };
  });
  return { state: cleared ? { ...state, transactionInboxDrafts: drafts } : state, cleared };
}

export type DraftSortField = "date" | "amount" | "payee";

// Date/Amount/Payee, either direction. Amount sorts on the STORED value (positive = money out), same as web. Ties keep
// their incoming order, so a re-sort never shuffles equal rows.
export function sortDrafts<T extends InboxDraft>(drafts: T[], field: DraftSortField, direction: "asc" | "desc"): T[] {
  const sign = direction === "asc" ? 1 : -1;
  const value = (draft: T): string | number => field === "amount" ? Number(draft.amount || 0) : field === "date" ? draft.date || "" : String(draft.payee || "").toLowerCase();
  return drafts.map((draft, index) => ({ draft, index })).sort((a, b) => {
    const left = value(a.draft);
    const right = value(b.draft);
    if (left < right) return -sign;
    if (left > right) return sign;
    return a.index - b.index;
  }).map((entry) => entry.draft);
}


// ---- Splitting a purchase with friends -------------------------------------------------------------------------------------
// "I paid $90 for dinner and two friends owe me $30 each": the row keeps only YOUR share as your own expense, and each friend's
// share becomes an IOU. Works on a Bank stream row (only your share is accepted into the ledger) or a ledger transaction (its
// amount is reduced to your share). If friends cover everything there is nothing left to keep, so the row is removed instead of
// leaving a $0 entry behind - the IOUs already carry what it was for.

export type FriendShare = { person: string; amount: number; email?: string };
export type IouSource = { type: "draft"; id: string } | { type: "ledger"; index: number };
export type SplitWithFriendsOptions = { direction: IouDirection; reason: string; date: string };

export function splitRecordWithFriends(state: HouseholdState, source: IouSource, shares: FriendShare[], options: SplitWithFriendsOptions, createId: (prefix: string) => string): ActionResult {
  const draft = source.type === "draft" ? (state.transactionInboxDrafts || []).find((item) => item.id === source.id) : undefined;
  const transaction = source.type === "ledger" ? state.transactions[source.index] : undefined;
  const record = draft || transaction;
  if (!record) return { ok: false, error: source.type === "ledger" ? "This transaction is no longer in the ledger." : "This item is no longer in Bank stream." };
  if (transaction?.splits?.length) return { ok: false, error: "This transaction is split across categories - remove that split first, then split it with a friend." };

  const splits = shares.map((row) => ({ person: String(row.person || "").trim(), amount: Number(row.amount) })).filter((row) => row.person && row.amount > 0);
  if (!splits.length) return { ok: false, error: "Enter at least one friend's name and a positive amount." };
  const original = Number(record.amount);
  const total = Math.abs(original);
  const splitTotal = splits.reduce((sum, row) => sum + row.amount, 0);
  if (splitTotal > total + 0.005) return { ok: false, error: `Splits add up to ${splitTotal.toFixed(2)}, more than the ${total.toFixed(2)} total.` };

  const sign = original < 0 ? -1 : 1;
  const rawYourShare = Math.round((total - splitTotal) * 100) / 100;
  const fullySplit = rawYourShare <= 0.005;
  const yourShare = fullySplit ? 0 : rawYourShare;

  let next: HouseholdState = state;
  if (draft && source.type === "draft") {
    if (fullySplit) {
      next = { ...state, transactionInboxDone: withDone(state, source.id), transactionInboxDrafts: (state.transactionInboxDrafts || []).filter((item) => item.id !== source.id), household: withActivity(state, `Split ${record.payee} entirely with friends - nothing left to add to the Ledger`) };
    } else {
      // Only your remaining share is accepted. If accepting fails (a closed account), nothing changes - no orphan IOUs.
      const reduced = updateDraft(state, source.id, { amount: sign * yourShare });
      if (!reduced.ok) return reduced;
      const accepted = acceptDraft(reduced.state, source.id);
      if (!accepted.ok) return accepted;
      next = accepted.state;
    }
  } else if (source.type === "ledger") {
    next = fullySplit
      ? { ...state, transactions: state.transactions.filter((_, index) => index !== source.index), household: withActivity(state, `Split ${record.payee} entirely with friends - removed from the Ledger`) }
      : { ...state, transactions: state.transactions.map((item, index) => index === source.index ? { ...item, amount: sign * yourShare } : item) };
  }

  const ious: Iou[] = splits.map((split) => ({
    id: createId("iou"), person: split.person, amount: split.amount, direction: options.direction, reason: options.reason.trim(),
    date: options.date || record.date || "", accountId: record.accountId || "", settled: false, settledDate: ""
  }));
  return { ok: true, state: { ...next, ious: [...(next.ious || []), ...ious] } };
}


// ---- Size guard -------------------------------------------------------------------------------------------------------------
// The whole household state is saved in ONE request and the server rejects any request body over 1 MB - and when that happens,
// EVERY later save from every device fails until data is removed. So anything that can add a lot of rows at once (a statement
// import, a calendar import) checks first and refuses rather than pushing the state past the limit. Kept under it with room for
// the other fields in the request.
export const HOUSEHOLD_STATE_SOFT_LIMIT_BYTES = 900_000;

export function stateSizeBytes(state: unknown): number {
  return JSON.stringify(state).length;
}

export function exceedsStateLimit(state: unknown): boolean {
  return stateSizeBytes(state) > HOUSEHOLD_STATE_SOFT_LIMIT_BYTES;
}


// ---- AI categorization on import ----------------------------------------------------------------------------------
// Mirrors web: one batched AI call per chunk fills the category/account that history could not, then rows that are safe go
// straight into the ledger and everything else stays for review. The server only suggests (and validates its ids); these
// functions decide what is trustworthy.
export type AiSuggestion = { id: string; lineId: string | null; accountId: string | null; confidence: "high" | "low"; tags?: string[] };
export const AI_IMPORT_CHUNK_SIZE = 25;

// Drafts the AI should look at: no category, or no account while the household has an open account to choose from.
export function draftsNeedingAi(state: HouseholdState, draftIds: string[]): InboxDraft[] {
  const hasOpenAccount = (state.accounts || []).some((account) => !account.closedAt);
  const wanted = new Set(draftIds);
  return (state.transactionInboxDrafts || []).filter((draft) => draft.id && wanted.has(draft.id) && (!draft.lineId || (!draft.accountId && hasOpenAccount)));
}

// Fills only what is empty; never overwrites a category or account that history, a rule or the user already set.
export function applyAiSuggestions(state: HouseholdState, results: AiSuggestion[]): { state: HouseholdState; filled: number } {
  const byId = new Map(results.map((result) => [result.id, result]));
  let filled = 0;
  const drafts = (state.transactionInboxDrafts || []).map((draft) => {
    const result = draft.id ? byId.get(draft.id) : undefined;
    if (!result) return draft;
    let next = draft;
    if (!draft.lineId && result.lineId) next = { ...next, lineId: result.lineId, lineSource: result.confidence === "high" ? "ai-high" as const : "ai-low" as const };
    if (!draft.accountId && result.accountId) next = { ...next, accountId: result.accountId, accountHistoryMatch: false };
    if (result.tags?.length && !(draft.tags || []).length) next = { ...next, tags: result.tags.slice(0, 2) };
    if (next !== draft) filled += 1;
    return next;
  });
  return { state: filled ? { ...state, transactionInboxDrafts: drafts } : state, filled };
}

export type AutoAcceptContext = { accountsExist: boolean; possibleDuplicate: boolean; refundMatch: unknown; refundMatchPosted?: boolean; transferMatch: unknown; accountClosedForDate: boolean; bankFeed?: boolean; paycheckMatch?: boolean };

// Whether an imported row can go into the ledger without a human look - deliberately conservative (see web's autoAcceptDecision). A row
// from a linked bank feed (context.bankFeed) is the bank's own record, so card payments/deposits go in too - except a deposit that matches
// a paycheck already recorded for that account (context.paycheckMatch), which would count the income twice. A bank-feed row the AI could not
// categorize (or was unsure about) still goes in with no category (uncategorized: true), marked "Needs a category" in the ledger.
export function autoAcceptDecision(draft: InboxDraft, context: AutoAcceptContext): { accept: boolean; reason: string; uncategorized?: boolean } {
  const missingCategory = !draft.lineId;
  if (missingCategory && !context.bankFeed) return { accept: false, reason: "no category" };
  if (context.accountsExist && !draft.accountId) return { accept: false, reason: "no account" };
  if (context.possibleDuplicate) return { accept: false, reason: "possible duplicate" };
  if (context.refundMatch && !refundCanPost(draft, context)) return { accept: false, reason: "refund" };
  if (context.transferMatch) return { accept: false, reason: "possible transfer" };
  if (context.paycheckMatch) return { accept: false, reason: "matches a recorded paycheck" };
  if (!context.bankFeed && (draft.isPayment || draft.isDeposit)) return { accept: false, reason: "payment or deposit" };
  if (draft.isPending) return { accept: false, reason: "still pending" };
  if (context.accountClosedForDate) return { accept: false, reason: "account closed" };
  if (missingCategory) return { accept: true, reason: "", uncategorized: true };
  // A "refund" category is only trusted together with a posted purchase it nets against (checked above).
  const trusted = ["rule", "history", "ai-high"].includes(draft.lineSource || "") || (draft.lineSource === "refund" && Boolean(context.refundMatch));
  if (trusted) return { accept: true, reason: "" };
  // The AI was unsure: post without its guess rather than count the spend against a category it may have got wrong.
  if (context.bankFeed && draft.lineSource === "ai-low") return { accept: true, reason: "", uncategorized: true };
  // A category with no recorded source is one the household set itself (or an older import) - a linked feed keeps it.
  if (context.bankFeed) return { accept: true, reason: "" };
  return { accept: false, reason: draft.lineSource === "ai-low" ? "low confidence" : "unverified category" };
}

// A return from a linked bank or card goes straight in when it nets against a purchase already in the ledger: same account, the exact
// opposite amount (that is how the match is made) and the purchase's own category, so it subtracts from the line the money was spent on.
// A purchase still waiting in Bank stream, another account or another category keeps the return in Bank stream for a look.
export function refundCanPost(draft: InboxDraft, context: AutoAcceptContext): boolean {
  const match = context.refundMatch as Matchable | null;
  return Boolean(context.bankFeed && context.refundMatchPosted && match?.lineId && draft.lineId === match.lineId && Number(draft.amount) < 0
    && sameOrUnknownAccount(draft, match) && (draft.accountId || !context.accountsExist));
}

export function refundMemo(match: Matchable): string {
  return `Refund of the ${Number(match.amount).toFixed(2)} purchase on ${match.date}`;
}

// Files returns of purchases already in the ledger under that purchase's category and account (instead of a fresh AI guess).
export function adoptPostedRefunds(state: HouseholdState, draftIds: string[]): { state: HouseholdState; adopted: number } {
  let adopted = 0;
  const drafts = (state.transactionInboxDrafts || []).map((draft) => {
    if (!draftIds.includes(draft.id || "") || Number(draft.amount) >= 0) return draft;
    const match = refundMatch(draft, state.transactions);
    if (!match?.lineId) return draft;
    const next = { ...draft };
    if (!draft.lineId || draft.lineSource === "ai-low") { next.lineId = match.lineId; next.lineSource = "refund"; }
    if (!draft.accountId && match.accountId) { next.accountId = match.accountId; next.accountHistoryMatch = false; }
    if (next.lineId === draft.lineId && next.accountId === draft.accountId) return draft;
    adopted += 1;
    return next;
  });
  return { state: adopted ? { ...state, transactionInboxDrafts: drafts } : state, adopted };
}

// A bank deposit (negative amount) that lines up with a recurring paycheck occurrence deposited to the same account: within 2% of the
// amount and four days of the payday.
export function matchesRecordedPaycheck(draft: Pick<InboxDraft, "accountId" | "amount" | "date">, occurrences: Array<{ depositAccountId?: string; amount: number; date: string }> | undefined): boolean {
  const amount = Number(draft.amount);
  if (!draft.accountId || !Number.isFinite(amount) || amount >= 0) return false;
  const received = -amount;
  const when = Date.parse(`${String(draft.date || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(when)) return false;
  return (occurrences || []).some((occurrence) => {
    if (occurrence.depositAccountId !== draft.accountId) return false;
    const expected = Number(occurrence.amount);
    const day = Date.parse(`${String(occurrence.date || "").slice(0, 10)}T00:00:00Z`);
    return expected > 0 && Number.isFinite(day) && Math.abs(received - expected) <= expected * 0.02 && Math.abs(day - when) <= 4 * 86400000;
  });
}

// Posts every safe draft among draftIds into the ledger (each decided against the ledger as it stands after the previous one).
export function autoAcceptSafeDrafts(state: HouseholdState, draftIds: string[], final = false): { state: HouseholdState; added: number; uncategorized: number; reasons: Record<string, number> } {
  let current = state;
  let added = 0;
  let uncategorized = 0;
  const reasons: Record<string, number> = {};
  for (const id of draftIds) {
    const draft = (current.transactionInboxDrafts || []).find((item) => item.id === id);
    if (!draft) continue;
    const others: Array<InboxDraft | Transaction> = [...current.transactions, ...(current.transactionInboxDrafts || []).filter((other) => other.id !== id)];
    const account = (current.accounts || []).find((item) => item.id === draft.accountId);
    const returnOf = refundMatch(draft, others);
    const returnOfPosted = Boolean(returnOf) && current.transactions.includes(returnOf as Transaction);
    // A return whose purchase is still waiting in Bank stream is looked at again on the final pass, once that purchase has had its chance to post.
    if (returnOf && !returnOfPosted && !final) continue;
    const decision = autoAcceptDecision(draft, {
      accountsExist: (current.accounts || []).some((item) => !item.closedAt),
      possibleDuplicate: isDuplicateTransaction(draft, others),
      refundMatch: returnOf,
      refundMatchPosted: returnOfPosted,
      transferMatch: findTransferCandidate(draft, others),
      accountClosedForDate: !accountAllowsDate(account, draft.date || ""),
      bankFeed: true,
      paycheckMatch: matchesRecordedPaycheck(draft, current.paycheckOccurrences)
    });
    if (!decision.accept) { reasons[decision.reason] = (reasons[decision.reason] || 0) + 1; continue; }
    if (decision.uncategorized) current = { ...current, transactionInboxDrafts: (current.transactionInboxDrafts || []).map((item) => item.id === id ? { ...item, lineId: "", lineSource: "" } : item) };
    const accepted = acceptDraft(current, id, decision.uncategorized ? "Needs a category" : returnOfPosted && returnOf ? refundMemo(returnOf) : "");
    if (accepted.ok) { current = accepted.state; added += 1; if (decision.uncategorized) uncategorized += 1; } else reasons["could not post"] = (reasons["could not post"] || 0) + 1;
  }
  return { state: current, added, uncategorized, reasons };
}

export function importSummary(fileName: string, importedCount: number, filled: number, added: number, remaining: number, reasons: Record<string, number>, aiNote = "", rerun = false, uncategorized = 0): string {
  const reasonText = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => `${count} ${reason}`).join(", ");
  const lead = rerun ? `Checked ${importedCount} waiting row${importedCount === 1 ? "" : "s"}.` : `Imported ${importedCount} from ${fileName}.`;
  return `${lead}${filled ? ` AI filled in ${filled} row${filled === 1 ? "" : "s"}.` : ""} ${added} added to the ledger${uncategorized ? ` (${uncategorized} without a category - marked "Needs a category" there)` : ""}${remaining ? `; ${remaining} left in Bank stream to review (${reasonText})` : ""}.${aiNote}`;
}

// ---- Clean up old transactions ------------------------------------------------------------------------------------
// Mirrors web: finds (and removes) ledger transactions and/or waiting Bank stream rows dated before a cutoff ("" = every date). Pure and
// non-mutating so the screen can preview the counts, offer a CSV backup of exactly what would go, then apply the result.
export type CleanupOptions = { before: string; includeLedger: boolean; includeStream: boolean };
export type CleanupPreview = { ledger: Transaction[]; stream: InboxDraft[]; ledgerCount: number; streamCount: number; oldest: string; newest: string };

export function previewTransactionCleanup(state: Pick<HouseholdState, "transactions" | "transactionInboxDrafts">, options: CleanupOptions): CleanupPreview {
  const inRange = (item: { date?: string }) => !options.before || String(item.date || "") < options.before;
  const ledger = options.includeLedger ? state.transactions.filter(inRange) : [];
  const stream = options.includeStream ? (state.transactionInboxDrafts || []).filter(inRange) : [];
  const dates = [...ledger, ...stream].map((item) => String(item.date || "")).filter(Boolean).sort();
  return { ledger, stream, ledgerCount: ledger.length, streamCount: stream.length, oldest: dates[0] || "", newest: dates[dates.length - 1] || "" };
}

export function applyTransactionCleanup(state: HouseholdState, options: CleanupOptions): { state: HouseholdState; removedLedger: number; removedStream: number } {
  const preview = previewTransactionCleanup(state, options);
  const drop = new Set<unknown>([...preview.ledger, ...preview.stream]);
  return {
    state: { ...state, transactions: state.transactions.filter((item) => !drop.has(item)), transactionInboxDrafts: (state.transactionInboxDrafts || []).filter((item) => !drop.has(item)) },
    removedLedger: preview.ledgerCount, removedStream: preview.streamCount
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function removedTransactionsCsv(preview: CleanupPreview, accountNameOf: (id: string | undefined) => string): string {
  const rows: Array<[string, Transaction | InboxDraft]> = [...preview.ledger.map((item): [string, Transaction] => ["Ledger", item]), ...preview.stream.map((item): [string, InboxDraft] => ["Bank stream", item])];
  const header = ["Source", "Date", "Payee", "Amount", "Category", "Subcategory", "Account", "Memo", "Tags"];
  const lines = rows.map(([source, item]) => {
    const extra = item as Transaction;
    return [source, item.date, item.payee, item.amount, extra.categoryName || "", extra.subcategoryName || "", accountNameOf(item.accountId), extra.memo || "", (item.tags || []).join("; ")].map(csvCell).join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

export function cleanupSummary(removedLedger: number, removedStream: number): string {
  return `Removed ${removedLedger} ledger transaction${removedLedger === 1 ? "" : "s"} and ${removedStream} Bank stream row${removedStream === 1 ? "" : "s"}.`;
}
