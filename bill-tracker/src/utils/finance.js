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

export function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Normalizes a stored Monthly Plan payment record for one bill in one
// month. Older saved data stored a plain `true`/`false` here (from before
// partial payments existed) — read as fully paid / not paid so nothing
// breaks.
export function getPaymentRecord(monthEntry, item) {
  const raw = (monthEntry || {})[item.id];
  if (raw && typeof raw === "object") {
    return { amountPaid: Number(raw.amountPaid) || 0, cleared: !!raw.cleared, bank: raw.bank || "", paidDate: raw.paidDate || null };
  }
  if (raw === true) {
    return { amountPaid: Number(item.monthly) || 0, cleared: false, bank: "", paidDate: null };
  }
  return { amountPaid: 0, cleared: false, bank: "", paidDate: null };
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

// All upcoming paychecks across every income source, within the horizon —
// plus each source's single most recent past paycheck, even if its date has
// already passed. A "next pay date" that's slipped a day or two into the
// past almost always means "I was just paid and haven't updated this yet,"
// and that money is still real, unspent cash available for this cycle's
// bills — dropping it entirely just because the date ticked over would
// throw away the one paycheck the current bills are actually meant to
// come from. Older past occurrences beyond that single most-recent one are
// still dropped, so a long-stale date doesn't flood the plan with history.
//
// Paychecks landing on the same calendar date are combined into one shared
// pool so bills are allocated against the household's total for that day,
// rather than against a single person's check in isolation.
//
// `overrides` lets a specific occurrence's date be nudged (a holiday shifted
// payday, etc.) without touching the source's regular schedule: shape is
// { [sourceId]: { [naturallyComputedIsoDate]: overriddenIsoDate } }. The
// lookup key is always the date the recurring schedule would have produced
// naturally, so overrides stay stable even as other occurrences shift.
export function generatePaychecks(incomeSources, horizonDays, overrides = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
  const byDate = new Map();

  function addCheck(date, amount, sourceId, sourceName, originalDate) {
    const key = isoDate(date);
    if (!byDate.has(key)) {
      byDate.set(key, { id: key, date: new Date(date), amount: 0, remaining: 0, items: [], sources: [] });
    }
    const check = byDate.get(key);
    check.amount += amount;
    check.remaining += amount;
    check.sources.push({ sourceId, sourceName, amount, originalDate: new Date(originalDate) });
  }

  for (const src of incomeSources) {
    if (!src.nextPayDate || !src.amount) continue;
    let d = new Date(src.nextPayDate + "T00:00:00");
    let guard = 0;
    const occurrences = [];
    while (d <= horizonEnd && guard < 80) {
      occurrences.push(new Date(d));
      d = advanceByFrequency(d, src.frequency || "biweekly");
      guard++;
    }
    const amount = Number(src.amount);
    const sourceOverrides = overrides[src.id] || {};
    const resolve = (dt) => {
      const overridden = sourceOverrides[isoDate(dt)];
      return overridden ? new Date(overridden + "T00:00:00") : dt;
    };
    const future = occurrences.filter((dt) => dt >= today);
    const mostRecentPast = occurrences.filter((dt) => dt < today).sort((a, b) => b - a)[0];
    if (mostRecentPast) addCheck(resolve(mostRecentPast), amount, src.id, src.name, mostRecentPast);
    for (const dt of future) addCheck(resolve(dt), amount, src.id, src.name, dt);
  }

  const checks = Array.from(byDate.values());
  checks.forEach((c) => {
    c.sourceName = c.sources.map((s) => s.sourceName).join(" + ");
  });
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
        instances.push({ billId: b.id, name: b.name, amount: Number(b.monthly || 0), dueDate: dd, deadline, graceDays: Number(b.graceDays || 0), splitFriendly: !!b.splitFriendly });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  instances.sort((a, b) => a.deadline - b.deadline);
  return instances;
}

// Assigns each bill instance to the paycheck(s) that fall on or before its grace-period
// deadline. Processed most-urgent (soonest deadline) first, so bills with little or no grace
// claim capacity before bills that have room to slide to a later check. Within a bill's own
// eligible window, the earliest check that can cover it in full is preferred — paid close to
// its normal due date — and only slides to a later check (still within grace) when the earlier
// ones are already spoken for. A bill only splits across multiple checks, or shows as a real
// shortfall, if the full grace window's income genuinely isn't enough.
//
// Bills marked "split OK" skip that whole-check-first competition: they're divided evenly
// across every paycheck in their grace window right away (in half, thirds, however many
// checks are eligible), since paying them that way has no real downside for the user — this
// frees up whole-check capacity for bills that genuinely need to land on a single check.
export function buildPaycheckPlan(incomeSources, bills, horizonDays = 95, paidByMonth = {}, paycheckOverrides = {}) {
  const paychecks = generatePaychecks(incomeSources, horizonDays, paycheckOverrides);
  const rawInstances = generateBillInstances(bills, horizonDays);
  const unscheduled = bills.filter((b) => b.isDebt !== false && !b.dueDay && Number(b.monthly) > 0);
  const shortfalls = [];
  const lateButInGrace = [];

  if (paychecks.length === 0) {
    return { paychecks, unscheduled, shortfalls, lateButInGrace, noIncome: true };
  }

  // Bills already recorded as paid on the Monthly Plan don't need to be
  // planned for again. Pull that amount out of whichever paycheck it
  // actually came from — the most recent one on or before the date it was
  // marked paid — instead of leaving that money projected onto a future
  // check the bill would otherwise have been assigned to.
  const sortedPaychecksAsc = paychecks.slice().sort((a, b) => a.date - b.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const instances = [];
  for (const inst of rawInstances) {
    const monthEntry = paidByMonth[monthKeyOf(inst.dueDate)] || {};
    const rec = getPaymentRecord(monthEntry, { id: inst.billId, monthly: inst.amount });
    const paid = Math.min(rec.amountPaid, inst.amount);
    if (paid > 0.005) {
      const paidOn = rec.paidDate ? new Date(rec.paidDate + "T00:00:00") : today;
      const priorChecks = sortedPaychecksAsc.filter((p) => p.date <= paidOn);
      const sourceCheck = priorChecks.length ? priorChecks[priorChecks.length - 1] : sortedPaychecksAsc[0];
      sourceCheck.remaining -= paid;
    }
    const remainingAmount = inst.amount - paid;
    if (remainingAmount > 0.005) {
      instances.push({ ...inst, amount: remainingAmount });
    }
  }

  function flagIfLate(inst, paidDate) {
    if (paidDate > inst.dueDate) {
      lateButInGrace.push({ ...inst, paidDate, daysLate: Math.round((paidDate - inst.dueDate) / 86400000) });
    }
  }

  function assignWholeOrSplit(inst, pool) {
    const bestFit = pool.find((p) => p.remaining >= inst.amount);
    if (bestFit) {
      bestFit.remaining -= inst.amount;
      bestFit.items.push({ billId: inst.billId, name: inst.name, amount: inst.amount, dueDate: inst.dueDate, deadline: inst.deadline, split: false });
      flagIfLate(inst, bestFit.date);
      return;
    }

    // No single check through the grace-period deadline covers it — split across the pool.
    let remainingToAssign = inst.amount;
    const parts = [];
    for (const p of pool) {
      if (remainingToAssign <= 0.005) break;
      const cap = Math.max(0, p.remaining);
      const amt = Math.min(cap, remainingToAssign);
      if (amt <= 0) continue;
      p.remaining -= amt;
      parts.push({ p, amt });
      remainingToAssign -= amt;
    }
    if (remainingToAssign > 0.5) {
      const last = pool[pool.length - 1];
      last.remaining -= remainingToAssign;
      parts.push({ p: last, amt: remainingToAssign });
      shortfalls.push({ ...inst, reason: "income through this bill's grace-period deadline may not fully cover it" });
    }
    const split = parts.length > 1;
    let latestDate = inst.dueDate;
    parts.forEach((part, idx) => {
      part.p.items.push({
        billId: inst.billId, name: inst.name, amount: Math.round(part.amt * 100) / 100,
        dueDate: inst.dueDate, deadline: inst.deadline, split, splitLabel: split ? `part ${idx + 1} of ${parts.length}` : undefined,
      });
      if (part.p.date > latestDate) latestDate = part.p.date;
    });
    flagIfLate(inst, latestDate);
  }

  function assignEvenSplit(inst, pool) {
    const share = inst.amount / pool.length;
    let shortBy = 0;
    let latestDate = inst.dueDate;
    const addedItems = [];
    pool.forEach((p, idx) => {
      const cap = Math.max(0, p.remaining);
      const amt = Math.min(cap, share);
      shortBy += share - amt;
      p.remaining -= amt;
      if (amt > 0.005) {
        const item = {
          billId: inst.billId, name: inst.name, amount: Math.round(amt * 100) / 100,
          dueDate: inst.dueDate, deadline: inst.deadline, split: pool.length > 1, splitLabel: pool.length > 1 ? `part ${idx + 1} of ${pool.length}` : undefined,
        };
        p.items.push(item);
        addedItems.push(item);
        if (p.date > latestDate) latestDate = p.date;
      }
    });
    if (shortBy > 0.5) {
      const last = pool[pool.length - 1];
      last.remaining -= shortBy;
      const lastItem = addedItems[addedItems.length - 1];
      if (lastItem) lastItem.amount = Math.round((lastItem.amount + shortBy) * 100) / 100;
      shortfalls.push({ ...inst, reason: "income through this bill's grace-period deadline may not fully cover it, even split evenly" });
    }
    flagIfLate(inst, latestDate);
  }

  const sortedInstances = instances.slice().sort((a, b) => a.deadline - b.deadline);
  for (const inst of sortedInstances) {
    // Bounded to this bill's own cycle: from the single most recent paycheck
    // on or before its due date (so a check landing a few days early can
    // still cover it) through its grace-period deadline. This stops a later
    // month's instance of the same recurring bill from reaching further back
    // and re-claiming an earlier paycheck that already belongs to an earlier
    // cycle's bills.
    const priorChecks = paychecks.filter((p) => p.date <= inst.dueDate);
    const windowStart = priorChecks.length ? priorChecks[priorChecks.length - 1].date : inst.dueDate;
    const eligible = paychecks.filter((p) => p.date >= windowStart && p.date <= inst.deadline).sort((a, b) => a.date - b.date);
    const pool = eligible.length ? eligible : [paychecks[0]];
    if (inst.splitFriendly) {
      assignEvenSplit(inst, pool);
    } else {
      assignWholeOrSplit(inst, pool);
    }
  }

  return { paychecks, unscheduled, shortfalls, lateButInGrace, noIncome: false };
}