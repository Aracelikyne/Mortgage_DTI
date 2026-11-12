import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeRunningBalance, computeAllRunningBalances, autopayDebitsSince, allocateMaxCashFlow, allocateExtra, fastestStrategyForBoost,
  projectPayoff, monthlyOutflow, scheduledPayments,
  getPaymentRecord, clearPaymentRecord, addExtraPayments, removeExtraBatch, latestExtraBatch,
  suggestExtraAllocation, buildPaycheckPlan, simulatePayoff, derivedBillExpenses, isoDate,
} from "./finance";

// 36.5% APR is exactly 0.1% a day, which keeps the arithmetic readable.
const card = (over = {}) => ({ id: "c", name: "Card", balance: 1000, apr: 36.5, monthly: 50, ...over });

describe("computeRunningBalance", () => {
  it("accrues interest daily since the anchor date (2026-08-22)", () => {
    const rb = computeRunningBalance(card(), [{ amount: 100, date: "2026-09-01" }]);
    // 10 days × 0.1% × $1,000 = $10 interest, $90 principal
    expect(rb.balance).toBeCloseTo(910, 6);
    expect(rb.principalPaid).toBeCloseTo(90, 6);
  });

  it("charges the same interest whether a bill is paid in one payment or several the same day", () => {
    const once = computeRunningBalance(card(), [{ amount: 300, date: "2026-09-01" }]);
    const split = computeRunningBalance(card(), [
      { amount: 100, date: "2026-09-01" },
      { amount: 100, date: "2026-09-01" },
      { amount: 100, date: "2026-09-01" },
    ]);
    expect(split.balance).toBeCloseTo(once.balance, 6);
    expect(once.balance).toBeCloseTo(710, 6);
  });

  it("charges interest for the days between payments, not a month per payment", () => {
    const rb = computeRunningBalance(card(), [
      { amount: 100, date: "2026-09-11" },
      { amount: 100, date: "2026-09-01" }, // out of order on purpose
      { amount: 100, date: "2026-09-21" },
    ]);
    // 10 days each: 1000→1010-100=910 → 919.1-100=819.1 → 827.291-100=727.291
    expect(rb.balance).toBeCloseTo(727.291, 6);
  });

  it("ignores payments on or before the anchor date — they're already in the stored balance", () => {
    const rb = computeRunningBalance(card(), [{ amount: 500, date: "2026-08-22" }, { amount: 500, date: "2026-08-01" }]);
    expect(rb.balance).toBe(1000);
  });

  it("treats every dollar as principal (flagged as an estimate) when there's no APR", () => {
    const rb = computeRunningBalance(card({ apr: null }), [{ amount: 100, date: "2026-10-01" }]);
    expect(rb.balance).toBe(900);
    expect(rb.isEstimate).toBe(true);
  });

  it("flags a payment that doesn't cover the interest since the last one", () => {
    const rb = computeRunningBalance(card(), [{ amount: 5, date: "2026-09-21" }]); // 30 days → $30 interest
    expect(rb.growing).toBe(true);
    expect(rb.balance).toBeCloseTo(1025, 6);
  });

  it("counts extra payments like any other payment", () => {
    const rb = computeRunningBalance(card({ apr: 0 }), [{ amount: 100, date: "2026-10-01", kind: "extra" }]);
    expect(rb.balance).toBe(900);
  });
});

