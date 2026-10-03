import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBankCsvTransactions, parseDelimitedText, normalizeCsvDate, matchAccountByHints, normalizeForAccountMatch, isDuplicateTransaction, findTransferCandidate,
  orderRefundMatch, refundFuzzyMatch, refundMatch, payeesFuzzyMatch, suggestSubcategoryFromHistory, payeeCategorizationConfidence, suggestAccountFromHistory,
  categorizationRuleForPayee, setCategorizationRule, displayDraftAmount, storedDraftAmount, buildBankStreamDrafts, reviewDrafts, pendingDraftCountsByAccount,
  acceptDraft, dismissDraft, updateDraft, clearDraftsForAccount, moveDraftToTransfer
} from "../src/bankStreamLogic.ts";

// All fixtures here are synthetic (SAMPLE names) - never copy rows from a real statement into a test.

// ---- CSV parsing --------------------------------------------------------------------------------------------------
test("a Debit/Credit file imports debits as expenses, flags an autopay credit as a payment, and keeps a genuine credit as a flagged deposit", () => {
  const csv = [
    "Status,Date,Description,Debit,Credit,Member Name",
    'Cleared,07/13/2026,"SAMPLE CINEMA 18",1.08,,A PERSON',
    'Cleared,07/10/2026,"AUTOPAY 123SAMPLE AUTO-PMT",,-1768.09,A PERSON',
    'Cleared,06/30/2026,"SAMPLE WAREHOUSE RETURN",,-26.74,A PERSON',
    'Cleared,06/30/2026,"SAMPLE FUEL",50.52,,A PERSON'
  ].join("\n");
  assert.deepEqual(parseBankCsvTransactions(csv), [
    { date: "2026-07-13", payee: "SAMPLE CINEMA 18", amount: 1.08 },
    { date: "2026-07-10", payee: "AUTOPAY 123SAMPLE AUTO-PMT", amount: -1768.09, isPayment: true },
    { date: "2026-06-30", payee: "SAMPLE WAREHOUSE RETURN", amount: -26.74, isDeposit: true },
    { date: "2026-06-30", payee: "SAMPLE FUEL", amount: 50.52 }
  ]);
});

test("a single signed Amount checking file keeps money-out as positive spend and deposits as flagged negatives, skipping a leading summary block", () => {
  const csv = [
    "Description,,Summary Amt.", "Beginning balance as of 06/18/2026,,\"1,228.22\"", "Total credits,,\"5,253.21\"", "",
    "Date,Description,Amount,Running Bal.",
    '06/18/2026,Beginning balance as of 06/18/2026,,"1,228.22"',
    '06/20/2026,"Transfer from SAMPLE PERSON","63.75","1,291.97"',
    '07/02/2026,"SAMPLE UTILITY Bill Payment","-138.06","664.47"',
    '07/17/2026,"SAMPLE MORTGAGE","-2,258.90","1,040.86"'
  ].join("\n");
  assert.deepEqual(parseBankCsvTransactions(csv), [
    { date: "2026-06-20", payee: "Transfer from SAMPLE PERSON", amount: -63.75, isDeposit: true },
    { date: "2026-07-02", payee: "SAMPLE UTILITY Bill Payment", amount: 138.06 },
    { date: "2026-07-17", payee: "SAMPLE MORTGAGE", amount: 2258.9 }
  ]);
});

test("a credit-card-style export (mostly positive) keeps purchases positive, flags payoff rows instead of dropping them, and keeps a genuine refund negative", () => {
  const csv = [
    "Date,Description,Card Member,Account #,Amount,Reference,Category",
    "06/09/2026,AUTOPAY PAYMENT - THANK YOU,A PERSON,-1,-256.87,'1',",
    "05/24/2026,SAMPLE COFFEE,A PERSON,-1,1.70,'2',Restaurant",
    "05/24/2026,SAMPLE BOUTIQUE,A PERSON,-1,133.16,'3',Merchandise",
    "05/20/2026,SAMPLE HOTEL REFUND,A PERSON,-1,-2.00,'4',Travel"
  ].join("\n");
  assert.deepEqual(parseBankCsvTransactions(csv), [
    { date: "2026-06-09", payee: "AUTOPAY PAYMENT - THANK YOU", amount: -256.87, isPayment: true },
    { date: "2026-05-24", payee: "SAMPLE COFFEE", amount: 1.7 },
    { date: "2026-05-24", payee: "SAMPLE BOUTIQUE", amount: 133.16 },
    { date: "2026-05-20", payee: "SAMPLE HOTEL REFUND", amount: -2 }
  ]);
});

