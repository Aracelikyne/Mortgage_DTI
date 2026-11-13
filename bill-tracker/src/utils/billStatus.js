// src/utils/billStatus.js
//
// One answer, shared by the Monthly Plan and the Dashboard, to "where does
// this bill stand this month?" — so the two can never disagree.

import { ASSUME_PAID_AFTER_DAYS, underPaymentRules, addPaymentRecord, getPaymentRecord, isoDate, isPaymentSettled, matchPaymentsToDebits, monthKeyOf, monthlyOutflow, paymentDatesInMonth, perPaymentOf, updatePaymentRecord } from "./finance";

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

// Where a bill stands for the month (year, monthIndex), as of `today` —
// one row per payment: one for most bills, two for a twice-a-month bill
// ("MK Upstart · payment 1 of 2", "payment 2 of 2"), each with its own due
// date and status, both coming off the same balance.
//
//   ✅ Paid       — payments that have actually happened cover it: marked
//                   paid, dated today or earlier, or switched to Cleared.
//                   Autopay counts as paid once its date has passed. A
//                   payment left unmarked for 60 days past its due date is
//                   assumed paid (and comes off the balance — see
//                   assumedPaymentsThrough in finance.js).
//   A payment logged for a future date doesn't make it Paid yet: it stays
//   in "To pay", noted "Scheduled for …", until that date or Cleared.
//   🔴 Past due   — its due date has passed and it isn't covered; while still
//                   inside the grace period it says how many grace days are
//                   left. Autopay never shows as past due.
//   ⚠️ Due soon   — due within the next 7 days.
//   📅 Upcoming   — due later, or no due day set.
//
// Logged payments are matched to a month's payments the same way the
// balance and the paycheck plan match them (matchPaymentsToDebits), so a
// row's "$X of $Y" is always out of that one payment.
export function billStatusesForMonth(bill, monthEntry, year, monthIndex, today = new Date()) {
  const t = startOfDay(today);
  const rec = getPaymentRecord(monthEntry || {}, bill);
  const dates = paymentDatesInMonth(bill, year, monthIndex);
  if (dates.length === 0) {
    return [rowStatus(bill, rec, { owed: monthlyOutflow(bill), committed: rec.amountPaid, settled: rec.settledAmount, dueDate: null, payments: rec.regularPayments }, t)];
  }
  const slots = matchPaymentsToDebits(dates, perPaymentOf(bill), rec.regularPayments, t);
  return slots.map((slot) => {
    const taken = !!bill.autopay && slot.date <= t; // the bank took it on its date
    return rowStatus(bill, rec, {
      part: slot.part,
      parts: slots.length,
      owed: slot.amount,
      committed: taken ? Math.max(slot.amount, slot.matched) : slot.matched,
      settled: taken ? Math.max(slot.amount, slot.matchedSettled) : slot.matchedSettled,
      taken,
      dueDate: slot.date,
      payments: rec.regularPayments.filter((p) => slot.paymentIds.includes(p.id)),
    }, t);
  });
}

// A single-payment bill's status (a twice-a-month bill's first payment).
export function getBillStatus(bill, monthEntry, year, monthIndex, today = new Date()) {
  return billStatusesForMonth(bill, monthEntry, year, monthIndex, today)[0];
}

