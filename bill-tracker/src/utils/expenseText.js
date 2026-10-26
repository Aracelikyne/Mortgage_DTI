// src/utils/expenseText.js
//
// Pulls a merchant, amount and date out of text read from a screenshot of
// an Apple Wallet transaction (or a receipt photo) — or text copied from
// one with iOS Live Text — so logging an expense is a confirm, not typing.

import { isoDate } from "./finance";
import { parseDate } from "./importParse";

const AMOUNT = /(?:^|[^\d.])(-?)\$?\s?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d])/;
// Amount lines that aren't the purchase itself.
const NOT_THE_AMOUNT = /daily cash|cash ?back|\btax\b|\btip\b|sub ?total|balance|limit|available|change due|savings|you saved/i;
// Wallet chrome and receipt boilerplate that's never the merchant.
const NOT_THE_MERCHANT = /^(pending|approved|declined|completed|refund|apple (card|cash|pay)|card balance|latest transactions|transactions?|total|amount|status|card number|daily cash|share|report an issue|done|back|wallet|visa|mastercard|amex|debit|credit|purchase|payment|thank you|receipt|order|subtotal|tax|today|yesterday)\b/i;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i;

function money(m) {
  return Number(m[2].replace(/,/g, "")) * (m[1] === "-" ? -1 : 1);
}

function dateFrom(line, today) {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const lower = line.toLowerCase();
  if (/\btoday\b/.test(lower)) return isoDate(t);
  if (/\byesterday\b/.test(lower)) { t.setDate(t.getDate() - 1); return isoDate(t); }
  const slash = /\b(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))\b/.exec(line);
  if (slash) return parseDate(slash[1]);
  const md = MONTH_DAY.exec(line);
  if (md) {
    const year = md[3] ? Number(md[3]) : t.getFullYear();
    let iso = parseDate(`${md[1]} ${md[2]}, ${year}`);
    // "Dec 30" read in January is last year's.
    if (iso && !md[3] && new Date(iso + "T00:00:00") > t) iso = parseDate(`${md[1]} ${md[2]}, ${year - 1}`);
    return iso;
  }
  const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(lower));
  if (wd >= 0) {
    // Wallet says "Tuesday" for the past week: the most recent one.
    const back = (t.getDay() - wd + 7) % 7 || 7;
    t.setDate(t.getDate() - back);
    return isoDate(t);
  }
  return null;
}

export function parseTransactionText(text, today = new Date()) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  let amount = null;
  // A receipt's TOTAL wins; otherwise the first amount that isn't cash
  // back, tax or a balance — on a Wallet transaction that's the purchase.
  for (const l of lines) {
    if (/\btotal\b/i.test(l) && !/sub ?total/i.test(l)) {
      const m = AMOUNT.exec(l);
      if (m) { amount = money(m); break; }
    }
  }
  if (amount === null) {
    for (const l of lines) {
      if (NOT_THE_AMOUNT.test(l)) continue;
      const m = AMOUNT.exec(l);
      if (m) { amount = money(m); break; }
    }
  }

  let date = null;
  for (const l of lines) {
    date = dateFrom(l, today);
    if (date) break;
  }

  const merchant = lines.find((l) => {
    const letters = (l.match(/[a-z]/gi) || []).length;
    return letters >= 3
      && !NOT_THE_MERCHANT.test(l)
      && !AMOUNT.test(l)
      && !dateFrom(l, today)
      && !/^\d{1,2}:\d{2}/.test(l)
      && !/^[\d\s:•·.,-]+$/.test(l);
  }) || "";

  return {
    amount: amount === null ? null : Math.abs(amount),
    refund: amount !== null && amount < 0,
    merchant: merchant.replace(/\s+(inc|llc|#\d+)\.?$/i, "").trim(),
    date,
  };
}
