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

// Words that mean the same thing in bill names ("Cap 1" = "Capital One").
const SAME_WORD = { cap: "capital", one: "1", two: "2", three: "3", amex: "american express" };

function nameTokens(s) {
  return nameKey(s)
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .flatMap((t) => (SAME_WORD[t] || t).split(" "));
}

// How alike two bill names are, 0–1: shared words, or one name inside the
// other ("AMEX" in "Amex Blue Cash"). Only used to suggest a match for a
// person to confirm — never to update a bill on its own.
export function nameSimilarity(a, b) {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  // Names that differ only in a short tag on each side are different
  // people's or different numbered cards: "SK Upstart" / "MK Upstart",
  // "MAK Cap 1" / "MAK Cap 2".
  const onlyA = [...ta].filter((t) => !tb.has(t));
  const onlyB = [...tb].filter((t) => !ta.has(t));
  if (onlyA.length && onlyB.length && [...onlyA, ...onlyB].every((t) => t.length <= 3)) return 0;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  let score = shared / new Set([...ta, ...tb]).size;
  const ca = [...ta].join("");
  const cb = [...tb].join("");
  if (Math.min(ca.length, cb.length) >= 3 && (ca.includes(cb) || cb.includes(ca))) score = Math.max(score, 0.6);
  return score;
}