describe("allocateMaxCashFlow", () => {
  it("applies the exact balance, so a $100.40 balance is paid off rather than left at 40¢", () => {
    const { applied, freedMonthly, leftover } = allocateMaxCashFlow([card({ id: "d", balance: 100.4, monthly: 60 })], 150);
    expect(applied.d).toBeCloseTo(100.4, 6);
    expect(freedMonthly).toBe(60);
    expect(leftover).toBeCloseTo(49.6, 6);
  });

  it("can use cents the whole-dollar knapsack would miss", () => {
    const debts = [card({ id: "a", balance: 500.4, monthly: 60 }), card({ id: "b", balance: 300, monthly: 30 })];
    const { applied, freedMonthly } = allocateMaxCashFlow(debts, 500.4);
    expect(applied.a).toBeCloseTo(500.4, 6);
    expect(applied.b).toBeUndefined();
    expect(freedMonthly).toBe(60);
  });

  it("never spends more than the amount", () => {
    const debts = [card({ id: "a", balance: 299.7, monthly: 40 }), card({ id: "b", balance: 200.95, monthly: 40 }), card({ id: "c2", balance: 120, monthly: 10 })];
    const { applied } = allocateMaxCashFlow(debts, 500.4);
    const spent = Object.values(applied).reduce((s, v) => s + v, 0);
    expect(spent).toBeLessThanOrEqual(500.4 + 1e-9);
  });

  it("coerces string monthly amounts instead of concatenating them", () => {
    const debts = [card({ id: "a", balance: 100, monthly: "25" }), card({ id: "b", balance: 100, monthly: "30" })];
    const { freedMonthly } = allocateMaxCashFlow(debts, 200);
    expect(freedMonthly).toBe(55);
  });

  it("picks the combination that frees the most monthly payment", () => {
    const debts = [
      card({ id: "big", balance: 900, monthly: 40 }),
      card({ id: "s1", balance: 450, monthly: 35 }),
      card({ id: "s2", balance: 450, monthly: 35 }),
    ];
    const { applied, freedMonthly } = allocateMaxCashFlow(debts, 900);
    expect(freedMonthly).toBe(70);
    expect(applied.s1).toBe(450);
    expect(applied.s2).toBe(450);
  });

  it("reports what's left when the amount covers every targetable balance", () => {
    const { leftover } = allocateMaxCashFlow([card({ id: "a", balance: 100, monthly: 10 }), card({ id: "p", balance: 50, protected: true })], 300);
    expect(leftover).toBeCloseTo(200, 6);
  });
});

describe("allocateExtra", () => {
  it("fills in strategy order and returns the leftover", () => {
    const debts = [card({ id: "lo", balance: 100, apr: 5 }), card({ id: "hi", balance: 100, apr: 25 })];
    const { applied, leftover } = allocateExtra(debts, 250, "avalanche");
    expect(applied).toEqual({ hi: 100, lo: 100 });
    expect(leftover).toBe(50);
  });
});

describe("fastestStrategyForBoost", () => {
  it("lets a later strategy win when the first one never reaches debt-free", () => {
    // Tiered pays the big 0% loan first while the small 30% card (minimum
    // below its interest) snowballs out of reach; snowball/avalanche clear
    // the card first and finish inside the 40-year window.
    const debts = [
      { id: "loan", name: "Loan", balance: 100000, apr: 0, monthly: 0, priority: 1 },
      { id: "card", name: "Card", balance: 1000, apr: 30, monthly: 10, priority: 2 },
    ];
    const best = fastestStrategyForBoost(debts, 0, 300, []);
    expect(best.strategy).not.toBe("tiered");
    expect(best.freedomMonth).not.toBeNull();
  });
});

describe("payment records with extras", () => {
  const month = {
    c: { payments: [
      { id: "r", amount: 50, date: "2026-10-01", cleared: true },
      { id: "x", amount: 200, date: "2026-10-02", kind: "extra", batchId: "B1", appliedAt: "2026-10-02T10:00:00Z" },
    ] },
  };

  it("reports regular and extra money separately", () => {
    const rec = getPaymentRecord(month, card());
    expect(rec.amountPaid).toBe(50);
    expect(rec.settledAmount).toBe(50);
    expect(rec.extraPaid).toBe(200);
    expect(rec.payments).toHaveLength(2);
  });

  it("doesn't mark a bill paid with extra money alone", () => {
    const rec = getPaymentRecord({ c: { payments: [month.c.payments[1]] } }, card());
    expect(rec.amountPaid).toBe(0);
    expect(rec.extraPaid).toBe(200);
  });

  it("keeps extras when a bill is marked unpaid", () => {
    const cleared = clearPaymentRecord({ "2026-10": month }, "2026-10", "c");
    expect(cleared["2026-10"].c.payments.map((p) => p.id)).toEqual(["x"]);
  });

  it("applies a batch, finds it as the latest, and undoes the whole batch", () => {
    let pbm = { "2026-10": month };
    pbm = addExtraPayments(pbm, "2026-10", [{ billId: "c", amount: 75 }, { billId: "d", amount: 25 }], { batchId: "B2", date: "2026-10-25", appliedAt: "2026-10-25T18:00:00Z" });
    const latest = latestExtraBatch(pbm);
    expect(latest.batchId).toBe("B2");
    expect(latest.total).toBe(100);
    expect(latest.items.map((i) => i.billId).sort()).toEqual(["c", "d"]);
    const p = pbm["2026-10"].d.payments[0];
    expect(p).toMatchObject({ amount: 25, date: "2026-10-25", kind: "extra", batchId: "B2" });

    const undone = removeExtraBatch(pbm, "B2");
    expect(undone["2026-10"].c.payments.map((x) => x.id)).toEqual(["r", "x"]);
    expect(undone["2026-10"].d.payments).toEqual([]);
    expect(latestExtraBatch(undone).batchId).toBe("B1");
  });

  it("labels extras in the derived expense feed", () => {
    const rows = derivedBillExpenses([card()], [], { "2026-10": month });
    expect(rows.find((r) => r.amount === 200).extra).toBe(true);
    expect(rows.find((r) => r.amount === 50).extra).toBe(false);
  });
});

