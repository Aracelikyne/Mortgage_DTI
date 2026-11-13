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

// 0/1 knapsack over whole dollars: value = monthly payment freed, weight =
// the balance rounded UP (so a chosen set never costs more than it looks).
// Returns the chosen debts.
function knapsackChoose(targetable, budget) {
  const dp = new Float64Array(budget + 1);
  const choice = targetable.map(() => new Uint8Array(budget + 1));
  for (let i = 0; i < targetable.length; i++) {
    const { weight, monthly } = targetable[i];
    if (weight > budget) continue;
    for (let b = budget; b >= weight; b--) {
      const withItem = dp[b - weight] + monthly;
      if (withItem > dp[b]) {
        dp[b] = withItem;
        choice[i][b] = 1;
      }
    }
  }
  // backtrack from the best budget point (the largest spend among ties)
  let bestB = 0;
  for (let b = 0; b <= budget; b++) if (dp[b] >= dp[bestB]) bestB = b;
  const chosen = [];
  let b = bestB;
  for (let i = targetable.length - 1; i >= 0; i--) {
    if (choice[i][b]) {
      chosen.push(targetable[i]);
      b -= targetable[i].weight;
    }
  }
  return chosen;
}

// Knapsack: pick the combination of bills fully payable within `amount` that frees
// the most monthly payment. Only a FULLY paid-off bill frees its monthly payment —
// a partial payment doesn't lower the minimum due next month.
export function allocateMaxCashFlow(debts, amount) {
  const targetable = debts
    .filter((d) => d.isDebt !== false && !d.protected && !d.excludeFromGoal && d.balance > 0)
    .map((d) => {
      const balance = Math.round(Number(d.balance) * 100) / 100;
      // Weight rounds up so a $100.40 balance never "fits" in $100, but the
      // amount applied is the exact balance — rounding that too used to
      // leave 40¢ behind and report the bill as "continues next month".
      return { ...d, balance, monthly: monthlyOutflow(d), weight: Math.ceil(balance) };
    });

  // Whole-dollar weights against the amount rounded down can miss a set the
  // cents would exactly cover ($100.40 clearing a $100.40 balance), so also
  // try the rounded-up budget and keep it when the exact total still fits.
  let chosen = [];
  let chosenValue = -1;
  for (const budget of new Set([Math.floor(amount), Math.ceil(amount)])) {
    const pick = knapsackChoose(targetable, Math.min(Math.max(0, budget), 200000));
    const exactCost = pick.reduce((s, d) => s + d.balance, 0);
    const value = pick.reduce((s, d) => s + d.monthly, 0);
    if (exactCost <= amount + 0.005 && value > chosenValue) {
      chosen = pick;
      chosenValue = value;
    }
  }

  const applied = {};
  let leftover = amount;
  for (const d of chosen) {
    applied[d.id] = d.balance;
    leftover -= d.balance;
  }
  // roll any leftover onto the next-smallest remaining balance (doesn't free cash flow yet, but reduces principal)
  const remaining = targetable.filter((d) => !applied[d.id]).sort((a, b2) => a.balance - b2.balance);
  for (const d of remaining) {
    if (leftover <= 0.005) break;
    const pay = Math.min(leftover, d.balance);
    applied[d.id] = pay;
    leftover -= pay;
  }
  // Freed = every bill this clears completely, including one the leftover
  // happened to finish off.
  const freedMonthly = targetable.reduce((s, d) => s + (applied[d.id] >= d.balance - 0.005 ? d.monthly : 0), 0);
  return { applied, leftover: Math.max(0, leftover), freedMonthly };
}

export function monthlyInterest(balance, apr) {
  if (!apr) return 0;
  return balance * (apr / 100 / 12);
}

// A stored balance (payoff) is accurate as of its anchor date, already
// reflecting every payment made through it. Only payments dated strictly
// after the anchor reduce the running balance below — earlier payments are
// already baked into the stored figure and would double-count. Each debt
// carries its own anchor (`balanceAsOf`, set whenever its payoff is
// entered or updated); this is the fallback for balances entered before
// per-debt anchors existed.
export const BALANCE_ANCHOR_DATE = "2026-08-22";

export function balanceAnchorOf(debt) {
  return debt?.balanceAsOf || BALANCE_ANCHOR_DATE;
}

const DAY_MS = 86400000;

// Walks a debt's payment history since the anchor date, splitting each
// payment into interest and principal, in order, so the running balance
// reflects what's actually been paid down rather than the static number
// originally typed in. Interest accrues daily — APR/365 for each day since
// the previous payment (or since the anchor, for the first one) — so a
// bill paid in three parts accrues the same interest as one paid in full,
// instead of being charged a full month of interest per payment.
// Missing APR: the whole payment goes to principal, and the result is
// flagged as an estimate. A payment smaller than the interest it's meant
// to cover doesn't get clamped — the shortfall grows the balance instead,
// and `growing` is set so that isn't hidden from the user.
export function computeRunningBalance(debt, allPayments) {
  const hasStartingBalance = debt.balance !== null && debt.balance !== undefined;
  if (!hasStartingBalance) {
    return { balance: debt.balance, principalPaid: 0, isEstimate: false, growing: false };
  }

  const anchor = new Date(balanceAnchorOf(debt) + "T00:00:00");
  const hasApr = debt.apr !== null && debt.apr !== undefined && Number(debt.apr) > 0;

  // A payment counts if it's dated after the payoff's as-of date, or filed
  // under a later bill month — November's bill paid early, on Oct 30, isn't
  // in an Oct 31 payoff.
  const anchorMonth = monthKeyOf(anchor);
  const relevant = allPayments
    .filter((p) => p.date && (new Date(p.date + "T00:00:00") > anchor || (p.month && p.month > anchorMonth)))
    .slice()
    .sort((a, b) => new Date(a.date + "T00:00:00") - new Date(b.date + "T00:00:00"));

  let balance = Number(debt.balance);
  let principalPaid = 0;
  let growing = false;
  let accruedThrough = anchor;
  let paymentsApplied = 0;

  for (const p of relevant) {
    const amount = Number(p.amount) || 0;
    if (amount <= 0) continue;
    paymentsApplied++;
    const paidOn = new Date(p.date + "T00:00:00");
    // Rounded: a span crossing a daylight-saving change is 23 or 25 hours short of whole days.
    const days = Math.max(0, Math.round((paidOn - accruedThrough) / DAY_MS));
    if (paidOn > accruedThrough) accruedThrough = paidOn;
    const interest = hasApr ? balance * (Number(debt.apr) / 100 / 365) * days : 0;
    const principal = amount - interest;
    if (principal < 0) growing = true;
    balance = Math.max(0, balance - principal);
    principalPaid += principal;
  }

  return { balance, principalPaid, isEstimate: !hasApr, growing, paymentsApplied, asOf: balanceAnchorOf(debt), accruedThrough: isoDate(accruedThrough) };
}

