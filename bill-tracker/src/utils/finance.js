// src/utils/finance.js

export const money = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};

export const pct = (n) => (n === null || n === undefined || isNaN(n) ? "—" : `${n.toFixed(1)}%`);

export function sortForStrategy(debts, strategy) {
  const arr = [...debts];
  if (strategy === "avalanche") {
    arr.sort((a, b) => (b.apr ?? -1) - (a.apr ?? -1) || a.balance - b.balance);
  } else if (strategy === "snowball") {
    arr.sort((a, b) => a.balance - b.balance);
  } else {
    // tiered: priority first, then smallest balance within tier
    arr.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.balance - b.balance);
  }
  return arr;
}

export function allocateExtra(debts, amount, strategy) {
  const targetable = debts.filter((d) => d.isDebt !== false && !d.protected && !d.excludeFromGoal && d.balance > 0);
  const ordered = sortForStrategy(targetable, strategy);
  let remaining = amount;
  const applied = {};
  for (const d of ordered) {
    if (remaining <= 0) break;
    const pay = Math.min(remaining, d.balance);
    if (pay > 0) {
      applied[d.id] = (applied[d.id] || 0) + pay;
      remaining -= pay;
    }
  }
  return { applied, leftover: Math.max(0, remaining) };
}

// Knapsack: pick the combination of bills fully payable within `amount` that frees
// the most monthly payment. Only a FULLY paid-off bill frees its monthly payment —
// a partial payment doesn't lower the minimum due next month.
export function allocateMaxCashFlow(debts, amount) {
  const targetable = debts
    .filter((d) => d.isDebt !== false && !d.protected && !d.excludeFromGoal && d.balance > 0)
    .map((d) => ({ ...d, cost: Math.round(d.balance) }));
  const budget = Math.min(Math.floor(amount), 200000);

  // 0/1 knapsack, value = monthly payment freed, weight = balance (cost to fully clear)
  const dp = new Array(budget + 1).fill(0);
  const choice = targetable.map(() => new Array(budget + 1).fill(false));
  for (let i = 0; i < targetable.length; i++) {
    const { cost, monthly } = targetable[i];
    if (cost > budget) continue;
    for (let b = budget; b >= cost; b--) {
      const withItem = dp[b - cost] + monthly;
      if (withItem > dp[b]) {
        dp[b] = withItem;
        choice[i][b] = true;
      }
    }
  }
  // backtrack to find which bills were chosen at the best budget point
  let bestB = 0;
  for (let b = 0; b <= budget; b++) if (dp[b] >= dp[bestB]) bestB = b;
  const chosenIds = [];
  let b = bestB;
  for (let i = targetable.length - 1; i >= 0; i--) {
    if (choice[i][b]) {
      chosenIds.push(targetable[i].id);
      b -= targetable[i].cost;
    }
  }
  const applied = {};
  let spent = 0;
  for (const id of chosenIds) {
    const d = targetable.find((t) => t.id === id);
    applied[id] = d.cost;
    spent += d.cost;
  }
  let leftover = amount - spent;
  // roll any leftover onto the next-smallest remaining balance (doesn't free cash flow yet, but reduces principal)
  const remaining = targetable.filter((d) => !applied[d.id]).sort((a, b2) => a.balance - b2.balance);
  for (const d of remaining) {
    if (leftover <= 0) break;
    const pay = Math.min(leftover, d.balance);
    applied[d.id] = (applied[d.id] || 0) + pay;
    leftover -= pay;
  }
  const freedMonthly = chosenIds.reduce((s, id) => s + targetable.find((t) => t.id === id).monthly, 0);
  return { applied, leftover: Math.max(0, leftover), freedMonthly };
}

// This month's minimum payments are already budgeted separately from "extra" money —
// so before allocating extra, first knock each balance down by its own minimum.
// Only the amount still owed after that counts as needing extra dollars.
export function minimumAdjustedDebts(debts) {
  return debts.map((d) => {
    if (d.isDebt === false || d.balance === null || d.balance === undefined || d.balance <= 0) return d;
    const min = Math.min(Number(d.monthly || 0), d.balance);
    return { ...d, balance: Math.max(0, d.balance - min) };
  });
}

export function monthlyInterest(balance, apr) {
  if (!apr) return 0;
  return balance * (apr / 100 / 12);
}