const SUGGEST_AT = 0.5;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// The date a statement's payoffs are good through. A title like
// "November 2026" above the header means the payoffs are how things stand
// going into November — everything through October 31 is already in them.
export function statementAsOfGuess(rows, headerRow, today = new Date()) {
  for (const cells of rows.slice(0, Math.max(0, headerRow))) {
    for (const cell of cells || []) {
      const m = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i.exec(String(cell ?? ""));
      if (m) {
        const firstOfMonth = new Date(Number(m[2]), MONTHS.indexOf(m[1].toLowerCase()), 1);
        firstOfMonth.setDate(0);
        return isoDate(firstOfMonth);
      }
    }
  }
  return isoDate(today);
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One planned change per statement row, plus one per app bill the
// statement doesn't mention. `asOf` is the date the statement's payoffs are
// good through (payments after it come off); `updatedOn` and `by` are when
// and by whom it's applied, for the "updated" tracker.
//
// Never adds a bill the app already has: a row whose name exactly matches
// one bill updates it; any other row gets a "Which bill is this?" choice —
// pre-set to the closest-named bill not otherwise matched, or "Add as new"
// when nothing's close — which a person confirms in the preview. `picks`
// holds what they chose, by row index: an existing bill's id, or "new".
export function buildStatementPlan({ rows, headerRow, mapping, debts, fixed, asOf, updatedOn = asOf, by, picks = {} }) {
  const get = (cells, key) => (mapping[key] === null || mapping[key] === undefined ? "" : String(cells[mapping[key]] ?? "").trim());
  const all = [...debts.map((item) => ({ kind: "debts", item })), ...fixed.map((item) => ({ kind: "fixed", item }))];
  const index = new Map();
  // A bill answers to its own name and to any statement name it was
  // matched to before (`statementNames`), so the next import of the same
  // sheet lines up on its own.
  for (const entry of all) {
    const keys = new Set([entry.item.name, ...(entry.item.statementNames || [])].map(nameKey).filter(Boolean));
    for (const key of keys) index.set(key, [...(index.get(key) || []), entry]);
  }

  // Pass 1: read every row; settle exact name matches, repeats and blanks.
  const entries = [];
  const firstRowFor = new Map();
  const claimedBy = new Map(); // bill id → row index
  rows.slice(headerRow + 1).forEach((cells, i) => {
    const name = get(cells, "name");
    const rowNumber = headerRow + 2 + i;
    const entry = { index: i, rowNumber, name, problems: [], notes: [], selected: true };
    entries.push(entry);
    if (!name) {
      Object.assign(entry, { kind: "skip", selected: false });
      entry.problems.push("no bill name");
      return;
    }
    const payoffRaw = get(cells, "balance");
    const aprRaw = get(cells, "apr");
    const monthlyRaw = get(cells, "monthly");
    const dueRaw = get(cells, "dueDay");
    entry.values = {
      payoff: payoffRaw === "" ? null : parseMoney(payoffRaw),
      apr: aprRaw === "" ? null : parsePercent(aprRaw),
      monthly: monthlyRaw === "" ? null : parseMoney(monthlyRaw),
      dueDay: dueRaw === "" ? null : parseDueDay(dueRaw),
    };
    if (payoffRaw !== "" && entry.values.payoff === null) entry.problems.push(`can't read payoff "${payoffRaw}"`);
    if (aprRaw !== "" && entry.values.apr === null) entry.problems.push(`can't read APR "${aprRaw}"`);
    if (monthlyRaw !== "" && entry.values.monthly === null) entry.problems.push(`can't read monthly "${monthlyRaw}"`);
    if (entry.problems.length) entry.selected = false;

    const key = nameKey(name);
    if (firstRowFor.has(key)) {
      Object.assign(entry, { kind: "skip", selected: false });
      entry.problems.push(`listed twice — row ${firstRowFor.get(key)} is used`);
      return;
    }
    firstRowFor.set(key, rowNumber);
    const exact = index.get(key) || [];
    if (exact.length > 1) {
      Object.assign(entry, { kind: "skip", selected: false });
      entry.problems.push("more than one bill in the app has this name");
      return;
    }
    if (exact.length === 1) {
      entry.match = exact[0];
      entry.matchedBy = "name";
      claimedBy.set(exact[0].item.id, i);
    }
  });

  // Pass 2: rows without an exact match take the bill the person picked,
  // or the closest-named bill nobody else has.
  const ambiguousIds = new Set([...index.values()].filter((l) => l.length > 1).flat().map((e) => e.item.id));
  const open = (i) => all.filter((e) => !ambiguousIds.has(e.item.id) && (!claimedBy.has(e.item.id) || claimedBy.get(e.item.id) === i));
  for (const entry of entries) {
    if (entry.kind === "skip" || entry.match) continue;
    const pick = picks[entry.index];
    if (pick === "new") continue;
    if (pick) {
      const chosen = all.find((e) => e.item.id === pick);
      if (chosen && open(entry.index).includes(chosen)) {
        entry.match = chosen;
        entry.matchedBy = "picked";
        claimedBy.set(chosen.item.id, entry.index);
      } else if (chosen) {
        entry.problems.push(`${chosen.item.name} is already matched to another row`);
        entry.selected = false;
      }
      continue;
    }
    let best = null;
    for (const e of open(entry.index)) {
      const score = nameSimilarity(entry.name, e.item.name);
      if (score >= SUGGEST_AT && (!best || score > best.score)) best = { e, score };
    }
    if (best) {
      entry.match = best.e;
      entry.matchedBy = "suggested";
      claimedBy.set(best.e.item.id, entry.index);
    }
  }

  // Pass 3: build each row's change.
  const plan = [];
  for (const entry of entries) {
    if (entry.kind === "skip") {
      plan.push(entry);
      continue;
    }
    const { payoff, apr, monthly, dueDay } = entry.values;
    // Rows not matched by exact name can be pointed at any bill no other
    // row has, closest names first.
    if (entry.matchedBy !== "name") {
      entry.choices = open(entry.index)
        .map((e) => ({ id: e.item.id, name: e.item.name, kind: e.kind, score: nameSimilarity(entry.name, e.item.name) }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    }

    if (!entry.match) {
      // New bill. Rent, childcare and utilities are fixed expenses; anything
      // else on a payoff list is a debt.
      const target = FIXED_NAME.test(entry.name) && payoff === null ? "fixed" : "debts";
      const name = entry.name;
      const fields = target === "fixed"
        ? { name, type: /rent|mortgage/i.test(name) ? "Rent/Mortgage" : /child|daycare/i.test(name) ? "Childcare" : /insurance/i.test(name) ? "Insurance" : "Utility", monthly: monthly ?? 0, dueDay, graceDays: 0, note: "" }
        : { name, type: "Other Loan", monthly: monthly ?? 0, balance: payoff, apr, dueDay, graceDays: 0, priority: 2, protected: false, excludeFromGoal: false, balanceAsOf: asOf, balanceUpdatedAt: updatedOn, balanceUpdatedBy: by };
      if (target === "debts") {
        if (payoff === null) entry.notes.push("no payoff — needs info");
        if (apr === null) entry.notes.push("no APR — needs info");
      }
      plan.push({ ...entry, kind: "new", target, fields });
      continue;
    }

    const { kind: target, item } = entry.match;
    const patch = {};
    const review = {};
    const changes = [];

    if (target === "debts") {
      // Payoff: the statement is current — take it (or clear it when the
      // statement has none), and restart the payments-since clock.
      if (payoff !== null) {
        if (!sameNumber(payoff, item.balance)) changes.push(`payoff ${item.balance === null || item.balance === undefined ? "—" : fmt(item.balance)} → ${fmt(payoff)}`);
        patch.balance = payoff;
      } else {
        if (item.balance !== null && item.balance !== undefined) changes.push(`payoff ${fmt(item.balance)} → needs info`);
        patch.balance = null;
      }
      patch.balanceAsOf = asOf;
      patch.balanceUpdatedAt = updatedOn;
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
    if (entry.matchedBy !== "name") patch.statementNames = [...new Set([...(item.statementNames || []), entry.name])];
    plan.push({ ...entry, kind: "update", target, existingId: item.id, existingName: item.name, patch, notes: changes.length ? changes : ["already matches — payoff date refreshed"] });
  }

  // Bills the app has that the statement doesn't mention: flag, don't delete.
  for (const { kind: target, item } of all) {
    if (claimedBy.has(item.id) || ambiguousIds.has(item.id)) continue;
    plan.push({
      index: entries.length + plan.length, rowNumber: null, name: item.name, kind: "missing", target, existingId: item.id, existingName: item.name,
      patch: { review: { ...(item.review || {}), notOnStatement: true } }, notes: ["not on the statement — flagged for review"], problems: [], selected: true,
    });
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