test("a tied one-purchase/one-payment card file is still read card-style because a payment-looking negative row decides it", () => {
  const csv = ["Date,Description,Card Member,Account #,Amount", "06/12/2026,SAMPLE AIRLINE TICKET,A PERSON,-1,412.00", "06/05/2026,SAMPLE PAYMENT RECEIVED - THANK YOU,A PERSON,-1,-412.00"].join("\n");
  assert.deepEqual(parseBankCsvTransactions(csv), [
    { date: "2026-06-12", payee: "SAMPLE AIRLINE TICKET", amount: 412 },
    { date: "2026-06-05", payee: "SAMPLE PAYMENT RECEIVED - THANK YOU", amount: -412, isPayment: true }
  ]);
});

test("a mostly-negative checking file is not mistaken for a card export, and its deposit is kept flagged", () => {
  const csv = ["Date,Description,Amount", "07/01/2026,Paycheck deposit,2500.00", "07/02/2026,Grocery store,-84.21", "07/03/2026,Gas station,-45.00", "07/05/2026,Electric bill,-120.50"].join("\n");
  assert.deepEqual(parseBankCsvTransactions(csv), [
    { date: "2026-07-01", payee: "Paycheck deposit", amount: -2500, isDeposit: true },
    { date: "2026-07-02", payee: "Grocery store", amount: 84.21 },
    { date: "2026-07-03", payee: "Gas station", amount: 45 },
    { date: "2026-07-05", payee: "Electric bill", amount: 120.5 }
  ]);
});

test("an explicit Transaction Type column is authoritative and isn't fooled by a withdrawal that pays another card's autopay", () => {
  const csv = [
    "Date,Transaction Type,Description,Amount",
    "07/17/2026,DEBIT,ELECTRONIC WITHDRAWAL SAMPLE CARD AUTOPAY PAYMENT,-251.45",
    "07/20/2026,DEBIT,ELECTRONIC WITHDRAWAL OTHER CARD AUTOPAY PAYMENT,-46.66",
    "07/23/2026,CREDIT,ELECTRONIC DEPOSIT - SAMPLE EMPLOYER PAYROLL,1106.06",
    "07/30/2026,CREDIT,DIVIDEND,0.14",
    "07/31/2026,OTHER,IGNORED,5.00"
  ].join("\n");
  assert.deepEqual(parseBankCsvTransactions(csv), [
    { date: "2026-07-17", payee: "ELECTRONIC WITHDRAWAL SAMPLE CARD AUTOPAY PAYMENT", amount: 251.45 },
    { date: "2026-07-20", payee: "ELECTRONIC WITHDRAWAL OTHER CARD AUTOPAY PAYMENT", amount: 46.66 },
    { date: "2026-07-23", payee: "ELECTRONIC DEPOSIT - SAMPLE EMPLOYER PAYROLL", amount: -1106.06, isDeposit: true },
    { date: "2026-07-30", payee: "DIVIDEND", amount: -0.14, isDeposit: true }
  ]);
});

test("real issuers' header spellings (Posting Date, Trans. Date) are recognized", () => {
  const chase = ["Details,Posting Date,Description,Amount,Type,Balance", "DEBIT,06/12/2026,SAMPLE COFFEE SHOP,-4.75,DEBIT_CARD,1200.00", "CREDIT,06/09/2026,SAMPLE PAYROLL,1500.00,ACH_CREDIT,1266.85"].join("\n");
  assert.deepEqual(parseBankCsvTransactions(chase), [{ date: "2026-06-12", payee: "SAMPLE COFFEE SHOP", amount: 4.75 }, { date: "2026-06-09", payee: "SAMPLE PAYROLL", amount: -1500, isDeposit: true }]);
  const discover = ["Trans. Date,Post Date,Description,Amount,Category", "06/12/2026,06/13/2026,SAMPLE RESTAURANT,25.40,Restaurants", "06/09/2026,06/10/2026,SAMPLE PAYMENT - THANK YOU,-400.00,Payments"].join("\n");
  assert.deepEqual(parseBankCsvTransactions(discover), [{ date: "2026-06-12", payee: "SAMPLE RESTAURANT", amount: 25.4 }, { date: "2026-06-09", payee: "SAMPLE PAYMENT - THANK YOU", amount: -400, isPayment: true }]);
});

