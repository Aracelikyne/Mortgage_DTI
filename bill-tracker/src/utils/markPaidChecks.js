// The checks around marking a bill paid (see components/MarkPaidFlow.jsx):
// was last month's payment on the same bill ever marked, and what else is
// still past due. Both only look at payments due since the paid rules
// began (PAYMENT_RULES_START) — everything before was already current.

import { billStatusesForMonth, statusesForMonth } from "./billStatus";
import { allPaymentsForBill, balanceAnchorOf, isoDate, monthKeyOf, underPaymentRules } from "./finance";

function monthOf(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1);
}


// Last month's payments on this bill that still aren't paid — only those due
// since the rules began (PAYMENT_RULES_START), and only once the bill was
// being tracked then: after a debt's payoff as-of date (earlier
// payments are already in the payoff), or for anything else once it has
// payments logged before this month. A bill added this month never asks.
export function lastMonthUnpaid(row, monthKey, paidByMonth, today = new Date()) {
  if (row.autopay) return null;
  const prev = monthOf(monthKey);
  prev.setMonth(prev.getMonth() - 1);
  const prevKey = monthKeyOf(prev);
  const rows = billStatusesForMonth(row.bill, paidByMonth[prevKey] || {}, prev.getFullYear(), prev.getMonth(), today)
    .filter((s) => s.status !== "paid" && s.owed > 0.005 && underPaymentRules(s.dueDate));
  if (rows.length === 0) return null;
  const tracked = row.bill.balance !== undefined && row.bill.balance !== null
    ? rows.some((s) => isoDate(s.dueDate) > balanceAnchorOf(row.bill))
    : allPaymentsForBill(paidByMonth, row.billId).some((p) => p.month && p.month < monthKey);
  return tracked ? { prevKey, prev, rows } : null;
}

// Everything past due right now — this month and last, due since the rules
// began — after a change.
export function pastDueNow(bills, paidByMonth, except, today = new Date()) {
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return [
    ...statusesForMonth(bills, paidByMonth, prev.getFullYear(), prev.getMonth(), today),
    ...statusesForMonth(bills, paidByMonth, today.getFullYear(), today.getMonth(), today),
  ].filter((s) => s.status === "pastDue" && s.rowId !== except && underPaymentRules(s.dueDate));
}