function rowStatus(bill, rec, row, t) {
  const { part = 1, parts = 1, owed, committed, settled, taken = false, dueDate, payments } = row;
  const autopay = !!bill.autopay;
  // Unmarked 60+ days past its due date: assumed paid.
  // Both rules start with payments due on PAYMENT_RULES_START; before that, a
  // payment logged ahead still counts as paid, as it always did.
  const ruled = underPaymentRules(dueDate);
  const assumed = ruled && !taken && settled < owed - 0.005 && daysBetween(dueDate, t) > ASSUME_PAID_AFTER_DAYS;
  const paid = assumed ? owed : ruled ? settled : Math.max(settled, committed);
  const base = {
    billId: bill.id,
    rowId: parts > 1 ? `${bill.id}#${part}` : bill.id,
    part,
    parts,
    displayName: parts > 1 ? `${bill.name} · payment ${part} of ${parts}` : bill.name,
    bill,
    owed,
    // What's actually been paid; `committed` also counts payments logged for a future date.
    paidAmount: Math.min(paid, owed),
    committed: Math.min(Math.max(committed, paid), owed),
    remaining: Math.max(0, owed - paid),
    // Extra money (from the Extra money card) is the bill's, not one
    // payment's — shown once, on the first row.
    extraPaid: part === 1 ? rec.extraPaid : 0,
    overpaid: taken ? 0 : Math.max(0, committed - owed),
    paymentIds: payments.map((p) => p.id),
    dueDate,
    autopay,
    assumed,
    partial: false,
    scheduled: false,
    graceDaysLeft: null,
    daysLate: null,
    daysUntilDue: dueDate ? daysBetween(t, dueDate) : null,
  };
  const make = (status, note, extra = {}) => ({ ...base, ...extra, status, ...STATUS_META[status], note });

  if (owed <= 0.005) return make("paid", "Nothing due this month");
  if (assumed) return make("paid", `Assumed paid — not marked within ${ASSUME_PAID_AFTER_DAYS} days`);
  if (paid >= owed - 0.005) {
    if (taken) return make("paid", `Autopay debited ${shortDate(dueDate)}`);
    if (settled < owed - 0.005) {
      const ahead = payments.filter((p) => !isPaymentSettled(p, t) && p.date).map((p) => p.date).sort().pop();
      return make("paid", ahead ? `Scheduled for ${shortDate(new Date(ahead + "T00:00:00"))}` : "Scheduled", { scheduled: true });
    }
    const latestPaid = payments.map((p) => p.date).filter(Boolean).sort().pop();
    return make("paid", latestPaid ? `Paid ${shortDate(new Date(latestPaid + "T00:00:00"))}` : "Paid");
  }

  // Covered by a payment logged for a later date: still to pay until it happens.
  const scheduled = committed >= owed - 0.005;
  const pendingDate = payments.filter((p) => !isPaymentSettled(p, t) && p.date).map((p) => p.date).sort().pop();
  const scheduledNote = scheduled ? (pendingDate ? `Scheduled for ${shortDate(new Date(pendingDate + "T00:00:00"))}` : "Scheduled") : null;
  const partial = !scheduled && paid > 0.005;
  const prefix = scheduledNote ? `${scheduledNote} · ` : partial ? `${dollars(paid)} of ${dollars(owed)} · ` : "";
  const flags = { partial, scheduled };
  if (!dueDate) return make("upcoming", scheduledNote || `${prefix}${autopay ? "Autopay — no debit date set" : "No due date set"}`, flags);

  const days = daysBetween(t, dueDate);
  if (autopay) {
    return make(days <= DUE_SOON_DAYS ? "dueSoon" : "upcoming", `${prefix}Autopay ${days === 0 ? "today" : shortDate(dueDate)}`, flags);
  }
  if (days < 0) {
    const graceDays = Number(bill.graceDays) || 0;
    const deadline = new Date(dueDate);
    deadline.setDate(deadline.getDate() + graceDays);
    const graceLeft = daysBetween(t, deadline);
    if (graceLeft >= 0) {
      const note = graceLeft === 0 ? "last grace day" : `${graceLeft} grace day${graceLeft === 1 ? "" : "s"} left`;
      return make("pastDue", `${prefix}Was due ${shortDate(dueDate)} · ${note}`, { ...flags, graceDaysLeft: graceLeft });
    }
    return make("pastDue", `${prefix}Was due ${shortDate(dueDate)} · ${-days} day${days === -1 ? "" : "s"} late`, { ...flags, daysLate: -days });
  }
  if (scheduledNote) return make(days <= DUE_SOON_DAYS ? "dueSoon" : "upcoming", `${scheduledNote} · due ${shortDate(dueDate)}`, flags);
  if (days <= DUE_SOON_DAYS) {
    const when = days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due ${shortDate(dueDate)} · in ${days} days`;
    return make("dueSoon", `${prefix}${when}`, flags);
  }
  return make("upcoming", `${prefix}Due ${shortDate(dueDate)}`, flags);
}

// Due date first, then name — bills with no date sink to the end.
export function compareStatuses(a, b) {
  if (STATUS_META[a.status].order !== STATUS_META[b.status].order) return STATUS_META[a.status].order - STATUS_META[b.status].order;
  if (a.dueDate && b.dueDate && a.dueDate - b.dueDate !== 0) return a.dueDate - b.dueDate;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return String(a.bill.name || "").localeCompare(String(b.bill.name || "")) || (a.part || 1) - (b.part || 1);
}

export function statusesForMonth(bills, paidByMonth, year, monthIndex, today = new Date()) {
  const monthEntry = (paidByMonth || {})[monthKeyOf(new Date(year, monthIndex, 1))] || {};
  return bills.flatMap((b) => billStatusesForMonth(b, monthEntry, year, monthIndex, today)).sort(compareStatuses);
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
// logs a payment dated today for whatever's still owed. `row` (a status from
// billStatusesForMonth) marks just that payment of a twice-a-month bill —
// the payment logged is tagged with its part, so it counts toward it.
export function markBillPaid(paidByMonth, monthKey, bill, today = new Date(), row = null) {
  const rec = getPaymentRecord(paidByMonth[monthKey] || {}, bill);
  const split = (row?.parts || 1) > 1;
  const owed = split ? row.owed : monthlyOutflow(bill);
  const committed = split ? row.committed : rec.amountPaid;
  if (committed >= owed - 0.005) {
    const ids = split ? row.paymentIds : rec.regularPayments.map((p) => p.id);
    let next = paidByMonth;
    for (const p of rec.regularPayments) {
      if (ids.includes(p.id) && !isPaymentSettled(p, today)) next = updatePaymentRecord(next, monthKey, bill.id, p.id, { cleared: true });
    }
    return next;
  }
  return addPaymentRecord(paidByMonth, monthKey, bill.id, {
    amount: Math.round((owed - committed) * 100) / 100,
    date: isoDate(today),
    ...(split ? { part: row.part } : {}),
  });
}