test("a headerless 5-column export is recognized by structure, and a lookalike that isn't a date/amount file returns nothing", () => {
  const wf = ['"06/12/2026","-52.30","*","","SAMPLE PHARMACY"', '"06/10/2026","1500.00","*","","SAMPLE PAYROLL DEPOSIT"'].join("\n");
  assert.deepEqual(parseBankCsvTransactions(wf), [{ date: "2026-06-12", payee: "SAMPLE PHARMACY", amount: 52.3 }, { date: "2026-06-10", payee: "SAMPLE PAYROLL DEPOSIT", amount: -1500, isDeposit: true }]);
  assert.deepEqual(parseBankCsvTransactions(['"not a date","not a number","x","y","z"', '"also no","nope","a","b","c"'].join("\n")), []);
  assert.deepEqual(parseBankCsvTransactions(""), []);
  assert.deepEqual(parseBankCsvTransactions("just,some,text\n1,2,3"), []);
});

test("rows with a bad date, blank payee, zero or unparseable amount are skipped, and quoted fields with commas and stray quotes survive", () => {
  const csv = ["Date,Description,Amount", "13/45/2026,Bad date,-5.00", "07/01/2026,,-5.00", "07/01/2026,Zero,0.00", "07/01/2026,Junk,abc", '07/02/2026,"SAMPLE, INC ""quoted"" memo",-9.99', '07/03/2026,"for "Trip fund"; ref",-1.00'].join("\n");
  assert.deepEqual(parseBankCsvTransactions(csv), [{ date: "2026-07-02", payee: 'SAMPLE, INC "quoted" memo', amount: 9.99 }, { date: "2026-07-03", payee: 'for "Trip fund"; ref', amount: 1 }]);
  assert.deepEqual(parseDelimitedText('a,"b,c"\r\nd,e'), [["a", "b,c"], ["d", "e"]]);
  assert.equal(normalizeCsvDate("2026-07-05"), "2026-07-05");
  assert.equal(normalizeCsvDate("7/5/2026"), "2026-07-05");
  assert.equal(normalizeCsvDate("5 Jul 2026"), "");
  assert.equal(normalizeCsvDate("02/30/2026"), "", "a date that does not exist is rejected (web lets it through)");
  assert.equal(normalizeCsvDate("2026-13-01"), "");
  assert.equal(normalizeCsvDate("2/29/2024"), "2024-02-29");
});

// ---- Matching -----------------------------------------------------------------------------------------------------
const acct = (id, name, extra = {}) => ({ id, name, type: "checking", openingBalance: 0, netWorthAssetId: "", netWorthLiabilityId: "", createdAt: "2026-01-01", ...extra });

test("matchAccountByHints matches a longer hint to a shorter account name (and vice versa), tries hints in order, and skips empties", () => {
  const accounts = [acct("a", "Costco Citi"), acct("b", "Checking")];
  assert.equal(normalizeForAccountMatch("Costco Citi"), "costcociti");
  assert.equal(matchAccountByHints(["Costco Citi Jul 142026.CSV"], accounts)?.id, "a");
  assert.equal(matchAccountByHints(["", undefined, "my-checking-export.csv"], accounts)?.id, "b");
  assert.equal(matchAccountByHints(["Adv Plus Banking - 6769", "Costco Citi.csv"], accounts)?.id, "a");
  assert.equal(matchAccountByHints(["unrelated.csv"], accounts), null);
  assert.equal(matchAccountByHints(["x"], []), null);
});

test("isDuplicateTransaction matches on amount alone within 2 days, ignoring payee text", () => {
  const existing = [{ date: "2026-07-10", payee: "Hand typed name", amount: 25 }];
  assert.equal(isDuplicateTransaction({ date: "2026-07-12", payee: "BANK RAW DESC", amount: 25 }, existing), true);
  assert.equal(isDuplicateTransaction({ date: "2026-07-13", payee: "x", amount: 25 }, existing), false);
  assert.equal(isDuplicateTransaction({ date: "2026-07-10", payee: "x", amount: 26 }, existing), false);
});