// Simulates forward month by month.
export function simulatePayoff(debts, recurringExtra, boosts, strategy, opts = {}) {
  const capMonths = opts.capMonths || 480;
  const { income, targetDTI, mortgageEstimate } = opts;

  const constantMonthly = debts
    .filter((d) => d.isDebt !== false && (d.balance === null || d.balance === undefined))
    .reduce((s, d) => s + Number(d.monthly || 0), 0);

  let working = debts
    .filter((d) => d.isDebt !== false && d.balance > 0)
    .map((d) => ({ ...d }));

  const series = [{ month: 0, label: "Now", total: working.reduce((s, d) => s + d.balance, 0) }];
  let freedomMonth = null;
  let fullFreedomMonth = null;
  let dtiTargetMonth = null;
  let dtiWithMortgageTargetMonth = null;

  const wantDti = income > 0 && targetDTI !== undefined && targetDTI !== null;
  const mortgageAdd = Number(mortgageEstimate || 0);
  
  if (wantDti) {
    const nowMonthly = constantMonthly + working.reduce((s, d) => s + Number(d.monthly || 0), 0);
    if ((nowMonthly / income) * 100 <= targetDTI) dtiTargetMonth = 0;
    if (((nowMonthly + mortgageAdd) / income) * 100 <= targetDTI) dtiWithMortgageTargetMonth = 0;
  }

  for (let m = 1; m <= capMonths; m++) {
    for (const d of working) {
      if (d.balance <= 0) continue;
      d.balance += monthlyInterest(d.balance, d.apr);
      const min = Math.min(d.monthly, d.balance);
      d.balance -= min;
    }
    
    const boostThisMonth = boosts.filter((b) => b.month === m).reduce((s, b) => s + Number(b.amount || 0), 0);
    const extra = recurringExtra + boostThisMonth;
    
    if (extra > 0) {
      const { applied } = allocateExtra(working, extra, strategy);
      for (const d of working) {
        if (applied[d.id]) d.balance = Math.max(0, d.balance - applied[d.id]);
      }
    }
    for (const d of working) if (d.balance < 0.5) d.balance = 0;

    const total = working.reduce((s, d) => s + d.balance, 0);
    series.push({ month: m, label: monthLabel(m), total: Math.round(total) });

    const goalDebts = working.filter((d) => !d.excludeFromGoal);
    if (freedomMonth === null && goalDebts.every((d) => d.balance <= 0)) freedomMonth = m;
    if (fullFreedomMonth === null && working.every((d) => d.balance <= 0)) fullFreedomMonth = m;
    
    if (wantDti && (dtiTargetMonth === null || dtiWithMortgageTargetMonth === null)) {
      const monthlyLeft = constantMonthly + working.filter((d) => d.balance > 0).reduce((s, d) => s + Number(d.monthly || 0), 0);
      if (dtiTargetMonth === null && (monthlyLeft / income) * 100 <= targetDTI) dtiTargetMonth = m;
      if (dtiWithMortgageTargetMonth === null && ((monthlyLeft + mortgageAdd) / income) * 100 <= targetDTI) dtiWithMortgageTargetMonth = m;
    }

    if (freedomMonth !== null && fullFreedomMonth !== null && (!wantDti || (dtiTargetMonth !== null && dtiWithMortgageTargetMonth !== null))) break;
  }
  return { series, freedomMonth, fullFreedomMonth, dtiTargetMonth, dtiWithMortgageTargetMonth };
}

export function fastestStrategyForBoost(debts, boostAmount, recurringExtra, existingBoosts) {
  const candidates = ["tiered", "snowball", "avalanche", "maxcashflow"];
  let best = null;
  for (const strat of candidates) {
    const result = strat === "maxcashflow"
      ? simulatePayoffWithFirstMoveOverride(debts, recurringExtra, existingBoosts, boostAmount)
      : simulatePayoff(debts, recurringExtra, [...existingBoosts, { month: 1, amount: boostAmount }], strat);
    const fm = result.freedomMonth ?? Infinity;
    if (!best || fm < best.freedomMonth) best = { strategy: strat, freedomMonth: result.freedomMonth };
  }
  return best;
}

export function simulatePayoffWithFirstMoveOverride(debts, recurringExtra, existingBoosts, boostAmount, capMonths = 480) {
  let working = debts
    .filter((d) => d.isDebt !== false && d.balance > 0)
    .map((d) => ({ ...d }));
  const series = [{ month: 0, label: "Now", total: working.reduce((s, d) => s + d.balance, 0) }];
  let freedomMonth = null;

  for (let m = 1; m <= capMonths; m++) {
    for (const d of working) {
      if (d.balance <= 0) continue;
      d.balance += monthlyInterest(d.balance, d.apr);
      const min = Math.min(d.monthly, d.balance);
      d.balance -= min;
    }
    const boostThisMonth = existingBoosts.filter((b) => b.month === m).reduce((s, b) => s + Number(b.amount || 0), 0)
      + (m === 1 ? boostAmount : 0);
    if (boostThisMonth > 0) {
      const { applied } = m === 1 ? allocateMaxCashFlow(working, boostThisMonth) : allocateExtra(working, boostThisMonth, "tiered");
      for (const d of working) if (applied[d.id]) d.balance = Math.max(0, d.balance - applied[d.id]);
    }
    if (recurringExtra > 0) {
      const { applied } = allocateExtra(working, recurringExtra, "tiered");
      for (const d of working) if (applied[d.id]) d.balance = Math.max(0, d.balance - applied[d.id]);
    }
    for (const d of working) if (d.balance < 0.5) d.balance = 0;
    const total = working.reduce((s, d) => s + d.balance, 0);
    series.push({ month: m, label: monthLabel(m), total: Math.round(total) });
    const goalDebts = working.filter((d) => !d.excludeFromGoal);
    if (goalDebts.every((d) => d.balance <= 0) && freedomMonth === null) {
      freedomMonth = m;
      break;
    }
  }
  return { series, freedomMonth };
}

