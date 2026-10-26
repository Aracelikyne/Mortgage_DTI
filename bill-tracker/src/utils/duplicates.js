// src/utils/duplicates.js
//
// Like the Duplicates album in Photos: finds bills that look like the same
// one entered twice, so they can be merged (keeping every payment) or
// marked "not duplicates" so they stop being suggested.

import { getPaymentRecord } from "./finance";
import { newId } from "./ids";
import { nameSimilarity } from "./statementSync";

const close = (a, b, tolerance) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(Number(a) - Number(b)) <= tolerance;
const nameKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function dismissed(a, b) {
  return (a.notDuplicateOf || []).includes(b.id) || (b.notDuplicateOf || []).includes(a.id);
}

// Why two bills look like the same one, or null when they don't: the same
// name, or a similar name plus the same payment, due day or payoff.
export function duplicateReason(a, b) {
  if (dismissed(a, b)) return null;
  if (nameKey(a.name) && nameKey(a.name) === nameKey(b.name)) return "Same name";
  if (nameSimilarity(a.name, b.name) < 0.5) return null;
  const alike = [];
  if (close(a.monthly, b.monthly, 0.5) && Number(a.monthly) > 0) alike.push("payment");
  if (a.dueDay && Number(a.dueDay) === Number(b.dueDay)) alike.push("due day");
  if (close(a.balance, b.balance, Math.max(1, Math.abs(Number(a.balance)) * 0.02)) && Number(a.balance) > 0) alike.push("payoff");
  return alike.length ? `Similar name, same ${alike.join(" and ")}` : null;
}

// Groups of look-alike bills, debts and fixed expenses checked separately.
// [{ kind: "debts" | "fixed", items: [bill, …], reason }]
export function findDuplicateGroups(debts = [], fixed = []) {
  const groups = [];
  for (const [kind, list] of [["debts", debts], ["fixed", fixed]]) {
    const parent = new Map(list.map((b) => [b.id, b.id]));
    const root = (id) => (parent.get(id) === id ? id : root(parent.get(id)));
    const reasons = new Map();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const reason = duplicateReason(list[i], list[j]);
        if (!reason) continue;
        const ra = root(list[i].id);
        const rb = root(list[j].id);
        if (ra !== rb) parent.set(rb, ra);
        if (!reasons.has(list[i].id)) reasons.set(list[i].id, reason);
      }
    }
    const byRoot = new Map();
    for (const b of list) {
      const r = root(b.id);
      byRoot.set(r, [...(byRoot.get(r) || []), b]);
    }
    for (const items of byRoot.values()) {
      if (items.length > 1) groups.push({ kind, items, reason: items.map((b) => reasons.get(b.id)).find(Boolean) });
    }
  }
  return groups;
}

// Which of a group to keep by default: the one with the most payments
// logged, then the most recently updated payoff.
export function suggestedKeeper(items, paidByMonth = {}) {
  const paymentsOn = (b) => Object.values(paidByMonth).reduce((n, m) => n + getPaymentRecord(m, b).payments.length, 0);
  return [...items].sort((a, b) =>
    paymentsOn(b) - paymentsOn(a)
    || String(b.balanceUpdatedAt || b.balanceAsOf || "").localeCompare(String(a.balanceUpdatedAt || a.balanceAsOf || ""))
  )[0];
}

// The kept bill, with any blanks filled in from the ones merged into it.
export function mergedBill(keep, others) {
  const out = { ...keep };
  for (const o of others) {
    for (const key of ["monthly", "dueDay", "apr", "balance", "type", "note"]) {
      if ((out[key] === null || out[key] === undefined || out[key] === "") && o[key] !== null && o[key] !== undefined && o[key] !== "") {
        out[key] = o[key];
        if (key === "balance") Object.assign(out, { balanceAsOf: o.balanceAsOf, balanceUpdatedAt: o.balanceUpdatedAt, balanceUpdatedBy: o.balanceUpdatedBy });
      }
    }
    if (!out.autopay && o.autopay) Object.assign(out, { autopay: o.autopay, autopayFrequency: o.autopayFrequency, autopayAnchor: o.autopayAnchor, autopayAmount: o.autopayAmount });
  }
  out.notDuplicateOf = [...new Set([...(keep.notDuplicateOf || []), ...others.flatMap((o) => o.notDuplicateOf || [])])];
  return out;
}

// Every payment logged on the merged-away bills moves onto the kept one,
// month by month — nothing is lost.
export function mergePayments(paidByMonth, keep, others) {
  const out = {};
  for (const [month, entry] of Object.entries(paidByMonth || {})) {
    if (!others.some((o) => entry[o.id] !== undefined)) {
      out[month] = entry;
      continue;
    }
    const next = { ...entry };
    const keptRecord = getPaymentRecord(entry, keep);
    const payments = keptRecord.payments.map((p) => (p.id === "legacy" ? { ...p, id: newId() } : p));
    for (const o of others) {
      if (entry[o.id] === undefined) continue;
      payments.push(...getPaymentRecord(entry, o).payments.map((p) => (p.id === "legacy" ? { ...p, id: newId() } : p)));
      delete next[o.id];
    }
    const base = typeof entry[keep.id] === "object" && entry[keep.id] !== null && Array.isArray(entry[keep.id].payments) ? entry[keep.id] : {};
    next[keep.id] = { ...base, payments };
    out[month] = next;
  }
  return out;
}