test("findTransferCandidate needs an account, the opposite amount, a DIFFERENT account and a 2-day window", () => {
  const others = [{ id: "o", date: "2026-07-10", payee: "Card", amount: -500, accountId: "card" }];
  const candidate = { date: "2026-07-11", payee: "Payment", amount: 500, accountId: "chk" };
  assert.equal(findTransferCandidate(candidate, others)?.id, "o");
  assert.equal(findTransferCandidate({ ...candidate, accountId: "" }, others), null);
  assert.equal(findTransferCandidate({ ...candidate, accountId: "card" }, others), null);
  assert.equal(findTransferCandidate({ ...candidate, amount: 501 }, others), null);
  assert.equal(findTransferCandidate({ ...candidate, date: "2026-07-14" }, others), null);
});

test("refunds pair by exact order number first, else by fuzzy payee + exact opposite amount looking only backward within 180 days", () => {
  const purchase = { payee: "TARGET STORE 1147", amount: 40, date: "2026-03-01", orderNumber: "ORD-1", lineId: "shop" };
  assert.equal(orderRefundMatch({ payee: "X", amount: -40, date: "2026-03-05", orderNumber: "ORD-1" }, [purchase]), purchase);
  assert.equal(orderRefundMatch({ payee: "X", amount: 40, date: "2026-03-05", orderNumber: "ORD-1" }, [purchase]), null);
  assert.equal(orderRefundMatch({ payee: "X", amount: -40, date: "2026-03-05" }, [purchase]), null);
  const noOrder = { payee: "TARGET.COM", amount: -40, date: "2026-03-20" };
  assert.equal(refundFuzzyMatch(noOrder, [purchase]), purchase);
  assert.equal(refundFuzzyMatch({ ...noOrder, date: "2026-02-20" }, [purchase]), null, "a refund can't precede its purchase");
  assert.equal(refundFuzzyMatch({ ...noOrder, date: "2026-09-20" }, [purchase]), null, "outside the 180-day window");
  assert.equal(refundFuzzyMatch({ ...noOrder, payee: "WALMART" }, [purchase]), null);
  assert.equal(refundFuzzyMatch({ ...noOrder, amount: -41 }, [purchase]), null);
  assert.equal(refundMatch({ ...noOrder, orderNumber: "NOPE" }, [purchase]), purchase, "fuzzy runs when the order match comes up empty");
  assert.equal(payeesFuzzyMatch("AMAZON.COM*A1B2", "amazon.com"), true);
  assert.equal(payeesFuzzyMatch("ab", "ac"), false);
});

test("category history: the most recent categorization for an EXACT payee wins, never a fuzzy prefix (the Zelle regression)", () => {
  const history = [
    { payee: "Netflix", lineId: "entertainment", date: "2026-01-01" }, { payee: "Netflix", lineId: "entertainment", date: "2026-02-01" }, { payee: "NETFLIX", lineId: "subscriptions", date: "2026-03-01" },
    { payee: "Zelle payment to Alex", lineId: "gifts", date: "2026-03-02" }, { payee: "Zelle payment from Bo", lineId: "", date: "2026-03-03" }
  ];
  assert.equal(suggestSubcategoryFromHistory("netflix", history), "subscriptions");
  assert.equal(suggestSubcategoryFromHistory("Zelle payment from Casey", history), null);
  assert.equal(suggestSubcategoryFromHistory("Netflixx", history), null);
  assert.equal(suggestSubcategoryFromHistory("", history), null);
  assert.deepEqual(payeeCategorizationConfidence("Netflix", history), { lineId: "subscriptions", confidence: 33, sampleSize: 3 });
  assert.equal(payeeCategorizationConfidence("Unknown", history), null);
  assert.equal(payeeCategorizationConfidence("Zelle payment to Alex", history)?.confidence, 100);
});

