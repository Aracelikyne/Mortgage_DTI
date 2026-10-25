// src/utils/billStatus.js
//
// One answer, shared by the Monthly Plan and the Dashboard, to "where does
// this bill stand this month?" — so the two can never disagree.

import { addPaymentRecord, dueDateInMonth, getPaymentRecord, isoDate, isPaymentSettled, monthKeyOf, updatePaymentRecord } from "./finance";

export const DUE_SOON_DAYS = 7;

// `order` is the display order: whatever needs attention first.
export const STATUS_META = {
  pastDue: { key: "pastDue", emoji: "🔴", label: "Past due", order: 0 },
  dueSoon: { key: "dueSoon", emoji: "⚠️", label: "Due soon", order: 1 },
  upcoming: { key: "upcoming", emoji: "📅", label: "Upcoming", order: 2 },
  paid: { key: "paid", emoji: "✅", label: "Paid", order: 3 },
};
export const STATUS_ORDER = ["pastDue", "dueSoon", "upcoming", "paid"];

const DAY_MS = 86400000;

function startOfDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS); // rounded: DST days aren't 24h
}

function shortDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dollars(n) {
  return Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// A biweekly autopay's debit dates that land inside one calendar month,
// counting forward from its first debit (nothing before that — it hadn't
// started yet).
export function biweeklyDebitsInMonth(anchorIso, year, monthIndex) {
  if (!anchorIso) return [];
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0);
  const out = [];
  const d = new Date(anchorIso + "T00:00:00");
  if (isNaN(d)) return out;
  if (d < monthStart) {
    // jump close to the month instead of walking every fortnight since the anchor
    const steps = Math.floor(daysBetween(d, monthStart) / 14);
    d.setDate(d.getDate() + steps * 14);
  }
  for (let guard = 0; d <= monthEnd && guard < 10; guard++) {
    if (d >= monthStart) out.push(new Date(d));
    d.setDate(d.getDate() + 14);
  }
  return out;
}