describe("suggestExtraAllocation", () => {
  it("clears a debt with its whole payoff as of today, paid this month or not", () => {
    const debts = [card({ id: "a", name: "A", balance: 160, monthly: 60, autopay: true })];
    const s = suggestExtraAllocation({ amount: 500, debts });
    expect(s.cashFlow.rows[0]).toMatchObject({ id: "a", applied: 160, newBalance: 0, paidOff: true, autopay: true });
    expect(s.cashFlow.leftover).toBeCloseTo(340, 6);
    expect(s.interestCost.leftover).toBeCloseTo(340, 6);
  });

  it("won't call a debt paid off when the amount only covers the balance after its last payment", () => {
    // $1,000 at 0.1%/day, last paid 10 days ago: payoff today is $1,010.
    const pbm = { "2026-11": { c: { payments: [{ id: "p", amount: 50, date: "2026-11-02" }] } } };
    const d = card({ balance: 1050, balanceAsOf: "2026-11-02", apr: 36.5 });
    const rb = computeAllRunningBalances([d], pbm, new Date(2026, 10, 12)).c;
    expect(rb.balance).toBeCloseTo(1060.5, 6); // 1050 + 10 days × $1.05
    const s = suggestExtraAllocation({ amount: 1050, debts: [{ ...d, balance: rb.balance }] });
    // $1,050 doesn't clear a $1,060.50 payoff — $10.50 is still owed.
    expect(s.cashFlow.rows[0]).toMatchObject({ paidOff: false, newBalance: 10.5 });
    expect(s.cashFlow.freedMonthly).toBe(0);
  });
});

describe("buildPaycheckPlan with extra payments", () => {
  afterEach(() => vi.useRealTimers());

  it("shows an extra as extra and still expects the bill's regular payment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));
    const income = [{ id: "i", name: "Pay", amount: 3000, nextPayDate: "2026-10-17", frequency: "biweekly" }];
    const bills = [{ id: "c", name: "Card", monthly: 50, dueDay: 28, graceDays: 0 }];
    const pbm = { "2026-10": { c: { payments: [{ id: "x", amount: 200, date: "2026-10-20", kind: "extra", batchId: "B" }] } } };
    const plan = buildPaycheckPlan(income, bills, 60, pbm, {}, 0);
    const items = plan.paychecks.flatMap((p) => p.items).filter((it) => it.billId === "c");
    const extra = items.find((it) => it.paymentId === "x");
    expect(extra).toMatchObject({ paid: true, extra: true, amount: 200, monthKey: "2026-10" });
    // the $50 minimum is still planned, unpaid, on a check before the 28th
    expect(items.some((it) => !it.paid && it.amount === 50)).toBe(true);
  });
});

describe("isoDate", () => {
  it("uses the local calendar date, not UTC", () => {
    expect(isoDate(new Date(2026, 9, 25, 23, 30))).toBe("2026-10-25");
    expect(isoDate(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });
});

describe("per-debt payoff anchors and autopay", () => {
  afterEach(() => vi.useRealTimers());

  it("only payments after a debt's own as-of date come off its payoff", () => {
    const d = card({ apr: 0, balanceAsOf: "2026-10-25" });
    const rb = computeRunningBalance(d, [{ amount: 100, date: "2026-10-11" }, { amount: 50, date: "2026-10-30" }]);
    expect(rb.balance).toBe(950);
    expect(rb.paymentsApplied).toBe(1);
    expect(rb.asOf).toBe("2026-10-25");
  });

  it("counts autopay debits since the as-of date, except months logged by hand", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 0, 20));
    const d = card({ id: "w", apr: 0, monthly: 720, dueDay: 26, autopay: true, autopayFrequency: "monthly", balanceAsOf: "2026-10-25" });
    // debits Oct 26, Nov 26, Dec 26 — but December's payment was logged by hand
    const pbm = { "2026-12": { w: { payments: [{ id: "m", amount: 720, date: "2026-12-26" }] } } };
    expect(autopayDebitsSince(d, pbm).map((x) => x.date)).toEqual(["2026-10-26", "2026-11-26"]);
    const rb = computeAllRunningBalances([d], pbm).w;
    expect(rb.balance).toBe(0); // $1,000 payoff, three $720 payments since
  });

  it("follows a biweekly autopay schedule", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20));
    const d = card({ id: "b", apr: 0, autopay: true, autopayFrequency: "biweekly", autopayAnchor: "2026-10-03", autopayAmount: 450, balanceAsOf: "2026-10-25" });
    expect(autopayDebitsSince(d, {}).map((x) => x.date)).toEqual(["2026-10-31", "2026-11-14"]);
  });
});

