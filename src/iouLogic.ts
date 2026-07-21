import type { Iou, IouDirection } from "./types";

// Same algorithm as the web app's uniqueId (here-s-a-prompt-you-can/app.js) -
// mobile had no id-generator at all before this, so IOU/friend records need
// one to create client-side ids before saving.
export function uniqueId(seed: string): string {
  return String(seed || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 7);
}

export function isValidEmail(value: string | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizePersonName(name: string | undefined): string {
  return String(name || "").trim().toLowerCase();
}

// Splits totalAmount into `count` shares that always sum back to exactly
// totalAmount (to the cent), unlike a naive totalAmount / count which drops
// or invents fractions of a cent on amounts that don't divide evenly. Works
// in integer cents and hands the leftover pennies to the first few shares
// rather than losing them to rounding.
export function splitAmountEvenly(totalAmount: number, count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const totalCents = Math.round(Number(totalAmount || 0) * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;
  return Array.from({ length: count }, (_, index) => (baseCents + (index < remainderCents ? 1 : 0)) / 100);
}

// Splits totalAmount by percentage shares using the largest-remainder
// method: unlike splitAmountEvenly's "leftover cents to the first entries"
// (fine when every share is equal), percentage shares are often uneven
// (e.g. 90/10), so leftover pennies instead go to whichever entries have the
// largest fractional-cent remainder. Returns null (not throwing) if the
// percentages don't sum to ~100 (a small tolerance allows entries like
// 33.33/33.33/33.34).
export function splitBillByPercentages(totalAmount: number, percentages: number[]): number[] | null {
  if (!Array.isArray(percentages) || !percentages.length) return null;
  const percentSum = percentages.reduce((sum, pct) => sum + Number(pct || 0), 0);
  if (Math.abs(percentSum - 100) > 0.05) return null;
  const totalCents = Math.round(Number(totalAmount || 0) * 100);
  const rawShares = percentages.map((pct) => (totalCents * Number(pct || 0)) / 100);
  const cents = rawShares.map((share) => Math.floor(share));
  let remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const byLargestFraction = rawShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < byLargestFraction.length && remainder > 0; i++) {
    const entry = byLargestFraction[i];
    if (!entry) continue;
    cents[entry.index] = (cents[entry.index] ?? 0) + 1;
    remainder -= 1;
  }
  return cents.map((value) => value / 100);
}

export type BillSplitParticipant = { amount?: number; percent?: number };
export type BillSplitResult =
  | { ok: true; friendAmounts: number[]; payerAmount: number }
  | { ok: false; error: string };

// Computes each friend's dollar share of a bill, given the payer is always
// an implicit extra participant (friends.length + 1 people total, Splitwise-
// style) - `participants` holds the friend rows only, one per friend, never
// including the payer. payerAmount is always totalAmount minus the sum of
// friendAmounts (never independently computed), so the two reconcile to the
// cent regardless of split type or rounding.
export function computeBillSplitAmounts(splitType: "equal" | "exact" | "percentage", totalAmount: number, participants: BillSplitParticipant[]): BillSplitResult {
  const total = Number(totalAmount || 0);
  const list = Array.isArray(participants) ? participants : [];
  if (!list.length) return { ok: false, error: "Add at least one person to split with." };

  let friendAmounts: number[];
  if (splitType === "equal") {
    friendAmounts = splitAmountEvenly(total, list.length + 1).slice(0, list.length);
  } else if (splitType === "percentage") {
    const friendPercentages = list.map((row) => Number(row.percent || 0));
    const friendPercentTotal = friendPercentages.reduce((sum, pct) => sum + pct, 0);
    if (friendPercentTotal <= 0 || friendPercentTotal > 100) {
      return { ok: false, error: "Friends' percentages must add up to more than 0% and no more than 100%." };
    }
    const allAmounts = splitBillByPercentages(total, [...friendPercentages, 100 - friendPercentTotal]);
    if (!allAmounts) return { ok: false, error: "Percentages must add up to 100%." };
    friendAmounts = allAmounts.slice(0, list.length);
  } else {
    friendAmounts = list.map((row) => Number(row.amount) || 0);
  }

  const friendTotal = friendAmounts.reduce((sum, amount) => sum + amount, 0);
  if (friendTotal > total + 0.005) {
    return { ok: false, error: `Splits add up to more than the ${total.toFixed(2)} total.` };
  }
  const payerAmount = Math.round((total - friendTotal) * 100) / 100;
  return { ok: true, friendAmounts, payerAmount };
}

export type NetBalanceDirection = IouDirection | "settled";
export type NetBalanceGroup = { key: string; label: string; net: number; direction: NetBalanceDirection; records: Iou[] };

// Groups unsettled IOUs by normalized person name, netting owed_to_me (+)
// against i_owe (-) for the same person - e.g. one i_owe $20 record and one
// owed_to_me $32 record for "Sam" collapse into one +12 (owed_to_me)
// balance, the way Splitwise shows one running balance per friend rather
// than a flat list. `records` keeps *references* to the original iou
// objects (not copies) so a caller can key UI actions off iou.id. A net of
// exactly zero (offsetting records that happen to cancel out) is reported
// as direction "settled" even though the underlying records aren't
// individually marked settled - there's nothing left to settle up.
export function netBalancesByPerson(ious: Iou[] | undefined): NetBalanceGroup[] {
  const groups = new Map<string, { key: string; label: string; net: number; records: Iou[] }>();
  (ious || []).forEach((iou) => {
    if (iou.settled) return;
    const key = normalizePersonName(iou.person);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, { key, label: String(iou.person).trim(), net: 0, records: [] });
    const group = groups.get(key);
    if (!group) return;
    group.net += iou.direction === "owed_to_me" ? Number(iou.amount || 0) : -Number(iou.amount || 0);
    group.records.push(iou);
  });
  return [...groups.values()]
    .map((group) => {
      const net = Math.round(group.net * 100) / 100;
      const direction: NetBalanceDirection = net > 0.004 ? "owed_to_me" : net < -0.004 ? "i_owe" : "settled";
      return { ...group, net, direction };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export type SettleUpResult =
  | { ok: true; ious: Iou[]; settledIds: string[] }
  | { ok: false; error: string };

// Settles up to settleAmount of a person's *net* outstanding balance, oldest
// record first, only touching records in the person's net direction (the
// offsetting direction's records already netted out of the displayed
// balance and are left untouched here). When the amount doesn't land on a
// whole-record boundary, the last touched record is split into a settled
// portion + an unsettled remainder (same accountId/direction/date/person, a
// new id for the remainder) - this keeps any per-record settled/amount reads
// correct without needing person-aware logic elsewhere. Rejects (ok:false)
// if the amount exceeds the person's net balance, and never mutates the
// input array.
export function settleUpPersonIous(ious: Iou[], personName: string, settleAmount: number, settledDate: string, createRemainderId?: (iou: Iou) => string): SettleUpResult {
  const amount = Number(settleAmount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter a positive amount to settle." };
  const balance = netBalancesByPerson(ious).find((group) => group.key === normalizePersonName(personName));
  if (!balance || balance.direction === "settled") {
    return { ok: false, error: "There's no outstanding balance with this person." };
  }
  if (amount > Math.abs(balance.net) + 0.005) {
    return { ok: false, error: `That's more than the ${Math.abs(balance.net).toFixed(2)} outstanding balance.` };
  }

  const targetRecords = balance.records
    .filter((iou) => iou.direction === balance.direction)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id)));

  let remainingCents = Math.round(amount * 100);
  const settledCentsById = new Map<string, number>();
  targetRecords.forEach((iou) => {
    if (remainingCents <= 0) return;
    const iouCents = Math.round(Number(iou.amount || 0) * 100);
    const applied = Math.min(iouCents, remainingCents);
    settledCentsById.set(iou.id, applied);
    remainingCents -= applied;
  });

  const settledIds: string[] = [];
  const result: Iou[] = [];
  (ious || []).forEach((iou) => {
    const settledCents = settledCentsById.get(iou.id);
    if (settledCents === undefined) {
      result.push(iou);
      return;
    }
    settledIds.push(iou.id);
    const iouCents = Math.round(Number(iou.amount || 0) * 100);
    if (settledCents >= iouCents) {
      result.push({ ...iou, settled: true, settledDate });
    } else {
      result.push({ ...iou, amount: settledCents / 100, settled: true, settledDate });
      const remainderId = createRemainderId ? createRemainderId(iou) : `${iou.id}-remainder`;
      result.push({ ...iou, id: remainderId, amount: (iouCents - settledCents) / 100, settled: false, settledDate: "" });
    }
  });
  return { ok: true, ious: result, settledIds };
}

// Every distinct person named on an IOU record that isn't already a real
// Friend entry - a name-only debt (no email) never creates a Friend record
// on its own since there's no email to invite, so these show up as a way to
// add one after the fact (mirrors web's friendsWithoutEmailFromIous).
export function friendsWithoutEmailFromIous(ious: Iou[] | undefined, knownNames: Set<string>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  (ious || []).forEach((iou) => {
    const key = normalizePersonName(iou.person);
    if (!key || knownNames.has(key) || seen.has(key)) return;
    seen.add(key);
    names.push(String(iou.person).trim());
  });
  return names;
}