test("account history: the most recently used account for an exact payee wins", () => {
  const history = [{ payee: "Shell", accountId: "old", date: "2026-01-01" }, { payee: "SHELL", accountId: "new", date: "2026-02-01" }, { payee: "Shell", accountId: "", date: "2026-03-01" }];
  assert.equal(suggestAccountFromHistory("shell", history), "new");
  assert.equal(suggestAccountFromHistory("other", history), null);
});

test("categorization rules are keyed by normalized payee; setting a blank line removes the rule", () => {
  let rules = setCategorizationRule(undefined, "Netflix.com", "subs");
  assert.deepEqual(rules, { netflixcom: "subs" });
  assert.equal(categorizationRuleForPayee(rules, "NETFLIX.COM"), "subs");
  assert.equal(categorizationRuleForPayee(rules, "Other"), "");
  assert.deepEqual(setCategorizationRule(rules, "netflix.com", ""), {});
  assert.deepEqual(setCategorizationRule(rules, "", "x"), rules);
  assert.equal(categorizationRuleForPayee(undefined, "x"), "");
});

test("display sign flips for checking/savings (reads like a bank statement) but not for credit cards or unlinked rows, and round-trips", () => {
  assert.equal(displayDraftAmount(25, acct("c", "Chk")), -25);
  assert.equal(displayDraftAmount(-25, acct("c", "Chk")), 25);
  assert.equal(displayDraftAmount(25, acct("cc", "Card", { type: "credit_card" })), 25);
  assert.equal(displayDraftAmount(25, undefined), 25);
  assert.equal(storedDraftAmount(-25, acct("c", "Chk")), 25);
  assert.equal(storedDraftAmount(25, acct("cc", "Card", { type: "credit_card" })), 25);
});

// ---- Building drafts ----------------------------------------------------------------------------------------------
let seq = 0;
const createId = (prefix) => `${prefix}-${++seq}`;

test("buildBankStreamDrafts links the file's account, fills category from rule then history, pins refunds to their purchase, and puts new rows on top in reverse file order", () => {
  const transactions = [
    { date: "2026-06-01", payee: "SAMPLE MARKET", amount: 30, lineId: "groceries", accountId: "card" },
    { date: "2026-05-01", payee: "TARGET STORE 1", amount: 55, lineId: "shop", accountId: "card" }
  ];
  const existing = [{ id: "old-draft", payee: "Old", amount: 1, date: "2026-07-01", lineId: "" }];
  const rows = [
    { date: "2026-07-02", payee: "SAMPLE MARKET", amount: 12.5 },
    { date: "2026-07-03", payee: "NETFLIX", amount: 15 },
    { date: "2026-07-04", payee: "TARGET.COM", amount: -55 },
    { date: "2026-07-05", payee: "Brand new payee", amount: 9 }
  ];
  const result = buildBankStreamDrafts({ rows, fileName: "Costco Card Jul.csv", idPrefix: "csv-import", transactions, existingDrafts: existing, accounts: [acct("card", "Costco Card"), acct("chk", "Checking")], rules: { netflix: "subs" }, createId });
  assert.equal(result.matchedAccount.id, "card");
  assert.deepEqual(result.drafts.map((d) => d.payee), ["Brand new payee", "TARGET.COM", "NETFLIX", "SAMPLE MARKET", "Old"]);
  const byPayee = Object.fromEntries(result.drafts.map((d) => [d.payee, d]));
  assert.equal(byPayee["SAMPLE MARKET"].lineId, "groceries");
  assert.equal(byPayee["SAMPLE MARKET"].historyMatch, true);
  assert.equal(byPayee.NETFLIX.lineId, "subs");
  assert.equal(byPayee.NETFLIX.historyMatch, false, "a rule isn't a history guess");
  assert.equal(byPayee["TARGET.COM"].lineId, "shop", "the refund is pinned to its purchase's line");
  assert.equal(byPayee["TARGET.COM"].historyMatch, false);
  assert.equal(byPayee["Brand new payee"].lineId, "");
  assert.ok(result.drafts.every((d) => d.accountId === "card" || d.payee === "Old"));
  assert.equal(result.drafts[0].id.startsWith("csv-import-"), true);
  assert.match(result.message, /^Imported 4 transactions from Costco Card Jul\.csv — linked to Costco Card\.$/);
});

