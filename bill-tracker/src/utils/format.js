import { autopayPerDebit, isBiweeklyAutopay, money, monthlyOutflow } from "./finance";

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

// A bill's payment as it actually happens: "$450/mo", or for a biweekly
// autopay "$250 / 2 wks · ≈$542/mo" — the per-debit amount and what that
// works out to in an average month (26 debits a year), not the monthly
// payment field, which a biweekly debit can differ from.
export function paymentSummary(bill) {
  if (isBiweeklyAutopay(bill)) return `${money(autopayPerDebit(bill))} / 2 wks · ≈${money(monthlyOutflow(bill))}/mo`;
  return `${money(Number(bill?.monthly || 0))}/mo`;
}
