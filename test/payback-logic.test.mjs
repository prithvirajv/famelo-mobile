import test from "node:test";
import assert from "node:assert/strict";
import { paybackAutoMatch, foundRepayments, applyPayback, removePayback, statementGaps, monthRunsLabel, stuckPendingAccounts, bankSyncOkText, householdSizeBreakdown } from "../src/paybackLogic.ts";

const charge = (extra = {}) => ({ id: "c1", date: "2026-09-08", payee: "IXL FAMILY SUBSCRIPT 650-372-4", amount: 419.25, lineId: "learning", ...extra });
const dep = (id, extra = {}) => ({ id, date: "2026-09-08", payee: "Zelle payment from Alex IXL share 2026", amount: -42, lineId: "income", ...extra });

test("a repayment is matched only when its note names exactly one merchant charge it fits", () => {
  const rows = [charge(), dep("d1")];
  assert.equal(paybackAutoMatch(rows[1], rows), rows[0]);
  assert.equal(paybackAutoMatch(dep("d2", { payee: "Zelle payment from Sam dinner" }), [charge(), dep("d2", { payee: "Zelle payment from Sam dinner" })]), null);
  assert.equal(paybackAutoMatch(dep("d3", { payee: "Transfer IXL, a PayPal Service", amount: -0.01 }), [charge()]), null, "a one-cent transfer");
  const both = [charge(), charge({ id: "c2", date: "2026-09-09" }), dep("d4")];
  assert.equal(paybackAutoMatch(both[2], both), null, "two charges from the same merchant is a question");
});

test("deposits already in the ledger are found, grouped and linked, and undo restores them", () => {
  const rows = [charge(), dep("d1"), dep("d2"), dep("d3", { payee: "Zelle payment from Dee dinner" })];
  const found = foundRepayments(rows, "2026-11-24");
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].rows.map((row) => row.id), ["d1", "d2"]);
  assert.equal(found[0].share, 335.25);
  assert.equal(applyPayback(found[0].charge, found[0].rows).linked, 2);
  assert.equal(rows[1].lineId, "learning");
  assert.deepEqual(foundRepayments(rows, "2026-11-24"), [], "linked ones are not offered again");
  assert.equal(removePayback(rows[1]), true);
  assert.equal(rows[1].lineId, "income");
});

const accounts = [{ id: "a", name: "DCU", type: "checking" }, { id: "b", name: "Card", type: "credit_card" }];
const monthRows = (accountId, months) => months.flatMap((month) => [1, 2].map((day) => ({ accountId, date: `${month}-0${day}`, amount: 5 })));

test("statement gaps list months between an account's first and last record, and clear as rows arrive", () => {
  const transactions = [...monthRows("a", ["2026-01", "2026-04", "2026-07", "2026-08", "2026-09", "2026-10"]), ...monthRows("b", ["2026-08", "2026-09", "2026-10"])];
  const gaps = statementGaps({ accounts, transactions, drafts: [], notices: [], ignored: [], today: "2026-11-23" });
  assert.deepEqual(gaps.map((gap) => [gap.accountName, monthRunsLabel(gap.months)]), [["DCU", "Feb–Mar, May–Jun 2026"]]);
  assert.deepEqual(statementGaps({ accounts, transactions, drafts: monthRows("a", ["2026-02", "2026-03", "2026-05", "2026-06"]), notices: [], ignored: [], today: "2026-11-23" }), []);
  assert.deepEqual(statementGaps({ accounts, transactions, drafts: [], notices: [], ignored: ["a|2026-02", "a|2026-03"], today: "2026-11-23" })[0].months, ["2026-05", "2026-06"]);
});

test("stuck pending rows, the calm sync line and the storage breakdown", () => {
  assert.deepEqual(stuckPendingAccounts([{ id: "a", name: "Card", pendingRows: [{ date: "2026-11-20" }, { date: "2026-11-23" }] }], "2026-11-24"), [{ accountId: "a", name: "Card", count: 1, oldest: "2026-11-20" }]);
  const link = { status: "active", mappings: { a: { accountId: "x" } }, lastRun: { at: "2026-11-24T08:30:00Z", ok: true, stage: "applied", added: 4 } };
  assert.equal(bankSyncOkText([link], 8, () => "Tue 3:30 AM"), "Bank sync: last ran Tue 3:30 AM, 4 new transactions added, all loaded; 8 still pending at the bank.");
  assert.equal(bankSyncOkText([{ ...link, lastRun: { at: "x", ok: false, stage: "apply" } }], 0, () => ""), "");
  const breakdown = householdSizeBreakdown({ transactions: Array.from({ length: 3000 }, (_, i) => ({ payee: `P${i}` })), tiny: { a: 1 } });
  assert.equal(breakdown[0].key, "transactions");
  assert.ok(!breakdown.some((entry) => entry.key === "tiny"));
});