// Where `bill` stands for the month (year, monthIndex), as of `today`.
//
//   ✅ Paid       — regular payments (not extras) cover what's owed. A
//                   future-dated payment that covers it still counts, with a
//                   "scheduled" note. Autopay counts as paid once its debit
//                   date has passed.
//   🔴 Past due   — the due date has passed and it isn't covered; while still
//                   inside the grace period it says how many grace days are
//                   left. Autopay never shows as past due.
//   ⚠️ Due soon   — due within the next 7 days.
//   📅 Upcoming   — due later, or no due day set.
//
// A partial payment keeps its date-based status; `paidAmount`/`owed` carry
// the "$X of $Y".
export function getBillStatus(bill, monthEntry, year, monthIndex, today = new Date()) {
  const t = startOfDay(today);
  const monthly = Number(bill.monthly) || 0;
  const rec = getPaymentRecord(monthEntry || {}, bill);
  const autopay = !!bill.autopay;
  const biweekly = autopay && bill.autopayFrequency === "biweekly";

  let owed = monthly;
  let dueDate = bill.dueDay ? dueDateInMonth(Number(bill.dueDay), year, monthIndex) : null;
  let debited = 0;
  let lastDebit = null;
  if (biweekly) {
    // Autopay that lands every other week: what's owed this month is that
    // month's actual debits (two, sometimes three), and each one counts as
    // paid once its date passes.
    const per = Number(bill.autopayAmount ?? monthly / 2) || 0;
    const debits = biweeklyDebitsInMonth(bill.autopayAnchor, year, monthIndex);
    owed = per * debits.length;
    const passed = debits.filter((d) => d <= t);
    debited = per * passed.length;
    lastDebit = passed[passed.length - 1] || null;
    dueDate = debits.find((d) => d > t) || lastDebit;
  } else if (autopay && dueDate && dueDate <= t) {
    debited = monthly;
    lastDebit = dueDate;
  }

  // A payment logged by hand on an autopay bill is the same money as the
  // debit, not more of it — take whichever is larger rather than adding.
  const paidAmount = Math.max(rec.amountPaid, debited);
  const settledAmount = Math.max(rec.settledAmount, debited);
  const base = {
    billId: bill.id,
    bill,
    owed,
    paidAmount: Math.min(paidAmount, owed),
    remaining: Math.max(0, owed - paidAmount),
    extraPaid: rec.extraPaid,
    dueDate,
    autopay,
    partial: false,
    scheduled: false,
    graceDaysLeft: null,
    daysLate: null,
    daysUntilDue: dueDate ? daysBetween(t, dueDate) : null,
  };
  const make = (status, note, extra = {}) => ({ ...base, ...extra, status, ...STATUS_META[status], note });

  if (owed <= 0.005) return make("paid", biweekly ? "No autopay debits this month" : "Nothing due this month");

  if (paidAmount >= owed - 0.005) {
    if (settledAmount < owed - 0.005) {
      const pending = rec.regularPayments.filter((p) => !isPaymentSettled(p) && p.date);
      const latest = pending.map((p) => p.date).sort().pop();
      return make("paid", latest ? `Scheduled for ${shortDate(new Date(latest + "T00:00:00"))}` : "Scheduled", { scheduled: true });
    }
    if (debited >= owed - 0.005 && lastDebit) return make("paid", `Autopay debited ${shortDate(lastDebit)}`);
    const latestPaid = rec.regularPayments.map((p) => p.date).filter(Boolean).sort().pop();
    return make("paid", latestPaid ? `Paid ${shortDate(new Date(latestPaid + "T00:00:00"))}` : "Paid");
  }

  const partial = paidAmount > 0.005;
  const prefix = partial ? `${dollars(paidAmount)} of ${dollars(owed)} · ` : "";

  if (autopay) {
    if (!dueDate) return make("upcoming", `${prefix}Autopay — no debit date set`, { partial });
    const days = daysBetween(t, dueDate);
    return make(days <= DUE_SOON_DAYS ? "dueSoon" : "upcoming", `${prefix}Autopay ${days === 0 ? "today" : shortDate(dueDate)}`, { partial });
  }
  if (!dueDate) return make("upcoming", `${prefix}No due date set`, { partial });

  const days = daysBetween(t, dueDate);
  if (days < 0) {
    const graceDays = Number(bill.graceDays) || 0;
    const deadline = new Date(dueDate);
    deadline.setDate(deadline.getDate() + graceDays);
    const graceLeft = daysBetween(t, deadline);
    if (graceLeft >= 0) {
      const note = graceLeft === 0 ? "last grace day" : `${graceLeft} grace day${graceLeft === 1 ? "" : "s"} left`;
      return make("pastDue", `${prefix}Was due ${shortDate(dueDate)} · ${note}`, { partial, graceDaysLeft: graceLeft });
    }
    return make("pastDue", `${prefix}Was due ${shortDate(dueDate)} · ${-days} day${days === -1 ? "" : "s"} late`, { partial, daysLate: -days });
  }
  if (days <= DUE_SOON_DAYS) {
    const when = days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due ${shortDate(dueDate)} · in ${days} days`;
    return make("dueSoon", `${prefix}${when}`, { partial });
  }
  return make("upcoming", `${prefix}Due ${shortDate(dueDate)}`, { partial });
}

// Due date first, then name — bills with no date sink to the end.
export function compareStatuses(a, b) {
  if (STATUS_META[a.status].order !== STATUS_META[b.status].order) return STATUS_META[a.status].order - STATUS_META[b.status].order;
  if (a.dueDate && b.dueDate && a.dueDate - b.dueDate !== 0) return a.dueDate - b.dueDate;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return String(a.bill.name || "").localeCompare(String(b.bill.name || ""));
}

export function statusesForMonth(bills, paidByMonth, year, monthIndex, today = new Date()) {
  const monthEntry = (paidByMonth || {})[monthKeyOf(new Date(year, monthIndex, 1))] || {};
  return bills.map((b) => getBillStatus(b, monthEntry, year, monthIndex, today)).sort(compareStatuses);
}

export function summarizeStatuses(statuses) {
  const sum = (list, key) => list.reduce((s, x) => s + x[key], 0);
  const paid = statuses.filter((s) => s.status === "paid");
  const unpaid = statuses.filter((s) => s.status !== "paid");
  return {
    owedTotal: sum(statuses, "owed"),
    paidAmount: sum(statuses, "paidAmount"),
    paidCount: paid.length,
    remainingAmount: sum(unpaid, "remaining"),
    remainingCount: unpaid.length,
    pastDueCount: statuses.filter((s) => s.status === "pastDue").length,
    dueSoonCount: statuses.filter((s) => s.status === "dueSoon").length,
    upcomingCount: statuses.filter((s) => s.status === "upcoming").length,
  };
}

// The Dashboard's "Next up": everything past due or due soon, then the next
// few upcoming. Early next-month bills that are already due soon are
// included too — at the end of October, rent due November 1st is next up.
export function nextUpBills(bills, paidByMonth, today = new Date(), upcomingLimit = 3) {
  const t = startOfDay(today);
  const thisMonth = statusesForMonth(bills, paidByMonth, t.getFullYear(), t.getMonth(), t);
  const next = new Date(t.getFullYear(), t.getMonth() + 1, 1);
  const nextMonthSoon = statusesForMonth(bills, paidByMonth, next.getFullYear(), next.getMonth(), t)
    .filter((s) => s.status === "dueSoon")
    .map((s) => ({ ...s, monthKey: monthKeyOf(next) }));
  const current = thisMonth.map((s) => ({ ...s, monthKey: monthKeyOf(t) }));
  const urgent = [...current, ...nextMonthSoon].filter((s) => s.status === "pastDue" || s.status === "dueSoon").sort(compareStatuses);
  const upcoming = current.filter((s) => s.status === "upcoming" && s.dueDate).slice(0, upcomingLimit);
  return [...urgent, ...upcoming];
}

// "Mark paid": settles payments already scheduled for the full amount, or
// logs a payment dated today for whatever's still owed.
export function markBillPaid(paidByMonth, monthKey, bill, today = new Date()) {
  const rec = getPaymentRecord(paidByMonth[monthKey] || {}, bill);
  const monthly = Number(bill.monthly) || 0;
  if (rec.amountPaid >= monthly - 0.005) {
    let next = paidByMonth;
    for (const p of rec.regularPayments) {
      if (!isPaymentSettled(p, today)) next = updatePaymentRecord(next, monthKey, bill.id, p.id, { cleared: true });
    }
    return next;
  }
  return addPaymentRecord(paidByMonth, monthKey, bill.id, { amount: Math.round((monthly - rec.amountPaid) * 100) / 100, date: isoDate(today) });
}
