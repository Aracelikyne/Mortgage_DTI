import { isTwiceMonthly, money, monthlyOutflow, paymentDaysOf, perPaymentOf } from "./finance";

// 1 → "1st", 22 → "22nd", 13 → "13th".
export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// A stored number as an input's string value, keeping "" for null/undefined.
export function asInput(v) {
  return v === null || v === undefined ? "" : String(v);
}

// An input's string back to a number, or `empty` when it was left blank.
export function fromInput(v, empty = null) {
  return v === "" || v === null || v === undefined ? empty : Number(v);
}

// "2026-10-12" → "10/12/26".
export function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

// A bill's monthly payment for a list row: "$450/mo", or for a
// twice-a-month bill "$500/mo · 2 × $250".
export function paymentSummary(bill) {
  if (isTwiceMonthly(bill)) return `${money(monthlyOutflow(bill))}/mo · 2 × ${money(perPaymentOf(bill))}`;
  return `${money(Number(bill?.monthly || 0))}/mo`;
}

// When a bill is due: "due the 21st", or "due the 1st & 15th".
export function dueSummary(bill) {
  const days = paymentDaysOf(bill);
  return days.length ? `due the ${days.map(ordinal).join(" & ")}` : null;
}