function dayOf(iso) {
  return new Date(iso + "T00:00:00");
}

function startOfDate(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// Bills saved before "twice a month" existed could be set to autopay
// "every 2 weeks" from a first-debit date. They read as twice a month: the
// first debit's day of the month and the day two weeks after it, at the
// per-debit amount — until someone opens and saves them.
function isLegacyBiweekly(bill) {
  return !!bill?.autopay && bill.autopayFrequency === "biweekly" && !bill.twiceMonthly;
}

// A twice-a-month bill: the monthly payment the lender requires, split into
// two payments with their own due days, both coming off the same balance.
// Always 24 payments a year — exactly the monthly payment every month.
export function isTwiceMonthly(bill) {
  return !!bill?.twiceMonthly || isLegacyBiweekly(bill);
}

// The day(s) of the month a bill is due, earliest first: its due day, or
// both of a twice-a-month bill's.
export function paymentDaysOf(bill) {
  if (bill?.twiceMonthly) return [bill.dueDay, bill.dueDay2].map(Number).filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b);
  if (isLegacyBiweekly(bill)) {
    const first = bill.autopayAnchor ? dayOf(bill.autopayAnchor) : null;
    if (!first || isNaN(first)) return [];
    const second = new Date(first);
    second.setDate(second.getDate() + 14);
    return [first.getDate(), second.getDate()].sort((a, b) => a - b);
  }
  return bill?.dueDay ? [Number(bill.dueDay)] : [];
}

// The amount of each payment: half the monthly payment unless set, for a
// twice-a-month bill; the monthly payment otherwise.
export function perPaymentOf(bill) {
  if (bill?.twiceMonthly) return Number(bill.paymentAmount ?? Number(bill.monthly || 0) / 2) || 0;
  if (isLegacyBiweekly(bill)) return Number(bill.autopayAmount ?? Number(bill.monthly || 0) / 2) || 0;
  return Number(bill?.monthly) || 0;
}

// A bill's monthly payment — the one figure every page uses for it: the
// Debts and Fixed lists, the Monthly Plan, DTI, cash flow, payoff speed and
// money freed by a payoff. For a twice-a-month bill it's its two payments
// (MK Upstart: 2 × $250 = $500), so the two can never disagree.
export function monthlyOutflow(bill) {
  if (isTwiceMonthly(bill)) return perPaymentOf(bill) * 2;
  return Number(bill?.monthly) || 0;
}

// A bill's due dates in one calendar month, earliest first.
export function paymentDatesInMonth(bill, year, monthIndex) {
  return paymentDaysOf(bill).map((d) => dueDateInMonth(d, year, monthIndex)).sort((a, b) => a - b);
}

// Which of a month's payments each logged payment counts toward. A payment
// logged from a "payment 2 of 2" row is tagged `part: 2` and goes there;
// anything else fills the month's payments in order, earliest first, by
// date — so a late payment 1 still counts as payment 1, and one $500
// covers both $250s. Anything beyond the month's payments stays on the
// last one (it's paid over). Returns one slot per payment: its date,
// amount, what's matched to it — `matched` (logged, whenever it's dated)
// and `matchedSettled` (already happened or marked cleared) — and the ids
// of those payments. The balance, the Monthly Plan, the paycheck plan and
// reminders all match this way, so they agree on what's paid.
export function matchPaymentsToDebits(dates, amountPerPayment, regularPayments, today = new Date()) {
  const slots = dates.map((date, i) => ({ part: i + 1, date, amount: amountPerPayment, matched: 0, matchedSettled: 0, paymentIds: [] }));
  if (slots.length === 0) return slots;
  const add = (slot, p, amt) => {
    slot.matched += amt;
    if (isPaymentSettled(p, today)) slot.matchedSettled += amt;
    if (!slot.paymentIds.includes(p.id)) slot.paymentIds.push(p.id);
  };
  const list = (regularPayments || []).filter((p) => Number(p.amount) > 0);
  const tagged = (p) => p.part && slots[p.part - 1];
  for (const p of list) if (tagged(p)) add(slots[p.part - 1], p, Number(p.amount));
  const untagged = list.filter((p) => !tagged(p)).sort((x, y) => String(x.date || "").localeCompare(String(y.date || "")));
  for (const p of untagged) {
    let left = Number(p.amount);
    for (const slot of slots) {
      if (left <= 0.005) break;
      const room = slot.amount - slot.matched;
      if (room <= 0.005) continue;
      const take = Math.min(room, left);
      add(slot, p, take);
      left -= take;
    }
    if (left > 0.005) add(slots[slots.length - 1], p, left);
  }
  return slots;
}

// Each month's payment slots for a bill, matched against what's logged.
function monthSlots(bill, paidByMonth, year, monthIndex, today) {
  const dates = paymentDatesInMonth(bill, year, monthIndex);
  if (dates.length === 0) return [];
  const rec = getPaymentRecord(paidByMonth?.[monthKeyOf(new Date(year, monthIndex, 1))] || {}, bill);
  return matchPaymentsToDebits(dates, perPaymentOf(bill), rec.regularPayments, today);
}

