import assert from "node:assert/strict";
import test from "node:test";
import { homeBriefingFacts } from "../src/homeLogic.ts";

const state = {
  household: { name: "H", country: "US", currency: "USD", activity: [] },
  budget: { month: "2026-10", income: 0, categories: [
    { name: "Food", color: "", lines: [{ id: "groceries", name: "Groceries", planned: 100 }, { id: "dining", name: "Dining", planned: 50 }] },
    { name: "Home", color: "", lines: [{ id: "rent", name: "Rent", planned: 1000, dueDay: 1 }] }
  ] },
  accounts: [], transactionInboxDrafts: [{ id: "a" }, { id: "b" }], transactionInboxDone: [],
  transactions: [
    { date: "2026-10-03", payee: "A", amount: 130, lineId: "groceries" },
    { date: "2026-10-04", payee: "B", amount: 20, lineId: "dining" },
    { date: "2026-10-05", payee: "C", amount: 15, lineId: "" },
    { date: "2026-09-30", payee: "D", amount: 500, lineId: "rent" }
  ]
};
const input = (overrides = {}) => ({
  today: new Date(2026, 9, 26), planned: 1150, currency: "USD", actionItems: [], weekStrip: [], funding: [], planTasks: [], balances: [],
  spentOfLine: (lineId, monthKey) => state.transactions.filter((t) => t.lineId === lineId && t.date.startsWith(monthKey)).reduce((sum, t) => sum + t.amount, 0),
  formatMoney: (n) => `$${n.toFixed(0)}`, ...overrides
});

test("home briefing facts state this month's spending, overages and what is waiting, from the household's own numbers", () => {
  const { text, chips } = homeBriefingFacts(state, input());
  assert.match(text, /Today is Monday, October 26, 2026\./);
  assert.match(text, /\$165 spent of \$1150 planned \(\$150 on budget lines \+ \$15 of expenses with no category yet\); day 26 of 31/, "only this month's transactions count");
  assert.match(text, /Biggest categories this month: Food \$150, Uncategorized \$15\./);
  assert.match(text, /Over budget: Groceries by \$30\./);
  assert.match(text, /2 imported transactions are waiting for review in Bank stream\./);
  assert.match(text, /1 ledger transaction has no category yet\./);
  assert.match(text, /Nothing is past due or due today\./);
  assert.deepEqual(chips, ["$165 of $1150 spent", "2 in Bank stream", "1 need a category"]);
});

test("home briefing facts list what needs attention, what is coming up and account balances, and stay inside the size cap", () => {
  const { text, chips } = homeBriefingFacts(state, input({
    actionItems: [{ title: "Mimi birthday", label: "Birthday", overdue: true }],
    weekStrip: [{ label: "Wed 28", items: [{ title: "Rent" }] }, { label: "Thu 29", items: [] }],
    balances: [{ name: "Checking", type: "checking", balance: 2380 }],
    funding: [{ title: "Rent payoff due", detail: "Due day 1", amount: 500 }],
    planTasks: [{ done: true }, { done: false }]
  }));
  assert.match(text, /Needs attention today: Mimi birthday \(Birthday, past due\)\./);
  assert.match(text, /Coming up this week: Wed 28: Rent\./);
  assert.match(text, /Accounts: Checking \(checking\) \$2380\./);
  assert.match(text, /Rent payoff due - Due day 1 \$500 left/);
  assert.match(text, /plan today has 2 tasks, 1 done/);
  assert.ok(chips.includes("1 needs attention"));
  const long = homeBriefingFacts(state, input({ funding: Array.from({ length: 5 }, () => ({ title: "x".repeat(2000), detail: "d", amount: 1 })) }));
  assert.ok(long.text.length <= 5800);
});

test("money coming in (a card payment received, a deposit) is not subtracted from what was spent", () => {
  const withCredits = { ...state, transactions: [...state.transactions,
    { date: "2026-10-06", payee: "ONLINE PAYMENT THANK YOU", amount: -4000, lineId: "" },
    { date: "2026-10-07", payee: "DEPOSIT", amount: -300, lineId: "" },
    { date: "2026-10-08", payee: "REFUND", amount: -10, lineId: "groceries" }
  ] };
  const { text, chips } = homeBriefingFacts(withCredits, input({ spentOfLine: (lineId, monthKey) => withCredits.transactions.filter((t) => t.lineId === lineId && t.date.startsWith(monthKey)).reduce((sum, t) => sum + t.amount, 0) }));
  assert.match(text, /\$155 spent of \$1150 planned \(\$140 on budget lines \+ \$15 of expenses with no category yet\)/, "a refund on a line nets against it; the payment and the deposit do not count at all");
  assert.equal(chips[0], "$155 of $1150 spent");
  assert.doesNotMatch(text, /Uncategorized -/);
});
