import { useMemo, useState } from "react";
import { buildPaycheckPlan, computeAllRunningBalances, latestExtraBatch, monthLabelFull, simulatePayoff } from "../utils/finance";

export function tierOf(d) {
  const t = Number(d.priority);
  return [1, 2, 3, 4].includes(t) ? t : 2;
}

// Every number the pages show that's derived from the household data rather
// than stored in it — computed once per render here, not once per page.
export function useFinanceModel(h) {
  const { debts, fixed, paidOffDebts, paidByMonth, income, includeRent, mortgageEstimate, netIncome, recurringExtra, boosts, strategy, targetDTI, incomeSources, paycheckOverrides, paycheckReserve, debtBaseline, setDebtBaseline } = h;

  // Balances are computed, not the raw stored figure: each account's stored
  // balance is a fixed anchor (accurate as of BALANCE_ANCHOR_DATE), and
  // every payment dated after that anchor is split into interest/principal
  // and rolled forward from there. This is what actually moves the wall,
  // the stat cards, and the payoff projection as payments come in.
  const runningBalances = useMemo(() => computeAllRunningBalances(debts, paidByMonth), [debts, paidByMonth]);
  const debtsWithRunningBalance = useMemo(
    () => debts.map((d) => {
      const rb = runningBalances[d.id];
      return rb && rb.balance !== null && rb.balance !== undefined ? { ...d, balance: rb.balance } : d;
    }),
    [debts, runningBalances]
  );
  function runningBalanceOf(d) {
    const rb = runningBalances[d.id];
    return rb && rb.balance !== null && rb.balance !== undefined ? rb.balance : Number(d.balance || 0);
  }

  const debtBills = useMemo(() => debtsWithRunningBalance.filter((d) => d.isDebt !== false), [debtsWithRunningBalance]);
  // Everything that's due each month — what the Monthly Plan and the
  // Dashboard's "This month" card track.
  const monthlyBills = useMemo(() => [...debtBills, ...fixed], [debtBills, fixed]);
  const totalDebtMonthly = debtBills.reduce((s, d) => s + Number(d.monthly || 0), 0);
  const totalDebtBalance = debtBills.reduce((s, d) => s + Number(d.balance || 0), 0);
  const rentMonthly = fixed.find((f) => f.type === "Rent/Mortgage")?.monthly || 0;
  const dtiNumerator = totalDebtMonthly + (includeRent ? rentMonthly : 0);
  const dti = income > 0 ? (dtiNumerator / income) * 100 : null;
  // "true" qualifying DTI a lender would see today: current debts + the future mortgage,
  // replacing current rent (you won't be paying both at once)
  const trueDtiNumerator = totalDebtMonthly + Number(mortgageEstimate || 0);
  const trueDti = income > 0 ? (trueDtiNumerator / income) * 100 : null;
  const dtiBand = dti === null ? null : dti <= 36 ? "good" : dti <= 43 ? "watch" : "over";
  const dtiBandLabel = { good: "Within typical guidelines", watch: "Near the common ceiling", over: "Above the common ceiling" }[dtiBand] || "";

  const totalFixedMonthly = fixed.reduce((s, f) => s + Number(f.monthly || 0), 0);
  const netIncomeNum = netIncome === "" ? null : Number(netIncome);
  const availableAfterBills = netIncomeNum !== null ? netIncomeNum - totalDebtMonthly - totalFixedMonthly : null;

  const sim = useMemo(
    () => simulatePayoff(debtsWithRunningBalance, Number(recurringExtra) || 0, boosts, strategy, { income, targetDTI: Number(targetDTI) || null, mortgageEstimate: Number(mortgageEstimate) || 0 }),
    [debtsWithRunningBalance, recurringExtra, boosts, strategy, income, targetDTI, mortgageEstimate]
  );
  const debtFreeLabel = sim.freedomMonth !== null ? monthLabelFull(sim.freedomMonth) : "480+ months out";
  const fullDebtFreeLabel = sim.fullFreedomMonth !== null ? monthLabelFull(sim.fullFreedomMonth) : "480+ months out";
  const dtiTargetLabel = sim.dtiTargetMonth === 0 ? "Already there" : sim.dtiTargetMonth !== null ? monthLabelFull(sim.dtiTargetMonth) : "480+ months out";
  const dtiWithMortgageTargetLabel = sim.dtiWithMortgageTargetMonth === 0 ? "Already there" : sim.dtiWithMortgageTargetMonth !== null ? monthLabelFull(sim.dtiWithMortgageTargetMonth) : "480+ months out";
  const hasExcludedWithBalance = debtsWithRunningBalance.some((d) => d.excludeFromGoal && d.isDebt !== false && d.balance > 0);

  // chart sampling
  const chartData = useMemo(() => {
    const s = sim.series;
    if (s.length <= 48) return s;
    const step = Math.ceil(s.length / 48);
    return s.filter((_, i) => i % step === 0 || i === s.length - 1);
  }, [sim.series]);

  const lastExtraBatch = useMemo(() => latestExtraBatch(paidByMonth), [paidByMonth]);
  const billNameById = useMemo(
    () => new Map([...paidOffDebts, ...debts, ...fixed].map((b) => [b.id, b.name])),
    [paidOffDebts, debts, fixed]
  );

  const paycheckPlan = useMemo(() => {
    const billsForPlan = [
      ...debts.filter((d) => d.isDebt !== false).map((d) => ({ id: d.id, name: d.name, monthly: d.monthly, dueDay: d.dueDay, graceDays: d.graceDays, splitFriendly: d.splitFriendly, autopay: d.autopay, autopayFrequency: d.autopayFrequency, autopayAnchor: d.autopayAnchor, autopayAmount: d.autopayAmount })),
      ...fixed.map((f) => ({ id: f.id, name: f.name, monthly: f.monthly, dueDay: f.dueDay, graceDays: f.graceDays, splitFriendly: f.splitFriendly, autopay: f.autopay, autopayFrequency: f.autopayFrequency, autopayAnchor: f.autopayAnchor, autopayAmount: f.autopayAmount })),
    ];
    return buildPaycheckPlan(incomeSources, billsForPlan, 95, paidByMonth, paycheckOverrides, Number(paycheckReserve) || 0);
  }, [incomeSources, debts, fixed, paidByMonth, paycheckOverrides, paycheckReserve]);

  // The wall's "already paid off" reference point. Persisted rather than
  // recomputed on every load, so it's a genuine since-you-started milestone
  // instead of resetting to the current total (and erasing all visible
  // progress) every time the page reloads. Grows automatically if new debt
  // brings the current total above it, so the bar never overflows past 100%.
  const [lastSeenTotal, setLastSeenTotal] = useState(totalDebtBalance);
  if (totalDebtBalance !== lastSeenTotal) {
    setLastSeenTotal(totalDebtBalance);
    if (debtBaseline === null || totalDebtBalance > debtBaseline) {
      setDebtBaseline(totalDebtBalance || 1);
    }
  }
  const wallBaseline = Math.max(debtBaseline || 0, totalDebtBalance) || 1;
  const paidDownSoFar = Math.max(0, wallBaseline - totalDebtBalance);

  // Every debt lands in exactly one group: "protected" wins over a stale
  // priority, and a missing/odd priority reads as Core Payoff (the same
  // default the category picker shows) instead of the debt vanishing.
  const tierGroups = [1, 2, 3, 4].map((t) => ({ tier: t, items: debts.filter((d) => !d.protected && tierOf(d) === t) }));
  const protectedGroup = debts.filter((d) => d.protected);
  const protectedBalance = protectedGroup.reduce((s, d) => s + runningBalanceOf(d), 0);
  const paidOffTotal = paidOffDebts.reduce((s, d) => s + Number(d.balanceAtPayoff || 0), 0);

  return {
    runningBalances, runningBalanceOf, debtsWithRunningBalance, debtBills, monthlyBills,
    totalDebtMonthly, totalDebtBalance, totalFixedMonthly, rentMonthly,
    dti, trueDti, dtiBand, dtiBandLabel, netIncomeNum, availableAfterBills,
    sim, chartData, debtFreeLabel, fullDebtFreeLabel, dtiTargetLabel, dtiWithMortgageTargetLabel, hasExcludedWithBalance,
    lastExtraBatch, billNameById, paycheckPlan,
    wallBaseline, paidDownSoFar, tierGroups, protectedGroup, protectedBalance, paidOffTotal,
  };
}