// An autopay bill's debits dated after `from` and on or before `to`, less
// whatever a hand-logged payment already stands in for, so the same money
// is never counted twice.
function autopayDebitsBetween(debt, paidByMonth, from, to) {
  if (!debt?.autopay || !(from <= to)) return [];
  const out = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  for (let guard = 0; cursor <= to && guard < 600; guard++) {
    for (const slot of monthSlots(debt, paidByMonth, cursor.getFullYear(), cursor.getMonth())) {
      const left = slot.amount - Math.min(slot.amount, slot.matched);
      if (slot.date > from && slot.date <= to && left > 0.005) out.push({ amount: Math.round(left * 100) / 100, date: isoDate(slot.date), autopay: true });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

// Autopay debits itself with nothing logged by hand, so its debits since
// the payoff's anchor date count as payments too — otherwise an autopay
// debt's balance would never move.
export function autopayDebitsSince(debt, paidByMonth, today = new Date()) {
  return autopayDebitsBetween(debt, paidByMonth, dayOf(balanceAnchorOf(debt)), startOfDate(today));
}

// Flattens every payment recorded anywhere in paidByMonth for one bill,
// across every month — a running balance needs the bill's whole payment
// history since the anchor, not just whichever month is being viewed.
export function allPaymentsForBill(paidByMonth, billId) {
  const out = [];
  for (const [month, monthEntry] of Object.entries(paidByMonth || {})) {
    const raw = monthEntry[billId];
    if (raw && typeof raw === "object" && Array.isArray(raw.payments)) {
      out.push(...raw.payments.map((p) => ({ ...p, month })));
    } else if (raw && typeof raw === "object" && raw.amountPaid > 0) {
      out.push({ amount: raw.amountPaid, date: raw.paidDate || null, month });
    } else if (raw === true) {
      // legacy boolean records have no bill context here; skipped — they
      // predate running balances entirely and were paid before the anchor.
    }
  }
  return out;
}

// Payments still ahead of `from`, through `to`, that a payoff on a future
// date should count: payments already logged with a later date, autopay
// debits, and — for a bill paid by hand — whatever's unpaid of each of its
// payments (one a month, or two for twice a month), assumed paid on its due
// date (or tomorrow, if one this month has already slipped by unpaid). Each is tagged so the
// calculator can say what it assumed.
export function scheduledPayments(debt, paidByMonth, from, to) {
  const out = [];
  for (const p of allPaymentsForBill(paidByMonth, debt.id)) {
    if (!p.date || !(Number(p.amount) > 0)) continue;
    const d = dayOf(p.date);
    if (d > from && d <= to) out.push({ ...p, scheduled: true });
  }
  if (debt.autopay) {
    out.push(...autopayDebitsBetween(debt, paidByMonth, from, to).map((p) => ({ ...p, scheduled: true })));
  } else {
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const tomorrow = new Date(from);
    tomorrow.setDate(tomorrow.getDate() + 1);
    for (let guard = 0; cursor <= to && guard < 600; guard++) {
      const thisMonth = cursor.getFullYear() === from.getFullYear() && cursor.getMonth() === from.getMonth();
      for (const slot of monthSlots(debt, paidByMonth, cursor.getFullYear(), cursor.getMonth())) {
        const unpaid = slot.amount - Math.min(slot.amount, slot.matched);
        // Only this month's can already be behind `from`: assume it's paid tomorrow.
        const date = slot.date > from ? slot.date : thisMonth ? tomorrow : null;
        if (unpaid > 0.005 && date && date <= to) out.push({ amount: Math.round(unpaid * 100) / 100, date: isoDate(date), scheduled: true, assumed: true });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return out.sort((a, b) => dayOf(a.date) - dayOf(b.date));
}

// The payoff on `onDate`: the stored payoff rolled forward through every
// payment since its as-of date (each split into interest and principal),
// PLUS the interest that's built up since the last payment. A lender's
// payoff quote includes that interest; the balance right after a payment
// doesn't — on MK Upstart that's ~$109 ten days after a debit.
//
// For today or an earlier date, only payments that have actually happened
// by then count — a payment scheduled for next week hasn't lowered today's
// payoff yet. For a future date, scheduled payments (see above) count too.
// Returns null for a debt with no payoff entered.
export function projectPayoff(debt, paidByMonth, onDate = new Date(), today = new Date()) {
  if (debt?.balance === null || debt?.balance === undefined || debt.balance === "") return null;
  const pbm = paidByMonth || {};
  const t = startOfDate(today);
  const target = startOfDate(onDate);
  const cutoff = target < t ? target : t;
  const anchor = dayOf(balanceAnchorOf(debt));

  const happened = allPaymentsForBill(pbm, debt.id).filter((p) => p.date && dayOf(p.date) <= cutoff);
  const debited = autopayDebitsBetween(debt, pbm, anchor, cutoff);
  const scheduled = target > t ? scheduledPayments(debt, pbm, t, target) : [];
  const rb = computeRunningBalance(debt, [...happened, ...debited, ...scheduled]);

  const hasApr = debt.apr !== null && debt.apr !== undefined && debt.apr !== "" && Number(debt.apr) > 0;
  const accruedThrough = dayOf(rb.accruedThrough);
  const days = Math.max(0, Math.round((target - accruedThrough) / DAY_MS));
  const interest = hasApr && rb.balance > 0 ? rb.balance * (Number(debt.apr) / 100 / 365) * days : 0;
  const payoff = rb.balance + interest;
  return {
    ...rb,
    balance: payoff,
    payoff,
    onDate: isoDate(target),
    balanceAfterLastPayment: rb.balance,
    interestSinceLastPayment: interest,
    daysOfInterest: days,
    lastPaymentDate: accruedThrough > anchor ? rb.accruedThrough : null,
    beforeAsOf: target < anchor,
    scheduledCount: scheduled.length,
    scheduledTotal: scheduled.reduce((s, p) => s + Number(p.amount || 0), 0),
    assumedCount: scheduled.filter((p) => p.assumed).length,
  };
}

// Every debt's payoff as of today, keyed by id — the one figure the whole
// app uses for "what's owed": the Debts list, the wall, the projection and
// the Extra money suggestions. Calculated once per render instead of once
// per place it's displayed.
export function computeAllRunningBalances(debts, paidByMonth, today = new Date()) {
  const result = {};
  for (const d of debts) {
    result[d.id] = projectPayoff(d, paidByMonth, today, today) || computeRunningBalance(d, []);
  }
  return result;
}

// Every logged bill/debt payment, reshaped into the same {amount, date,
// category, note} shape as a manually-logged expense — so the Expenses tab
// can show "money going out the door" as one combined feed without storing
// a second, driftable copy of what's already tracked in paidByMonth. Source
// is tagged "bill" so the UI can tell these apart from manual entries (they
// aren't editable/deletable from the Expenses tab — that happens on the
// Monthly Plan, where the underlying payment actually lives).
export function derivedBillExpenses(debts, fixed, paidByMonth) {
  const bills = new Map([
    ...debts.filter((d) => d.isDebt !== false).map((d) => [d.id, { name: d.name, category: d.type }]),
    ...fixed.map((f) => [f.id, { name: f.name, category: f.type }]),
  ]);
  const out = [];
  for (const [monthKey, monthEntry] of Object.entries(paidByMonth || {})) {
    for (const billId of Object.keys(monthEntry)) {
      const bill = bills.get(billId);
      if (!bill) continue;
      const rec = getPaymentRecord(monthEntry, { id: billId });
      for (const p of rec.payments) {
        const amount = Number(p.amount) || 0;
        if (amount <= 0) continue;
        out.push({
          // Month included: every pre-"multiple payments" record reads back
          // with the same payment id ("legacy"), so the same bill in two
          // different months would otherwise collide as React keys.
          id: `bill:${monthKey}:${billId}:${p.id}`,
          amount,
          date: p.date || `${monthKey}-01`,
          category: bill.category || "Other",
          note: bill.name,
          source: "bill",
          extra: isExtraPayment(p),
        });
      }
    }
  }
  return out;
}

// A protected ("forever") debt never receives extra payments by design —
// so if its own minimum doesn't even cover the interest it's accruing,
// there is no path to ever paying it off: it compounds forever. Left in
// the simulation, that's not a slow realistic decline, it's unbounded
// exponential growth (a few thousand dollars can reach into the millions
// within a few decades) that swamps the whole household's projection.
// Real minimums usually scale with balance (e.g. "2% or $25, whichever is
// greater"); this app's minimum is a fixed number that never adjusts, so
// nothing here would ever catch up on its own.
export function isUnderwater(d) {
  const apr = Number(d.apr) || 0;
  if (apr <= 0) return false;
  return monthlyOutflow(d) < monthlyInterest(Number(d.balance || 0), apr);
}

// True for any debt allocateExtra (above) will never send a dollar to —
// either because it's marked "minimum only, forever," or because its
// "Goal" checkbox is unticked (excluded from the payoff goal). Both mean
// the same thing for the simulation below: nothing but its own minimum
// will ever touch this balance, so if that minimum doesn't even cover
// interest, it has to be frozen the same way — otherwise it compounds
// unchecked for the full projection window with no code path that could
// ever pay it down, ballooning the chart into the millions.
export function willNeverGetExtra(d) {
  return !!(d.protected || d.excludeFromGoal);
}

// One month of interest and minimum payments on every working debt.
// Returns the minimum-payment money that's now free: every paid-off debt's
// whole payment, plus whatever a final payment didn't need. A real snowball
// or avalanche rolls that into the next debt, so the projection does too —
// otherwise each payoff would quietly shrink the budget going to debt.
function payMinimums(working) {
  let freed = 0;
  for (const d of working) {
    const monthly = monthlyOutflow(d);
    if (d.balance <= 0) {
      freed += monthly;
      continue;
    }
    d.balance += monthlyInterest(d.balance, d.apr);
    const min = Math.min(monthly, d.balance);
    d.balance -= min;
    freed += monthly - min;
  }
  return freed;
}

function stuckReason(d) {
  const monthly = monthlyOutflow(d);
  if (monthly <= 0) return "no monthly payment";
  if (monthly <= monthlyInterest(d.balance, d.apr)) return "its payment doesn't cover the interest";
  return "not paid off within 40 years at this pace";
}

// Simulates forward month by month.
export function simulatePayoff(debts, recurringExtra, boosts, strategy, opts = {}) {
  const capMonths = opts.capMonths || 480;
  const { income, targetDTI, mortgageEstimate } = opts;

  const underwaterFrozen = debts.filter((d) => d.isDebt !== false && willNeverGetExtra(d) && d.balance > 0 && isUnderwater(d));
  const frozenBalance = underwaterFrozen.reduce((s, d) => s + Number(d.balance || 0), 0);

  const constantMonthly = debts
    .filter((d) => d.isDebt !== false && (d.balance === null || d.balance === undefined || (willNeverGetExtra(d) && isUnderwater(d))))
    .reduce((s, d) => s + monthlyOutflow(d), 0);

  let working = debts
    .filter((d) => d.isDebt !== false && d.balance > 0 && !(willNeverGetExtra(d) && isUnderwater(d)))
    .map((d) => ({ ...d }));
  const startingBalances = new Map(working.map((d) => [d.id, d.balance]));

  const series = [{ month: 0, label: "Now", total: working.reduce((s, d) => s + d.balance, 0) + frozenBalance }];
  let freedomMonth = null;
  let fullFreedomMonth = null;
  let dtiTargetMonth = null;
  let dtiWithMortgageTargetMonth = null;

  const wantDti = income > 0 && targetDTI !== undefined && targetDTI !== null;
  const mortgageAdd = Number(mortgageEstimate || 0);
  
  if (wantDti) {
    const nowMonthly = constantMonthly + working.reduce((s, d) => s + monthlyOutflow(d), 0);
    if ((nowMonthly / income) * 100 <= targetDTI) dtiTargetMonth = 0;
    if (((nowMonthly + mortgageAdd) / income) * 100 <= targetDTI) dtiWithMortgageTargetMonth = 0;
  }

  for (let m = 1; m <= capMonths; m++) {
    const freed = payMinimums(working);
    const boostThisMonth = boosts.filter((b) => b.month === m).reduce((s, b) => s + Number(b.amount || 0), 0);
    const extra = recurringExtra + boostThisMonth + freed;

    if (extra > 0) {
      const { applied } = allocateExtra(working, extra, strategy);
      for (const d of working) {
        if (applied[d.id]) d.balance = Math.max(0, d.balance - applied[d.id]);
      }
    }
    for (const d of working) if (d.balance < 0.5) d.balance = 0;

    const total = working.reduce((s, d) => s + d.balance, 0) + frozenBalance;
    series.push({ month: m, label: monthLabel(m), total: Math.round(total) });

    const goalDebts = working.filter((d) => !d.excludeFromGoal);
    if (freedomMonth === null && goalDebts.every((d) => d.balance <= 0)) freedomMonth = m;
    // Can never be "fully" debt-free while an underwater forever loan is
    // permanently excluded from ever reaching $0 — see isUnderwater above.
    if (fullFreedomMonth === null && underwaterFrozen.length === 0 && working.every((d) => d.balance <= 0)) fullFreedomMonth = m;

    if (wantDti && (dtiTargetMonth === null || dtiWithMortgageTargetMonth === null)) {
      const monthlyLeft = constantMonthly + working.filter((d) => d.balance > 0).reduce((s, d) => s + monthlyOutflow(d), 0);
      if (dtiTargetMonth === null && (monthlyLeft / income) * 100 <= targetDTI) dtiTargetMonth = m;
      if (dtiWithMortgageTargetMonth === null && ((monthlyLeft + mortgageAdd) / income) * 100 <= targetDTI) dtiWithMortgageTargetMonth = m;
    }

    if (freedomMonth !== null && fullFreedomMonth !== null && (!wantDti || (dtiTargetMonth !== null && dtiWithMortgageTargetMonth !== null))) break;
  }

  // underwaterDebts (above) only catches debts structurally barred from
  // ever getting extra money. This catches the other way a debt can spiral
  // in the projection: it's perfectly eligible for extra payments, but
  // sits behind other debts in the payoff order long enough that its own
  // interest outgrows it before its turn ever comes — same runaway-chart
  // symptom, different cause, so it needs its own name in the "Heads up"
  // banner rather than silently inflating the total with no explanation.
  const stillGrowing = working.filter((d) => d.balance > 0 && d.balance > (startingBalances.get(d.id) || 0) + 1);

  return {
    series, freedomMonth, fullFreedomMonth, dtiTargetMonth, dtiWithMortgageTargetMonth,
    // Why a date never arrives: goal debts still owing at the end of the
    // window, and debts left out because there's no payoff to project.
    stuckGoalDebts: freedomMonth === null ? working.filter((d) => !d.excludeFromGoal && d.balance > 0).map((d) => ({ id: d.id, name: d.name, reason: stuckReason(d) })) : [],
    noPayoffDebts: debts.filter((d) => d.isDebt !== false && (d.balance === null || d.balance === undefined)).map((d) => d.name),
    underwaterDebts: underwaterFrozen.map((d) => d.name),
    // Names are for display only — anything that needs to find "this
    // debt" in the list matches by id, since two debts can share a name.
    stillGrowingDebts: stillGrowing.map((d) => d.name),
    stillGrowingDebtIds: stillGrowing.map((d) => d.id),
  };
}

// `debts` should carry running balances (what's actually owed today), not
// the stored anchor balances.
export function fastestStrategyForBoost(debts, boostAmount, recurringExtra, existingBoosts) {
  const candidates = ["tiered", "snowball", "avalanche", "maxcashflow"];
  let best = null;
  // Compared as a number: a strategy with no debt-free date in the window is
  // Infinity, not null — `fm < null` is always false, so a first strategy
  // with no date used to beat everything after it.
  let bestMonth = Infinity;
  for (const strat of candidates) {
    const result = strat === "maxcashflow"
      ? simulatePayoffWithFirstMoveOverride(debts, recurringExtra, existingBoosts, boostAmount)
      : simulatePayoff(debts, recurringExtra, [...existingBoosts, { month: 1, amount: boostAmount }], strat);
    const fm = result.freedomMonth ?? Infinity;
    if (!best || fm < bestMonth) {
      best = { strategy: strat, freedomMonth: result.freedomMonth };
      bestMonth = fm;
    }
  }
  return best;
}

const SUGGESTION_STRATEGY_LABEL = { tiered: "your tiers", snowball: "snowball", avalanche: "avalanche", maxcashflow: "the cash-flow combo" };

function suggestionRows(applied, sourceDebts) {
  return sourceDebts
    .filter((d) => applied[d.id] > 0.005)
    .map((d) => {
      const amount = Math.round(applied[d.id] * 100) / 100;
      const newBalance = Math.max(0, Math.round((d.balance - applied[d.id]) * 100) / 100);
      return { id: d.id, name: d.name, applied: amount, newBalance, paidOff: newBalance <= 0.005, autopay: !!d.autopay };
    });
}

// "Extra money this month": where one specific amount does the most good,
// three ways at once. A pure function of current data — the UI recomputes
// it whenever balances or payments change, so it can't go stale the way a
// stored suggestion did. `debts` must carry each debt's payoff as of today
// (computeAllRunningBalances) — that's exactly what it takes to clear one
// completely today, interest since its last payment included. Paying a debt
// off also covers whatever's left of its own payment this month.
export function suggestExtraAllocation({ amount, debts, recurringExtra = 0, boosts = [] }) {
  const adjusted = debts;
  const cash = allocateMaxCashFlow(adjusted, amount);
  const interest = allocateExtra(adjusted, amount, "avalanche");
  const fastestPick = fastestStrategyForBoost(debts, amount, recurringExtra, boosts);
  const fastestApplied = fastestPick.strategy === "maxcashflow" ? cash.applied : allocateExtra(adjusted, amount, fastestPick.strategy).applied;
  const fastestSpent = Object.values(fastestApplied).reduce((s, v) => s + v, 0);
  const targetableTotal = adjusted
    .filter((d) => d.isDebt !== false && !d.protected && !d.excludeFromGoal && d.balance > 0)
    .reduce((s, d) => s + d.balance, 0);
  return {
    amount,
    targetableTotal,
    cashFlow: { rows: suggestionRows(cash.applied, adjusted), leftover: cash.leftover, freedMonthly: cash.freedMonthly },
    interestCost: { rows: suggestionRows(interest.applied, adjusted), leftover: interest.leftover },
    fastest: {
      rows: suggestionRows(fastestApplied, adjusted),
      leftover: Math.max(0, amount - fastestSpent),
      strategyLabel: SUGGESTION_STRATEGY_LABEL[fastestPick.strategy],
      freedomMonth: fastestPick.freedomMonth,
    },
  };
}

export function simulatePayoffWithFirstMoveOverride(debts, recurringExtra, existingBoosts, boostAmount, capMonths = 480) {
  const underwaterFrozen = debts.filter((d) => d.isDebt !== false && willNeverGetExtra(d) && d.balance > 0 && isUnderwater(d));
  const frozenBalance = underwaterFrozen.reduce((s, d) => s + Number(d.balance || 0), 0);
  let working = debts
    .filter((d) => d.isDebt !== false && d.balance > 0 && !(willNeverGetExtra(d) && isUnderwater(d)))
    .map((d) => ({ ...d }));
  const series = [{ month: 0, label: "Now", total: working.reduce((s, d) => s + d.balance, 0) + frozenBalance }];
  let freedomMonth = null;

  for (let m = 1; m <= capMonths; m++) {
    const freed = payMinimums(working);
    const boostThisMonth = existingBoosts.filter((b) => b.month === m).reduce((s, b) => s + Number(b.amount || 0), 0)
      + (m === 1 ? boostAmount : 0);
    if (boostThisMonth > 0) {
      const { applied } = m === 1 ? allocateMaxCashFlow(working, boostThisMonth) : allocateExtra(working, boostThisMonth, "tiered");
      for (const d of working) if (applied[d.id]) d.balance = Math.max(0, d.balance - applied[d.id]);
    }
    if (recurringExtra + freed > 0) {
      const { applied } = allocateExtra(working, recurringExtra + freed, "tiered");
      for (const d of working) if (applied[d.id]) d.balance = Math.max(0, d.balance - applied[d.id]);
    }
    for (const d of working) if (d.balance < 0.5) d.balance = 0;
    const total = working.reduce((s, d) => s + d.balance, 0) + frozenBalance;
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

// The local calendar date as YYYY-MM-DD. Not toISOString(): that's UTC,
// which is already "tomorrow" on a US evening — so a payment marked paid
// at 8pm used to be dated tomorrow and sit as "scheduled" overnight.
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// A payment counts as money that's actually left the account — "settled" —
// once its date is today or earlier, or it's been manually checked
// "Cleared". A future-dated, unconfirmed payment is real (it's on the
// books, and reduces what's available to spend) but isn't settled yet: it
// shouldn't read as done until one of those becomes true.
export function isPaymentSettled(payment, today = new Date()) {
  if (payment.cleared) return true;
  if (!payment.date) return false;
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const d = new Date(payment.date + "T00:00:00");
  return d <= t;
}

// Normalizes a stored Monthly Plan payment record for one bill in one
// month. Older saved data stored a plain `true`/`false` here (from before
// partial payments existed) — read as fully paid / not paid so nothing
// breaks; those predate settlement tracking entirely, so they're treated
// as already cleared rather than newly "scheduled".
// A bill/month's payment record is a list of individual payments — each
// with its own amount, date, cleared status, and bank — so a bill split
// across several partial payments (or several paychecks) can be tracked
// piece by piece instead of one all-or-nothing total. `amountPaid` is
// derived as the sum of every payment (what's committed); `settledAmount`
// is the sum of only the payments that have actually happened.
//
// "Extra" payments (kind: "extra", logged from the Extra money card) are
// real money against the bill — they're in `payments`, so they move the
// running balance and show up everywhere payments do — but they're kept out
// of amountPaid/settledAmount and reported separately as `extraPaid`, so
// throwing extra money at a bill never marks its regular payment as made.
export function isExtraPayment(p) {
  return p?.kind === "extra";
}

function sumPayments(list, onlySettled = false) {
  return list.reduce((s, p) => s + (!onlySettled || isPaymentSettled(p) ? Number(p.amount) || 0 : 0), 0);
}

export function getPaymentRecord(monthEntry, item) {
  const raw = (monthEntry || {})[item.id];
  if (raw && typeof raw === "object" && Array.isArray(raw.payments)) {
    const regularPayments = raw.payments.filter((p) => !isExtraPayment(p));
    const extraPayments = raw.payments.filter(isExtraPayment);
    return {
      payments: raw.payments,
      regularPayments,
      extraPayments,
      amountPaid: sumPayments(regularPayments),
      settledAmount: sumPayments(regularPayments, true),
      extraPaid: sumPayments(extraPayments),
    };
  }
  // Older saved shapes, from before multiple partial payments existed.
  if (raw && typeof raw === "object") {
    const amt = Number(raw.amountPaid) || 0;
    const payments = amt > 0.005 ? [{ id: "legacy", amount: amt, date: raw.paidDate || null, cleared: true, bank: raw.bank || "" }] : [];
    return { payments, regularPayments: payments, extraPayments: [], amountPaid: amt, settledAmount: amt, extraPaid: 0 };
  }
  if (raw === true) {
    const amt = Number(item.monthly) || 0;
    const payments = amt > 0.005 ? [{ id: "legacy", amount: amt, date: null, cleared: true, bank: "" }] : [];
    return { payments, regularPayments: payments, extraPayments: [], amountPaid: amt, settledAmount: amt, extraPaid: 0 };
  }
  return { payments: [], regularPayments: [], extraPayments: [], amountPaid: 0, settledAmount: 0, extraPaid: 0 };
}

function newPaymentId() {
  return `p${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

export function addPaymentRecord(paidByMonth, monthKey, billId, payment) {
  const entry = paidByMonth[monthKey] || {};
  const rec = getPaymentRecord(entry, { id: billId, monthly: 0 });
  const payments = [...rec.payments, { id: newPaymentId(), cleared: false, bank: "", ...payment }];
  return { ...paidByMonth, [monthKey]: { ...entry, [billId]: { payments } } };
}

export function removePaymentRecord(paidByMonth, monthKey, billId, paymentId) {
  const entry = paidByMonth[monthKey] || {};
  const rec = getPaymentRecord(entry, { id: billId, monthly: 0 });
  const payments = rec.payments.filter((p) => p.id !== paymentId);
  return { ...paidByMonth, [monthKey]: { ...entry, [billId]: { payments } } };
}

export function updatePaymentRecord(paidByMonth, monthKey, billId, paymentId, patch) {
  const entry = paidByMonth[monthKey] || {};
  const rec = getPaymentRecord(entry, { id: billId, monthly: 0 });
  const payments = rec.payments.map((p) => (p.id === paymentId ? { ...p, ...patch } : p));
  return { ...paidByMonth, [monthKey]: { ...entry, [billId]: { payments } } };
}

// "Mark unpaid" — clears the bill's regular payments for the month but
// keeps any extra payments, which were never part of "paid" to begin with.
export function clearPaymentRecord(paidByMonth, monthKey, billId) {
  const entry = paidByMonth[monthKey] || {};
  const { extraPayments } = getPaymentRecord(entry, { id: billId, monthly: 0 });
  return { ...paidByMonth, [monthKey]: { ...entry, [billId]: { payments: extraPayments } } };
}

// Logs one "Apply this" from the Extra money card: one extra payment per
// bill, all sharing a batchId so the whole batch can be undone together.
export function addExtraPayments(paidByMonth, monthKey, allocations, { batchId, date, appliedAt }) {
  let next = paidByMonth;
  for (const { billId, amount } of allocations) {
    if (!(amount > 0.005)) continue;
    next = addPaymentRecord(next, monthKey, billId, { amount, date, kind: "extra", batchId, appliedAt });
  }
  return next;
}

export function removeExtraBatch(paidByMonth, batchId) {
  const out = {};
  for (const [monthKey, entry] of Object.entries(paidByMonth || {})) {
    let touched = false;
    const nextEntry = {};
    for (const [billId, raw] of Object.entries(entry || {})) {
      if (raw && Array.isArray(raw.payments) && raw.payments.some((p) => p.batchId === batchId)) {
        nextEntry[billId] = { ...raw, payments: raw.payments.filter((p) => p.batchId !== batchId) };
        touched = true;
      } else {
        nextEntry[billId] = raw;
      }
    }
    out[monthKey] = touched ? nextEntry : entry;
  }
  return out;
}

// The most recently applied extra-money batch still on the books, or null —
// what the Extra money card's Undo acts on.
export function latestExtraBatch(paidByMonth) {
  const batches = new Map();
  for (const [monthKey, entry] of Object.entries(paidByMonth || {})) {
    for (const [billId, raw] of Object.entries(entry || {})) {
      if (!raw || !Array.isArray(raw.payments)) continue;
      for (const p of raw.payments) {
        if (!isExtraPayment(p) || !p.batchId) continue;
        const batch = batches.get(p.batchId) || { batchId: p.batchId, appliedAt: p.appliedAt || p.date || "", date: p.date, total: 0, items: [] };
        batch.total += Number(p.amount) || 0;
        batch.items.push({ billId, monthKey, amount: Number(p.amount) || 0 });
        batches.set(p.batchId, batch);
      }
    }
  }
  let latest = null;
  for (const batch of batches.values()) if (!latest || batch.appliedAt > latest.appliedAt) latest = batch;
  return latest;
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

// All upcoming due-date instances for every bill within the horizon — one
// per due date, so a twice-a-month bill has two a month ("payment 1 of 2",
// "payment 2 of 2"), each for its own amount.
export function generateBillInstances(bills, horizonDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
  const instances = [];
  for (const b of bills) {
    const amount = perPaymentOf(b);
    if (!(amount > 0)) continue;
    const graceDays = Number(b.graceDays || 0);
    const cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    for (let i = 0; i < 5; i++) {
      const dates = paymentDatesInMonth(b, cursor.getFullYear(), cursor.getMonth());
      dates.forEach((dd, idx) => {
        const deadline = new Date(dd);
        deadline.setDate(deadline.getDate() + graceDays);
        if (deadline >= today && dd <= horizonEnd) {
          const parts = dates.length;
          instances.push({
            billId: b.id, name: parts > 1 ? `${b.name} · payment ${idx + 1} of ${parts}` : b.name, amount, monthOwed: monthlyOutflow(b),
            part: idx + 1, dueDate: dd, deadline, graceDays, splitFriendly: !!b.splitFriendly, autopay: !!b.autopay,
          });
        }
      });
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
export function buildPaycheckPlan(incomeSources, bills, horizonDays = 95, paidByMonth = {}, paycheckOverrides = {}, reservePerCheck = 0) {
  const paychecks = generatePaychecks(incomeSources, horizonDays, paycheckOverrides);
  const rawInstances = generateBillInstances(bills, horizonDays);
  const unscheduled = bills.filter((b) => b.isDebt !== false && paymentDaysOf(b).length === 0 && monthlyOutflow(b) > 0);
  const shortfalls = [];
  const lateButInGrace = [];

  if (paychecks.length === 0) {
    return { paychecks, unscheduled, shortfalls, lateButInGrace, noIncome: true };
  }

  // The reserve is carved out of each check's spendable capacity before any
  // bill gets assigned, so it's never something bills can eat into — a
  // check's "remaining" (leftover) always already excludes it.
  const reserve = Math.max(0, Number(reservePerCheck) || 0);
  if (reserve > 0) {
    for (const p of paychecks) {
      p.reserved = reserve;
      p.remaining -= reserve;
    }
  }

  // Bills already recorded as paid on the Monthly Plan still show up on
  // whichever paycheck they actually came from — the most recent one on or
  // before the date they were marked paid — as a struck-through "paid"
  // item, instead of vanishing from the plan entirely. Only a genuine
  // leftover balance still needs to go through normal allocation below.
  const sortedPaychecksAsc = paychecks.slice().sort((a, b) => a.date - b.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // The paycheck a payment actually came from — the most recent one on or
  // before the date it was paid. Returns null if the payment predates every
  // paycheck we're tracking (paid before the earliest known payday): that
  // money came from a paycheck outside this history, so it shouldn't
  // attach to — and shouldn't reduce the balance of — the earliest one we
  // do know about just because there's nothing earlier on record.
  function sourceCheckFor(paidDateStr) {
    const paidOn = paidDateStr ? new Date(paidDateStr + "T00:00:00") : today;
    const priorChecks = sortedPaychecksAsc.filter((p) => p.date <= paidOn);
    return priorChecks.length ? priorChecks[priorChecks.length - 1] : null;
  }

  // `monthKey` is the paidByMonth month the payment is stored under, so
  // un-marking it from a paycheck card removes it from the right place even
  // if its date was later edited into another month.
  function recordPaidItem(check, billId, name, amount, dueDate, deadline, paymentId, settled, autopay, extra, monthKey) {
    if (!check) return; // paid before any known paycheck — not this plan's to show
    check.remaining -= amount;
    check.items.push({ billId, name, amount: Math.round(amount * 100) / 100, dueDate, deadline, split: false, paid: true, settled, autopay: !!autopay, extra: !!extra, paymentId, monthKey });
  }

  const handledBillMonths = new Set();
  // A twice-a-month bill has two instances in one month; each of that
  // month's logged payments should still only land on a check once.
  const recordedPayments = new Set();
  // Which logged payments cover which of a month's due dates — matched the
  // same way as the balance and the Monthly Plan (matchPaymentsToDebits), so
  // a payment is never counted twice and an autopay debit isn't counted on
  // top of the payment logged for it.
  const billsById = new Map(bills.map((b) => [b.id, b]));
  const slotCache = new Map();
  function slotFor(inst) {
    const bill = billsById.get(inst.billId);
    const key = `${inst.billId}|${monthKeyOf(inst.dueDate)}`;
    if (!slotCache.has(key)) slotCache.set(key, bill ? monthSlots(bill, paidByMonth, inst.dueDate.getFullYear(), inst.dueDate.getMonth(), today) : []);
    return slotCache.get(key)[(inst.part || 1) - 1] || null;
  }
  const instances = [];
  for (const inst of rawInstances) {
    const mKey = monthKeyOf(inst.dueDate);
    const billMonth = `${inst.billId}|${mKey}`;
    handledBillMonths.add(billMonth);

    const monthEntry = paidByMonth[mKey] || {};
    const rec = getPaymentRecord(monthEntry, { id: inst.billId, monthly: inst.amount });
    // Every payment is attributed to whichever paycheck it actually came
    // from by its own date and reduces that check's leftover in full —
    // including anything paid beyond the bill's regular amount for the month.
    // Extra money is still money spent; it just gets labeled "extra"
    // instead of counting toward what's still owed. (Payments logged as
    // extras from the Extra money card get their own pass further down.)
    let allocated = 0;
    const monthOwed = inst.monthOwed ?? inst.amount;
    for (const pmt of rec.regularPayments) {
      const amt = Number(pmt.amount) || 0;
      const key = `${inst.billId}|${mKey}|${pmt.id}`;
      if (amt <= 0.005 || recordedPayments.has(key)) continue;
      recordedPayments.add(key);
      const isExtra = allocated >= monthOwed - 0.005;
      recordPaidItem(sourceCheckFor(pmt.date), inst.billId, billsById.get(inst.billId)?.name ?? inst.name, amt, inst.dueDate, inst.deadline, pmt.id, isPaymentSettled(pmt), false, isExtra, mKey);
      allocated += amt;
    }
    // Covered by whatever's matched to this payment (see matchPaymentsToDebits).
    const slot = slotFor(inst);
    const covered = slot ? Math.min(slot.matched, inst.amount) : Math.min(rec.amountPaid, inst.amount);
    const remainingAmount = inst.amount - covered;

    // Autopay debits itself on schedule — once its date arrives, that
    // money is already gone whether or not anyone logged it, so whatever a
    // logged payment didn't already cover is recorded as settled directly.
    if (inst.autopay && inst.dueDate <= today) {
      if (remainingAmount > 0.005) {
        recordPaidItem(sourceCheckFor(isoDate(inst.dueDate)), inst.billId, inst.name, remainingAmount, inst.dueDate, inst.deadline, `autopay-${inst.billId}-${isoDate(inst.dueDate)}`, true, true);
      }
      continue;
    }
    if (remainingAmount > 0.005) {
      instances.push({ ...inst, amount: remainingAmount });
    }
  }

  // Payments recorded on the Monthly Plan for a bill that has no scheduled
  // due-date instance this month — an unscheduled bill, or an extra payment
  // beyond what was already planned — still represent real money leaving an
  // account. Surface them on the current paycheck too, so nothing paid for
  // is invisible here. Bounded to the current month only, so an old extra
  // payment from a past month doesn't keep re-attaching itself to whatever
  // paycheck happens to be earliest in the current view.
  const currentMonthKey = monthKeyOf(today);
  const currentMonthEntry = paidByMonth[currentMonthKey] || {};
  for (const bill of bills) {
    if (handledBillMonths.has(`${bill.id}|${currentMonthKey}`)) continue;
    const rec = getPaymentRecord(currentMonthEntry, { id: bill.id, monthly: bill.monthly });
    for (const pmt of rec.regularPayments) {
      const amt = Number(pmt.amount) || 0;
      if (amt > 0.005) {
        const paidOn = pmt.date ? new Date(pmt.date + "T00:00:00") : today;
        recordPaidItem(sourceCheckFor(pmt.date), bill.id, bill.name, amt, paidOn, paidOn, pmt.id, isPaymentSettled(pmt), false, false, currentMonthKey);
      }
    }
  }

  // Extra payments (Extra money card → "Apply this") never count toward a
  // bill's minimum, but they're still money that left a paycheck: each one
  // shows on the check it came from, labeled extra. Every month is scanned
  // — sourceCheckFor already drops anything older than the checks in view —
  // so a bill on autopay, or with no due day, still shows its extras.
  const billNames = new Map(bills.map((b) => [b.id, b.name]));
  for (const [mKey, monthEntry] of Object.entries(paidByMonth)) {
    for (const billId of Object.keys(monthEntry || {})) {
      if (!billNames.has(billId)) continue;
      for (const pmt of getPaymentRecord(monthEntry, { id: billId, monthly: 0 }).extraPayments) {
        const amt = Number(pmt.amount) || 0;
        if (amt <= 0.005) continue;
        const paidOn = pmt.date ? new Date(pmt.date + "T00:00:00") : today;
        recordPaidItem(sourceCheckFor(pmt.date), billId, billNames.get(billId), amt, paidOn, paidOn, pmt.id, isPaymentSettled(pmt), false, true, mKey);
      }
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
      bestFit.items.push({ billId: inst.billId, name: inst.name, amount: inst.amount, dueDate: inst.dueDate, deadline: inst.deadline, split: false, autopay: !!inst.autopay });
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
        autopay: !!inst.autopay,
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
          autopay: !!inst.autopay,
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