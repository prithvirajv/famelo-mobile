import assert from "node:assert/strict";
import test from "node:test";
import { autoContributeChoice, setAutoContributeMode, setAutoContributePercent, roundupAmount, applyGoalAutoContributions, withGoalAutoContributions } from "../src/goalsLogic.ts";

const fund = (overrides = {}) => ({ name: "Trip", target: 1000, saved: 100, targetDate: "", ...overrides });
const txn = (amount) => ({ date: "2026-07-01", payee: "p", lineId: "l", amount });

test("autoContributeChoice reads off/roundup/percent, treating web's mode-less { enabled: false } as off", () => {
  assert.equal(autoContributeChoice(fund()), "off");
  assert.equal(autoContributeChoice(fund({ autoContribute: { enabled: false } })), "off");
  assert.equal(autoContributeChoice(fund({ autoContribute: { enabled: true, mode: "roundup" } })), "roundup");
  assert.equal(autoContributeChoice(fund({ autoContribute: { enabled: true, mode: "percent", percent: 10 } })), "percent");
});

test("setAutoContributeMode matches web: off stores { enabled: false }; on defaults the percent to 5 but keeps an existing one", () => {
  assert.deepEqual(setAutoContributeMode(fund({ autoContribute: { enabled: true, mode: "percent", percent: 12 } }), "off").autoContribute, { enabled: false });
  assert.deepEqual(setAutoContributeMode(fund(), "roundup").autoContribute, { enabled: true, mode: "roundup", percent: 5 });
  assert.deepEqual(setAutoContributeMode(fund({ autoContribute: { enabled: false, percent: 20 } }), "percent").autoContribute, { enabled: true, mode: "percent", percent: 20 });
});

test("setAutoContributePercent clamps to 0-100 and does nothing when auto-contribute was never set", () => {
  const on = fund({ autoContribute: { enabled: true, mode: "percent", percent: 5 } });
  assert.equal(setAutoContributePercent(on, 250).autoContribute.percent, 100);
  assert.equal(setAutoContributePercent(on, -4).autoContribute.percent, 0);
  assert.equal(setAutoContributePercent(on, 7.5).autoContribute.percent, 7.5);
  const bare = fund();
  assert.equal(setAutoContributePercent(bare, 10), bare);
});

test("roundupAmount rounds only positive purchases up to the next dollar and ignores refunds and exact dollars", () => {
  assert.equal(Math.round(roundupAmount([txn(4.25), txn(10), txn(-3.4), txn(0.5)]) * 100) / 100, 1.25);
});

test("roundup credits only the NEWEST transactions (they are added at the front), then never double-credits on a re-run", () => {
  const f = fund({ autoContribute: { enabled: true, mode: "roundup" }, roundupProcessedCount: 2 });
  // list is newest-first: two new rows (4.25, 1.10) in front of two already-counted rows
  const transactions = [txn(4.25), txn(1.10), txn(9.99), txn(7.01)];
  const first = applyGoalAutoContributions({ transactions }, [f], "2026-07-01");
  assert.equal(first.changed, true);
  assert.equal(first.sinkingFunds[0].saved, 101.65);
  assert.equal(first.sinkingFunds[0].roundupProcessedCount, 4);
  const second = applyGoalAutoContributions({ transactions }, first.sinkingFunds, "2026-07-01");
  assert.equal(second.changed, false);
  assert.equal(second.sinkingFunds, first.sinkingFunds);
});

test("a freshly enabled roundup (no watermark yet) counts every existing purchase once, like web", () => {
  const f = fund({ autoContribute: { enabled: true, mode: "roundup" } });
  const result = applyGoalAutoContributions({ transactions: [txn(2.5), txn(3.5)] }, [f], "2026-07-01");
  assert.equal(result.sinkingFunds[0].saved, 101);
  assert.equal(result.sinkingFunds[0].roundupProcessedCount, 2);
});

test("deleting transactions lowers the roundup watermark instead of leaving it stuck high", () => {
  const f = fund({ autoContribute: { enabled: true, mode: "roundup" }, roundupProcessedCount: 5 });
  const afterDelete = applyGoalAutoContributions({ transactions: [txn(1.5), txn(2.5)] }, [f], "2026-07-01");
  assert.equal(afterDelete.sinkingFunds[0].roundupProcessedCount, 2);
  assert.equal(afterDelete.sinkingFunds[0].saved, 100);
  const afterAdd = applyGoalAutoContributions({ transactions: [txn(0.25), txn(1.5), txn(2.5)] }, afterDelete.sinkingFunds, "2026-07-01");
  assert.equal(afterAdd.sinkingFunds[0].saved, 100.75);
});

test("percent credits each received paycheck occurrence once, skips future ones and a zero percent, and remembers processed ids", () => {
  const f = fund({ autoContribute: { enabled: true, mode: "percent", percent: 10 } });
  const paycheckOccurrences = [
    { id: "o1", seriesId: "s", date: "2026-06-15", amount: 2000 },
    { id: "o2", seriesId: "s", date: "2026-07-01", amount: 1000 },
    { id: "o3", seriesId: "s", date: "2026-08-01", amount: 5000 }
  ];
  const first = applyGoalAutoContributions({ transactions: [], paycheckOccurrences }, [f], "2026-07-01");
  assert.equal(first.sinkingFunds[0].saved, 400);
  assert.deepEqual(first.sinkingFunds[0].percentProcessedOccurrenceIds, ["o1", "o2"]);
  assert.equal(applyGoalAutoContributions({ transactions: [], paycheckOccurrences }, first.sinkingFunds, "2026-07-01").changed, false);
  const later = applyGoalAutoContributions({ transactions: [], paycheckOccurrences }, first.sinkingFunds, "2026-08-02");
  assert.equal(later.sinkingFunds[0].saved, 900);
  const zero = fund({ autoContribute: { enabled: true, mode: "percent", percent: 0 } });
  assert.equal(applyGoalAutoContributions({ transactions: [], paycheckOccurrences }, [zero], "2026-09-01").changed, false);
});

test("goals with auto-contribute off are never touched, and withGoalAutoContributions returns the same state when nothing changes", () => {
  const state = { transactions: [txn(1.5)], paycheckOccurrences: [], goals: { sinkingFunds: [fund()] } };
  assert.equal(withGoalAutoContributions(state, "2026-07-01"), state);
  const on = { ...state, goals: { sinkingFunds: [fund({ autoContribute: { enabled: true, mode: "roundup" } })] } };
  const next = withGoalAutoContributions(on, "2026-07-01");
  assert.notEqual(next, on);
  assert.equal(next.goals.sinkingFunds[0].saved, 100.5);
  assert.equal(on.goals.sinkingFunds[0].saved, 100);
});