test("with no file-level account match, history fills the account per payee, and the message says to pick one per row; duplicates are counted", () => {
  const transactions = [{ date: "2026-07-01", payee: "SAMPLE FUEL", amount: 40, lineId: "gas", accountId: "chk" }];
  const rows = [{ date: "2026-07-02", payee: "SAMPLE FUEL", amount: 40 }, { date: "2026-07-02", payee: "Other", amount: 7 }];
  const result = buildBankStreamDrafts({ rows, fileName: "statement.csv", idPrefix: "csv-import", transactions, existingDrafts: [], accounts: [acct("chk", "Checking")], createId });
  assert.equal(result.matchedAccount, null);
  assert.equal(result.duplicateCount, 1);
  const byPayee = Object.fromEntries(result.drafts.map((d) => [d.payee, d]));
  assert.equal(byPayee["SAMPLE FUEL"].accountId, "chk");
  assert.equal(byPayee["SAMPLE FUEL"].accountHistoryMatch, true);
  assert.equal(byPayee.Other.accountId, "");
  assert.match(result.message, /no matching account found, pick one per row below\. 1 looks like a duplicate of a transaction you already have/);
  assert.match(buildBankStreamDrafts({ rows: [rows[0]], fileName: "x.csv", idPrefix: "p", transactions: [], existingDrafts: [], accounts: [], createId }).message, /^Imported 1 transaction from x\.csv/);
});

// ---- Reviewing and acting on drafts -------------------------------------------------------------------------------
const baseState = (overrides = {}) => ({
  household: { name: "H", country: "US", currency: "USD", activity: [] },
  budget: { month: "2026-07", income: 0, categories: [{ name: "Food", color: "#1", lines: [{ id: "groceries", name: "Groceries", planned: 100 }] }] },
  transactions: [], accounts: [acct("chk", "Checking"), acct("card", "Card", { type: "credit_card" })], transfers: [],
  transactionInboxDrafts: [], transactionInboxDone: [], ...overrides
});

test("reviewDrafts recomputes duplicate/refund/transfer/confidence/rule live and hides rows already marked done", () => {
  const state = baseState({
    transactions: [{ date: "2026-07-01", payee: "SAMPLE MARKET", amount: 20, lineId: "groceries", accountId: "chk" }, { date: "2026-07-05", payee: "Card payment", amount: 300, lineId: "", accountId: "chk" }],
    transactionInboxDrafts: [
      { id: "d1", payee: "SAMPLE MARKET", amount: 20, date: "2026-07-02", lineId: "groceries", accountId: "chk" },
      { id: "d2", payee: "Payment received", amount: -300, date: "2026-07-05", lineId: "", accountId: "card" },
      { id: "d3", payee: "Already handled", amount: 1, date: "2026-07-05", lineId: "" }
    ],
    transactionInboxDone: ["d3"], transactionCategorizationRules: { samplemarket: "groceries" }
  });
  const reviews = reviewDrafts(state);
  assert.deepEqual(reviews.map((r) => r.id), ["d1", "d2"]);
  assert.equal(reviews[0].possibleDuplicate, true);
  assert.equal(reviews[0].categorizationRuleLineId, "groceries");
  assert.deepEqual(reviews[0].categorizationConfidence, { lineId: "groceries", confidence: 100, sampleSize: 1 });
  assert.equal(reviews[1].transferMatch.payee, "Card payment");
  assert.equal(reviews[1].categorizationConfidence, null);
  assert.deepEqual(pendingDraftCountsByAccount(reviews), { chk: 1, card: 1 });
});

