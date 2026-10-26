// src/utils/statementSync.js
//
// "Update from statement": bring every bill current from a list of what
// each one stands at now (bill, monthly, due day, payoff, APR) — e.g. a
// Numbers sheet kept by hand. Payoffs and APRs on the list are trusted;
// anything that disagrees with what the app already has is flagged for a
// person to decide, never silently overwritten.

import { parseDueDay, parseMoney, parsePercent } from "./importParse";
import { ordinal } from "./format";

const FIXED_NAME = /\b(rent|mortgage|child ?care|daycare|electric(ity)?|power|water|sewer|trash|internet|wifi|insurance|utilit(y|ies)|gas bill|phone bill)\b/i;

function nameKey(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const sameNumber = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(Number(a) - Number(b)) < 0.005;

// What still has to be filled in on a debt: a payoff, an APR.
export function needsInfo(item, kind = "debts") {
  if (kind !== "debts") return [];
  const missing = [];
  if (item.balance === null || item.balance === undefined || item.balance === "") missing.push("payoff");
  if (item.apr === null || item.apr === undefined || item.apr === "") missing.push("APR");
  return missing;
}

// Flags left by a statement update for a person to settle.
export function reviewItems(item) {
  const r = item.review || {};
  const out = [];
  if (r.monthly) out.push({ key: "monthly", label: `Statement says ${fmt(r.monthly.statement)}/mo`, statement: r.monthly.statement });
  if (r.dueDay) out.push({ key: "dueDay", label: `Statement says due the ${ordinal(r.dueDay.statement)}`, statement: r.dueDay.statement });
  if (r.apr) out.push({ key: "apr", label: "APR isn't on the statement — confirm it" });
  if (r.notOnStatement) out.push({ key: "notOnStatement", label: "Not on the latest statement list" });
  return out;
}

function fmt(n) {
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

// One planned change per statement row, plus one per app bill the
// statement doesn't mention. `asOf` is the date the statement's payoffs are
// current as of; `by` is who's applying it (for the "updated by" stamp).
export function buildStatementPlan({ rows, headerRow, mapping, debts, fixed, asOf, by }) {
  const get = (cells, key) => (mapping[key] === null || mapping[key] === undefined ? "" : String(cells[mapping[key]] ?? "").trim());
  const index = new Map();
  for (const [kind, list] of [["debts", debts], ["fixed", fixed]]) {
    for (const item of list) {
      const key = nameKey(item.name);
      if (key) index.set(key, [...(index.get(key) || []), { kind, item }]);
    }
  }
  const seen = new Set();
  const plan = [];

  rows.slice(headerRow + 1).forEach((cells, i) => {
    const name = get(cells, "name");
    const rowNumber = headerRow + 2 + i;
    const entry = { index: i, rowNumber, name, problems: [], notes: [], selected: true };
    if (!name) {
      plan.push({ ...entry, kind: "skip", problems: ["no bill name"], selected: false });
      return;
    }
    const payoffRaw = get(cells, "balance");
    const aprRaw = get(cells, "apr");
    const monthlyRaw = get(cells, "monthly");
    const dueRaw = get(cells, "dueDay");
    const payoff = payoffRaw === "" ? null : parseMoney(payoffRaw);
    const apr = aprRaw === "" ? null : parsePercent(aprRaw);
    const monthly = monthlyRaw === "" ? null : parseMoney(monthlyRaw);
    const dueDay = dueRaw === "" ? null : parseDueDay(dueRaw);
    if (payoffRaw !== "" && payoff === null) entry.problems.push(`can't read payoff "${payoffRaw}"`);
    if (aprRaw !== "" && apr === null) entry.problems.push(`can't read APR "${aprRaw}"`);
    if (monthlyRaw !== "" && monthly === null) entry.problems.push(`can't read monthly "${monthlyRaw}"`);
    if (entry.problems.length) entry.selected = false;

    const matches = (index.get(nameKey(name)) || []).filter((m) => !seen.has(m.item.id));
    if ((index.get(nameKey(name)) || []).length > 1) {
      plan.push({ ...entry, kind: "skip", problems: [...entry.problems, "more than one bill in the app has this name"], selected: false });
      return;
    }

    if (matches.length === 0) {
      // New bill. Rent, childcare and utilities are fixed expenses; anything
      // else on a payoff list is a debt.
      const target = FIXED_NAME.test(name) && payoff === null ? "fixed" : "debts";
      const fields = target === "fixed"
        ? { name, type: /rent|mortgage/i.test(name) ? "Rent/Mortgage" : /child|daycare/i.test(name) ? "Childcare" : /insurance/i.test(name) ? "Insurance" : "Utility", monthly: monthly ?? 0, dueDay, graceDays: 0, note: "" }
        : { name, type: "Other Loan", monthly: monthly ?? 0, balance: payoff, apr, dueDay, graceDays: 0, priority: 2, protected: false, excludeFromGoal: false, balanceAsOf: asOf, balanceUpdatedBy: by };
      if (target === "debts") {
        if (payoff === null) entry.notes.push("no payoff — needs info");
        if (apr === null) entry.notes.push("no APR — needs info");
      }
      plan.push({ ...entry, kind: "new", target, fields });
      return;
    }

    const { kind: target, item } = matches[0];
    seen.add(item.id);
    const patch = {};
    const review = {};
    const changes = [];

    if (target === "debts") {
      // Payoff: the statement is current — take it (or clear it when the
      // statement has none), and restart the payments-since clock today.
      if (payoff !== null) {
        if (!sameNumber(payoff, item.balance)) changes.push(`payoff ${item.balance === null || item.balance === undefined ? "—" : fmt(item.balance)} → ${fmt(payoff)}`);
        patch.balance = payoff;
      } else {
        if (item.balance !== null && item.balance !== undefined) changes.push(`payoff ${fmt(item.balance)} → needs info`);
        patch.balance = null;
      }
      patch.balanceAsOf = asOf;
      patch.balanceUpdatedBy = by;
      // APR: take the statement's; if it has none, keep ours but flag it.
      if (apr !== null) {
        if (!sameNumber(apr, item.apr)) changes.push(`APR ${item.apr ?? "—"}% → ${apr}%`);
        patch.apr = apr;
      } else if (item.apr !== null && item.apr !== undefined && item.apr !== "") {
        review.apr = { missingOnStatement: true, current: item.apr };
        changes.push(`APR ${item.apr}% not on statement — review`);
      } else {
        changes.push("no APR — needs info");
      }
    }
    if (monthly !== null && !sameNumber(monthly, item.monthly)) {
      review.monthly = { statement: monthly, current: item.monthly ?? null };
      changes.push(`monthly ${fmt(item.monthly || 0)} vs statement ${fmt(monthly)} — review`);
    }
    if (dueDay !== null) {
      if (!item.dueDay) patch.dueDay = dueDay;
      else if (Number(item.dueDay) !== dueDay) {
        review.dueDay = { statement: dueDay, current: item.dueDay };
        changes.push(`due the ${ordinal(item.dueDay)} vs statement ${ordinal(dueDay)} — review`);
      }
    }
    patch.review = review; // the statement is the latest word: old flags are replaced
    plan.push({ ...entry, kind: "update", target, existingId: item.id, existingName: item.name, patch, notes: changes.length ? changes : ["already matches — payoff date refreshed"] });
  });

  // Bills the app has that the statement doesn't mention: flag, don't delete.
  for (const [target, list] of [["debts", debts], ["fixed", fixed]]) {
    for (const item of list) {
      if (seen.has(item.id) || (index.get(nameKey(item.name)) || []).length > 1) continue;
      if (plan.some((p) => p.kind === "skip" && nameKey(p.name) === nameKey(item.name))) continue;
      plan.push({
        index: plan.length, rowNumber: null, name: item.name, kind: "missing", target, existingId: item.id, existingName: item.name,
        patch: { review: { ...(item.review || {}), notOnStatement: true } }, notes: ["not on the statement — flagged for review"], problems: [], selected: true,
      });
    }
  }
  return plan;
}

// After a payment is logged on a bill flagged "not on statement" etc.,
// nothing changes — flags only clear when a person settles them. This
// resolves one flag: `accept` applies the statement's value first.
export function resolveReview(item, key, accept) {
  const review = { ...(item.review || {}) };
  const patch = {};
  if (accept && review[key]?.statement !== undefined) patch[key] = review[key].statement;
  delete review[key];
  patch.review = review;
  return patch;
}