describe("simulatePayoff", () => {
  it("rolls a paid-off debt's payment into the next debt", () => {
    const debts = [
      { id: "a", name: "A", balance: 100, monthly: 100, apr: 0, priority: 1 },
      { id: "b", name: "B", balance: 1000, monthly: 100, apr: 0, priority: 2 },
    ];
    // Without the rollover B would take 10 months on its own $100.
    expect(simulatePayoff(debts, 0, [], "tiered").freedomMonth).toBe(6);
  });

  it("names what's keeping the date out of reach, and what has no payoff", () => {
    const debts = [
      { id: "a", name: "Zero", balance: 500, monthly: 0, apr: 0, priority: 1 },
      { id: "b", name: "Underwater", balance: 10000, monthly: 50, apr: 30, priority: 2 },
      { id: "c", name: "No payoff yet", balance: null, monthly: 75, apr: null, priority: 2 },
    ];
    const sim = simulatePayoff(debts, 0, [], "tiered");
    expect(sim.freedomMonth).toBeNull();
    expect(sim.stuckGoalDebts.map((d) => [d.name, d.reason])).toEqual([
      ["Zero", "no monthly payment"],
      ["Underwater", "its payment doesn't cover the interest"],
    ]);
    expect(sim.noPayoffDebts).toEqual(["No payoff yet"]);
  });
});

describe("payoff good through a statement date", () => {
  const debt = { id: "d", balance: 1000, apr: 0, monthly: 100, dueDay: 28, balanceAsOf: "2026-10-31" };
  it("payments already in the payoff don't come off again; later bill months do", () => {
    const paid = {
      "2026-10": { d: { payments: [{ amount: 100, date: "2026-10-28" }] } }, // October's — already in the payoff
      "2026-11": { d: { payments: [{ amount: 100, date: "2026-10-30" }] } }, // November's, paid early
    };
    expect(computeAllRunningBalances([debt], paid, new Date(2026, 10, 2)).d.balance).toBe(900);
  });
  it("an autopay due before the statement date isn't taken again", () => {
    const auto = { ...debt, autopay: true, autopayFrequency: "monthly" };
    expect(autopayDebitsSince(auto, {}, new Date(2026, 10, 2))).toEqual([]);
    expect(autopayDebitsSince(auto, {}, new Date(2026, 10, 29)).map((p) => p.date)).toEqual(["2026-11-28"]);
  });
});

// MK Upstart as it really is: $16,619 payoff on 8/22/26, 25.04% APR, $450
// monthly payment, autopay $250 every 2 weeks from 8/24/26. Upstart said the
// payoff on 11/12/26 was $16,033.
const upstart = (over = {}) => ({
  id: "mk", name: "MK Upstart", balance: 16619, apr: 25.04, monthly: 450, dueDay: 27, graceDays: 0,
  balanceAsOf: "2026-08-22", autopay: true, autopayFrequency: "biweekly", autopayAnchor: "2026-08-24", autopayAmount: 250, ...over,
});
const nov12 = new Date(2026, 10, 12);