test("acceptDraft moves a draft into the ledger with a line snapshot and memo, marks it done, and logs activity; unassigned stays unassigned", () => {
  const state = baseState({ transactionInboxDrafts: [{ id: "d1", payee: "SAMPLE MARKET", amount: 20, date: "2026-07-02", lineId: "groceries", accountId: "chk", tags: ["a"], orderNumber: "O1" }, { id: "d2", payee: "Mystery", amount: 5, date: "2026-07-03", lineId: "", recurringId: "r1" }] });
  const first = acceptDraft(state, "d1");
  assert.equal(first.ok, true);
  assert.deepEqual(first.state.transactions[0], { date: "2026-07-02", payee: "SAMPLE MARKET", amount: 20, lineId: "groceries", memo: "Accepted bank stream item", accountId: "chk", orderNumber: "O1", tags: ["a"], categoryName: "Food", subcategoryName: "Groceries" });
  assert.deepEqual(first.state.transactionInboxDone, ["d1"]);
  assert.deepEqual(first.state.transactionInboxDrafts.map((d) => d.id), ["d2"]);
  assert.equal(first.state.household.activity[0], "Assigned SAMPLE MARKET to Food - Groceries");
  assert.equal(state.transactions.length, 0, "never mutates the input");
  const second = acceptDraft(first.state, "d2");
  assert.equal(second.state.transactions[0].lineId, "");
  assert.equal(second.state.transactions[0].memo, "Recurring bill");
  assert.equal(second.state.household.activity[0], "Assigned Mystery to no category");
  assert.equal(acceptDraft(second.state, "d2").ok, false);
});

test("acceptDraft refuses a date after a closed account's close date, and allows a backdated one", () => {
  const closed = baseState({ accounts: [acct("chk", "Old checking", { closedAt: "2026-06-30" })], transactionInboxDrafts: [{ id: "late", payee: "Late", amount: 5, date: "2026-07-02", lineId: "", accountId: "chk" }, { id: "early", payee: "Early", amount: 5, date: "2026-06-15", lineId: "", accountId: "chk" }] });
  const late = acceptDraft(closed, "late");
  assert.equal(late.ok, false);
  assert.match(late.error, /Old checking is closed - "Late" is dated after its close date/);
  assert.equal(acceptDraft(closed, "early").ok, true);
});

test("dismissDraft removes the row, records it as done and logs it", () => {
  const state = baseState({ transactionInboxDrafts: [{ id: "d1", payee: "Nope", amount: 5, date: "2026-07-02", lineId: "" }] });
  const next = dismissDraft(state, "d1");
  assert.deepEqual(next.transactionInboxDrafts, []);
  assert.deepEqual(next.transactionInboxDone, ["d1"]);
  assert.equal(next.household.activity[0], "Dismissed bank stream item: Nope");
  assert.equal(dismissDraft(next, "d1").transactionInboxDone.length, 1);
});

test("updateDraft changes fields, clears the matching 'from history' mark when a value is hand-picked, and rejects a closed-account date", () => {
  const state = baseState({ accounts: [acct("chk", "Chk"), acct("old", "Old", { closedAt: "2026-06-30" })], transactionInboxDrafts: [{ id: "d1", payee: "P", amount: 5, date: "2026-07-02", lineId: "x", accountId: "chk", historyMatch: true, accountHistoryMatch: true }] });
  const lineChange = updateDraft(state, "d1", { lineId: "groceries" });
  assert.equal(lineChange.state.transactionInboxDrafts[0].lineId, "groceries");
  assert.equal(lineChange.state.transactionInboxDrafts[0].historyMatch, false);
  assert.equal(lineChange.state.transactionInboxDrafts[0].accountHistoryMatch, true);
  const payeeChange = updateDraft(state, "d1", { payee: "Renamed", amount: 9 });
  assert.equal(payeeChange.state.transactionInboxDrafts[0].historyMatch, true);
  assert.equal(payeeChange.state.transactionInboxDrafts[0].amount, 9);
  const badAccount = updateDraft(state, "d1", { accountId: "old" });
  assert.equal(badAccount.ok, false);
  assert.match(badAccount.error, /Old is closed - this item is dated after its close date/);
  const okAccount = updateDraft(state, "d1", { accountId: "old", date: "2026-06-10" });
  assert.equal(okAccount.ok, true);
  assert.equal(okAccount.state.transactionInboxDrafts[0].accountHistoryMatch, false);
  assert.equal(updateDraft(okAccount.state, "d1", { date: "2026-07-20" }).ok, false);
  assert.equal(updateDraft(state, "nope", { payee: "x" }).ok, false);
});