export function monthLabel(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function monthLabelFull(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ---------------- Paycheck planner ----------------

export function fmtDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function advanceByFrequency(date, frequency) {
  const d = new Date(date);
  if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else if (frequency === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 14); // biweekly, default
  return d;
}

export function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function dueDateInMonth(dueDay, year, monthIndex) {
  const dim = lastDayOfMonth(year, monthIndex);
  const day = Math.min(dueDay, dim);
  return new Date(year, monthIndex, day);
}

// All upcoming paychecks across every income source, within the horizon.
export function generatePaychecks(incomeSources, horizonDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
  const checks = [];
  for (const src of incomeSources) {
    if (!src.nextPayDate || !src.amount) continue;
    let d = new Date(src.nextPayDate + "T00:00:00");
    let guard = 0;
    while (d <= horizonEnd && guard < 80) {
      if (d >= today) {
        checks.push({ id: `${src.id}-${isoDate(d)}`, sourceId: src.id, sourceName: src.name, date: new Date(d), amount: Number(src.amount), remaining: Number(src.amount), items: [] });
      }
      d = advanceByFrequency(d, src.frequency || "biweekly");
      guard++;
    }
  }
  checks.sort((a, b) => a.date - b.date);
  return checks;
}

// All upcoming due-date instances for every bill that has a due day set, within the horizon.
export function generateBillInstances(bills, horizonDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
  const instances = [];
  for (const b of bills) {
    if (!b.dueDay || !(Number(b.monthly) > 0)) continue;
    let cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    for (let i = 0; i < 5; i++) {
      const dd = dueDateInMonth(b.dueDay, cursor.getFullYear(), cursor.getMonth());
      const deadline = new Date(dd);
      deadline.setDate(deadline.getDate() + Number(b.graceDays || 0));
      if (deadline >= today && dd <= horizonEnd) {
        instances.push({ billId: b.id, name: b.name, amount: Number(b.monthly || 0), dueDate: dd, deadline, graceDays: Number(b.graceDays || 0) });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  instances.sort((a, b) => a.deadline - b.deadline);
  return instances;
}

// Assigns each bill instance to the paycheck(s) that fall within its billing cycle, splitting
// across paychecks when a single check can't cover it. Greedy best-fit, processed most-urgent first.
export function buildPaycheckPlan(incomeSources, bills, horizonDays = 95) {
  const paychecks = generatePaychecks(incomeSources, horizonDays);
  const instances = generateBillInstances(bills, horizonDays);
  const unscheduled = bills.filter((b) => b.isDebt !== false && !b.dueDay && Number(b.monthly) > 0);
  const shortfalls = [];

  if (paychecks.length === 0) {
    return { paychecks, unscheduled, shortfalls, noIncome: true };
  }

  for (const inst of instances) {
    const windowStart = new Date(inst.deadline);
    windowStart.setDate(windowStart.getDate() - 32);
    let eligible = paychecks.filter((p) => p.date <= inst.deadline && p.date >= windowStart);
    if (eligible.length === 0) {
      const before = paychecks.filter((p) => p.date <= inst.deadline).sort((a, b) => b.date - a.date);
      eligible = before.length ? [before[0]] : [paychecks[0]];
    }

    eligible = eligible.slice().sort((a, b) => b.remaining - a.remaining);
    const bestFit = eligible.find((p) => p.remaining >= inst.amount);
    if (bestFit) {
      bestFit.remaining -= inst.amount;
      bestFit.items.push({ billId: inst.billId, name: inst.name, amount: inst.amount, dueDate: inst.dueDate, deadline: inst.deadline, split: false });
      continue;
    }

    // doesn't fit on any single check in the window — split across them, earliest first
    eligible.sort((a, b) => a.date - b.date);
    let remainingToAssign = inst.amount;
    const parts = [];
    for (const p of eligible) {
      if (remainingToAssign <= 0.005) break;
      const cap = Math.max(0, p.remaining);
      const amt = Math.min(cap, remainingToAssign);
      if (amt <= 0) continue;
      p.remaining -= amt;
      parts.push({ p, amt });
      remainingToAssign -= amt;
    }
    if (remainingToAssign > 0.5) {
      const last = eligible[eligible.length - 1] || paychecks[paychecks.length - 1];
      last.remaining -= remainingToAssign;
      parts.push({ p: last, amt: remainingToAssign });
      shortfalls.push({ ...inst, reason: "income in this window may not fully cover this bill" });
    }
    parts.forEach((part, idx) => {
      part.p.items.push({ billId: inst.billId, name: inst.name, amount: Math.round(part.amt * 100) / 100, dueDate: inst.dueDate, deadline: inst.deadline, split: true, splitLabel: `part ${idx + 1} of ${parts.length}` });
    });
  }

  return { paychecks, unscheduled, shortfalls, noIncome: false };
}