describe("payoff as of a date", () => {
  it("matches the lender's payoff for MK Upstart: six debits plus interest since the last one", () => {
    const p = projectPayoff(upstart(), {}, nov12, nov12);
    expect(p.paymentsApplied).toBe(6);
    expect(p.lastPaymentDate).toBe("2026-11-02");
    expect(p.daysOfInterest).toBe(10);
    expect(p.interestSinceLastPayment).toBeGreaterThan(100);
    expect(Math.abs(p.payoff - 16033)).toBeLessThan(10);
  });

  it("is the figure every page uses for what's owed today", () => {
    expect(computeAllRunningBalances([upstart()], {}, nov12).mk.balance).toBeCloseTo(projectPayoff(upstart(), {}, nov12, nov12).payoff, 6);
  });

  it("counts the scheduled debits for a future date", () => {
    const dec1 = projectPayoff(upstart(), {}, new Date(2026, 11, 1), nov12);
    expect(dec1.scheduledCount).toBe(2); // Nov 16 and Nov 30
    expect(dec1.scheduledTotal).toBe(500);
    expect(dec1.payoff).toBeLessThan(projectPayoff(upstart(), {}, nov12, nov12).payoff);
  });

  it("assumes a hand-paid bill's unpaid regular payments on their due dates", () => {
    const d = card({ apr: 0, balanceAsOf: "2026-11-01", dueDay: 20, monthly: 100 });
    const today = new Date(2026, 10, 12);
    expect(scheduledPayments(d, {}, today, new Date(2027, 0, 31)).map((p) => [p.date, p.amount, !!p.assumed]))
      .toEqual([["2026-11-20", 100, true], ["2026-12-20", 100, true], ["2027-01-20", 100, true]]);
    // November already paid in part: only the rest is assumed.
    const pbm = { "2026-11": { c: { payments: [{ id: "p", amount: 40, date: "2026-11-05" }] } } };
    expect(scheduledPayments(d, pbm, today, new Date(2026, 10, 30))[0].amount).toBe(60);
    expect(projectPayoff(d, pbm, new Date(2027, 0, 31), today).payoff).toBe(1000 - 40 - 60 - 100 - 100);
  });

  it("a payment dated next week doesn't lower today's payoff yet", () => {
    const d = card({ apr: 0, balanceAsOf: "2026-11-01" });
    const pbm = { "2026-11": { c: { payments: [{ id: "p", amount: 300, date: "2026-11-19" }] } } };
    expect(projectPayoff(d, pbm, nov12, nov12).payoff).toBe(1000);
    expect(projectPayoff(d, pbm, new Date(2026, 10, 19), nov12).payoff).toBe(700);
  });

  it("is null without a payoff entered", () => {
    expect(projectPayoff(card({ balance: null }), {}, nov12, nov12)).toBeNull();
  });
});

describe("biweekly autopay and hand-logged payments", () => {
  it("one $250 logged in a two-debit month stands in for one debit, not both", () => {
    const pbm = { "2026-10": { mk: { payments: [{ id: "m", amount: 250, date: "2026-10-05" }] } } };
    const debits = autopayDebitsSince(upstart(), pbm, nov12).map((x) => x.date);
    expect(debits).toEqual(["2026-08-24", "2026-09-07", "2026-09-21", "2026-10-19", "2026-11-02"]);
    // Same six payments of money either way, so the same payoff.
    expect(computeAllRunningBalances([upstart()], pbm, nov12).mk.balance).toBeCloseTo(computeAllRunningBalances([upstart()], {}, nov12).mk.balance, 6);
  });

  it("the paycheck plan counts a logged payment and a passed debit as the same money", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 12, 9));
    // Payday Oct 30, so the Nov 2 debit comes out of a check in view.
    const income = [{ id: "i", name: "Pay", amount: 3000, nextPayDate: "2026-10-30", frequency: "biweekly" }];
    const bill = { id: "mk", name: "MK Upstart", monthly: 450, autopay: true, autopayFrequency: "biweekly", autopayAnchor: "2026-08-24", autopayAmount: 250 };
    const pbm = { "2026-11": { mk: { payments: [{ id: "m", amount: 250, date: "2026-11-02" }] } } };
    const plan = buildPaycheckPlan(income, [bill], 40, pbm, {}, 0);
    const items = plan.paychecks.flatMap((p) => p.items).filter((it) => it.billId === "mk");
    const paidInNov = items.filter((it) => it.paid).reduce((s, it) => s + it.amount, 0);
    expect(paidInNov).toBe(250); // the Nov 2 debit once, not $500
    // Nov 16 and Nov 30 are still planned in full.
    expect(items.filter((it) => !it.paid && it.dueDate.getMonth() === 10).map((it) => it.amount)).toEqual([250, 250]);
    vi.useRealTimers();
  });
});

describe("monthlyOutflow", () => {
  it("is what actually leaves the account: 26 debits a year for biweekly autopay", () => {
    expect(monthlyOutflow(upstart())).toBeCloseTo(541.67, 2);
    expect(monthlyOutflow({ monthly: 450 })).toBe(450);
    expect(monthlyOutflow({ monthly: 450, autopay: true, autopayFrequency: "monthly" })).toBe(450);
  });

  it("drives cash freed by a payoff and the projection's pace", () => {
    const { freedMonthly } = allocateMaxCashFlow([upstart({ balance: 1000 })], 1000);
    expect(freedMonthly).toBeCloseTo(541.67, 2);
    // $1,000 at 0%: 2 months at the real $541.67/mo, where $450/mo would take 3.
    expect(simulatePayoff([upstart({ balance: 1000, apr: 0 })], 0, [], "tiered").freedomMonth).toBe(2);
  });
});