test("clearDraftsForAccount hard-deletes only that account's unreviewed rows, without marking them done", () => {
  const state = baseState({ transactionInboxDrafts: [{ id: "a", lineId: "", accountId: "chk" }, { id: "b", lineId: "", accountId: "card" }, { id: "c", lineId: "", accountId: "chk" }, { id: "d", lineId: "" }] });
  const { state: next, removed } = clearDraftsForAccount(state, "chk");
  assert.equal(removed, 2);
  assert.deepEqual(next.transactionInboxDrafts.map((d) => d.id), ["b", "d"]);
  assert.deepEqual(next.transactionInboxDone, []);
  const none = clearDraftsForAccount(next, "chk");
  assert.equal(none.removed, 0);
  assert.equal(none.state, next);
});

test("moveDraftToTransfer builds a transfer in the right direction and clears the matching counterpart (ledger or draft) on the chosen account only", () => {
  const ledgerCounterpart = { date: "2026-07-05", payee: "Payment received", amount: -300, lineId: "", accountId: "card" };
  const state = baseState({ transactions: [ledgerCounterpart], transactionInboxDrafts: [{ id: "pay", payee: "Card payment", amount: 300, date: "2026-07-05", lineId: "", accountId: "chk" }] });
  const out = moveDraftToTransfer(state, "pay", "card", "  Card payment ", () => "t1");
  assert.equal(out.ok, true);
  assert.deepEqual(out.state.transfers[0], { id: "t1", date: "2026-07-05", fromAccountId: "chk", toAccountId: "card", amount: 300, memo: "Card payment" });
  assert.deepEqual(out.state.transactions, [], "the offsetting ledger entry is cleared");
  assert.deepEqual(out.state.transactionInboxDrafts, []);
  assert.deepEqual(out.state.transactionInboxDone, ["pay"]);
  assert.equal(out.state.household.activity[0], "Moved Card payment to Transfers");
  const other = moveDraftToTransfer(state, "pay", "chk2", "", () => "t2");
  assert.equal(other.ok, true);
  assert.equal(other.state.transactions.length, 1, "a counterpart on a different account than the one chosen is left alone");
  const draftCounterpart = baseState({ transactionInboxDrafts: [{ id: "in", payee: "Cash advance", amount: 300, date: "2026-07-05", lineId: "", accountId: "card" }, { id: "money-in", payee: "Deposit", amount: -300, date: "2026-07-05", lineId: "", accountId: "chk" }] });
  const incoming = moveDraftToTransfer(draftCounterpart, "money-in", "card", "", () => "t3");
  assert.deepEqual(incoming.state.transfers[0], { id: "t3", date: "2026-07-05", fromAccountId: "card", toAccountId: "chk", amount: 300, memo: "Deposit" });
  assert.deepEqual(incoming.state.transactionInboxDrafts, []);
  assert.deepEqual(incoming.state.transactionInboxDone.sort(), ["in", "money-in"]);
});

test("moveDraftToTransfer needs an account on the draft and a different counterpart", () => {
  const state = baseState({ transactionInboxDrafts: [{ id: "x", payee: "P", amount: 5, date: "2026-07-05", lineId: "" }, { id: "y", payee: "Q", amount: 5, date: "2026-07-05", lineId: "", accountId: "chk" }] });
  assert.match(moveDraftToTransfer(state, "x", "card", "", () => "t").error, /Set an account on "P"/);
  assert.equal(moveDraftToTransfer(state, "y", "chk", "", () => "t").error, "Pick a different account.");
  assert.equal(moveDraftToTransfer(state, "y", "", "", () => "t").error, "Pick a different account.");
  assert.equal(moveDraftToTransfer(state, "gone", "card", "", () => "t").ok, false);
});

test("a draft's tags can be edited through updateDraft and carry onto the ledger transaction when accepted", () => {
  const state = baseState({ transactionInboxDrafts: [{ id: "d1", payee: "Resort", amount: 300, date: "2026-07-02", lineId: "groceries", tags: ["Florida trip"] }] });
  const tagged = updateDraft(state, "d1", { tags: ["Florida trip", "Beach"] });
  assert.deepEqual(tagged.state.transactionInboxDrafts[0].tags, ["Florida trip", "Beach"]);
  assert.deepEqual(updateDraft(tagged.state, "d1", { tags: [] }).state.transactionInboxDrafts[0].tags, []);
  const accepted = acceptDraft(tagged.state, "d1");
  assert.deepEqual(accepted.state.transactions[0].tags, ["Florida trip", "Beach"]);
});
