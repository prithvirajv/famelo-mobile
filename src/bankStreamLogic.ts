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
import type { Account, HouseholdState, InboxDraft, Transaction } from "./types";

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
export type ParsedBankRow = { date: string; payee: string; amount: number; isDeposit?: boolean; isPayment?: boolean; isPending?: boolean; orderNumber?: string };

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
type Matchable = { id?: string; payee?: string; amount?: number | string; date?: string; accountId?: string; lineId?: string; orderNumber?: string };

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
export function isDuplicateTransaction(candidate: Matchable, existing: Matchable[]): boolean {
  const amount = Number(candidate.amount);
  return existing.some((other) => Number(other.amount) === amount && absoluteDaysBetweenDateKeys(other.date || "", candidate.date || "") <= DUPLICATE_TOLERANCE_DAYS);
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
    && absoluteDaysBetweenDateKeys(transaction.date || "", candidate.date || "") <= REFUND_WINDOW_DAYS && payeesFuzzyMatch(candidate.payee, transaction.payee)) || null;
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
  return best ? (best as { lineId: string }).lineId : null;
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
  const key = normalizeForPayeeMatch(payee);
  return key ? rules?.[key] || "" : "";
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
};
export type BuildDraftsResult = { drafts: InboxDraft[]; matchedAccount: Account | null; duplicateCount: number; message: string };

// Each imported row becomes a draft pre-filled as far as is safe: the file-level filename/content hint picks the account
// for every row; a refund match pins the line to its purchase; otherwise the household's "always categorize" rule, then
// the most recent history for that exact payee, fill the line (and, with no file-level account, history fills the
// account). New drafts go on top, in reverse file order (web unshifts each row).
export function buildBankStreamDrafts(input: BuildDraftsInput): BuildDraftsResult {
  const matchedAccount = matchAccountByHints([input.accountHint, input.fileName], input.accounts);
  const alreadyKnown: Matchable[] = [...input.transactions, ...input.existingDrafts];
  const duplicateCount = input.rows.filter((row) => isDuplicateTransaction(row, alreadyKnown)).length;
  const refundPool: Matchable[] = [...alreadyKnown, ...input.rows];
  const created: InboxDraft[] = [];
  input.rows.forEach((row) => {
    const refund = refundMatch(row, refundPool);
    // A refund match is tied to a specific purchase - a far stronger signal than history, which only applies without one.
    const historyLineId = refund ? "" : suggestSubcategoryFromHistory(row.payee, input.transactions) || "";
    const ruleLineId = refund ? "" : categorizationRuleForPayee(input.rules, row.payee);
    const historyAccountId = matchedAccount ? "" : suggestAccountFromHistory(row.payee, input.transactions) || "";
    created.unshift({
      id: input.createId(input.idPrefix), payee: row.payee, amount: row.amount,
      lineId: refund?.lineId || ruleLineId || historyLineId || "", accountId: matchedAccount?.id || historyAccountId || "",
      date: row.date, orderNumber: row.orderNumber || "", isDeposit: Boolean(row.isDeposit), isPayment: Boolean(row.isPayment), isPending: Boolean(row.isPending),
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
export function acceptDraft(state: HouseholdState, draftId: string): ActionResult {
  const draft = (state.transactionInboxDrafts || []).find((item) => item.id === draftId);
  if (!draft) return { ok: false, error: "That row is no longer in Bank stream." };
  const account = (state.accounts || []).find((item) => item.id === draft.accountId);
  if (!accountAllowsDate(account, draft.date || "")) {
    return { ok: false, error: `${accountNameOf(state, draft.accountId)} is closed - "${draft.payee}" is dated after its close date. Change the date, pick a different account, or dismiss it.` };
  }
  const lineId = draft.lineId || "";
  const transaction: Transaction = {
    date: draft.date || "", payee: draft.payee || "", amount: Number(draft.amount), lineId, memo: draft.recurringId ? "Recurring bill" : "Accepted bank stream item",
    accountId: draft.accountId || "", orderNumber: draft.orderNumber || "", tags: draft.tags || [], ...lineSnapshot(state, lineId)
  };
  const label = lineId ? `${transaction.categoryName} - ${transaction.subcategoryName}` : "no category";
  return { ok: true, state: {
    ...state, transactions: [transaction, ...state.transactions],
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
    ...(patch.lineId !== undefined ? { historyMatch: false } : {}),
    ...(patch.accountId !== undefined ? { accountHistoryMatch: false } : {})
  };
  return { ok: true, state: { ...state, transactionInboxDrafts: (state.transactionInboxDrafts || []).map((item) => item.id === draftId ? next : item) } };
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
