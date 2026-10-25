// src/utils/ids.js

import { advanceByFrequency } from "./finance";

// A fresh id for anything stored in the shared household row. The old
// nextId() counted up from a module-level `let _id = 1000` that reset on
// every page load, so each session handed out b1000, b1001… all over again
// and new items silently shared ids with existing ones — and everything in
// the app matches by id (edits, deletes, payment history, React keys).
export function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // randomUUID only exists in secure contexts (https or localhost) — opening
  // the dev server from a phone over the LAN isn't one — so fall back to
  // building a v4 UUID from getRandomValues, which works everywhere.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Three separate uniqueness domains. Debts, fixed expenses and the Paid Off
// archive share one, because they share paidByMonth (a payment record is
// keyed by bill id no matter which list the bill lives in). Income sources
// are their own domain (paycheckOverrides is keyed by source id), and boosts
// are only ever matched against other boosts.
const BILL_COLLECTIONS = ["debts", "fixed", "paidOffDebts"];

const COLLECTION_LABELS = {
  debts: "debt",
  fixed: "fixed expense",
  paidOffDebts: "paid-off debt",
  incomeSources: "paycheck source",
  boosts: "boost",
};

function hasUsableId(item) {
  return !!item && ((typeof item.id === "string" && item.id !== "") || typeof item.id === "number");
}

function sameAmount(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

// Gives every repeat of an id within one domain — and any item with no id
// at all — a new one, without touching the first holder of each id. New ids
// are deterministic (`${oldId}-2`, `-3`, … skipping anything already taken)
// so both devices repairing the same data independently land on the exact
// same result. Returns the duplicate groups, each in domain order with the
// original holder first.
function assignUniqueIds(entries, alsoTaken) {
  const taken = new Set(Array.from(alsoTaken, String));
  for (const e of entries) if (hasUsableId(e.item)) taken.add(String(e.item.id));

  const firstById = new Map();
  const groups = new Map();
  let missing = 0;
  for (const e of entries) {
    if (!hasUsableId(e.item)) {
      let candidate;
      do candidate = `item-${++missing}`; while (taken.has(candidate));
      taken.add(candidate);
      e.oldId = null;
      e.newId = candidate;
      groups.set(`missing:${candidate}`, [e]);
      continue;
    }
    e.oldId = e.item.id;
    const id = String(e.item.id);
    if (!firstById.has(id)) {
      firstById.set(id, e);
      e.newId = e.item.id;
      continue;
    }
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    e.newId = `${id}-${n}`;
    taken.add(e.newId);
    if (!groups.has(id)) groups.set(id, [firstById.get(id)]);
    groups.get(id).push(e);
  }
  return groups;
}

// Splits each shared payment record between the bills that were sharing the
// id: a payment whose amount matches exactly one of their monthly amounts
// goes to that bill; anything ambiguous (matches none, or several) stays
// with the original holder.
function movePayments(paidByMonth, groups) {
  for (const [sharedId, members] of groups) {
    if (sharedId.startsWith("missing:")) continue;
    const owner = members[0];
    const targetFor = (amount) => {
      const hits = members.filter((m) => Number(m.item.monthly) > 0 && sameAmount(amount, m.item.monthly));
      return hits.length === 1 ? hits[0] : owner;
    };
    for (const monthKey of Object.keys(paidByMonth)) {
      const month = paidByMonth[monthKey];
      if (!month || typeof month !== "object" || !Object.prototype.hasOwnProperty.call(month, sharedId)) continue;
      const raw = month[sharedId];
      if (raw && typeof raw === "object" && Array.isArray(raw.payments)) {
        const buckets = new Map(members.map((m) => [m, []]));
        for (const p of raw.payments) buckets.get(targetFor(p?.amount)).push(p);
        for (const m of members.slice(1)) {
          const moved = buckets.get(m);
          if (moved.length === 0) continue;
          month[m.newId] = { payments: moved };
          m.movedPayments = (m.movedPayments || 0) + moved.length;
        }
        if (buckets.get(owner).length > 0) month[sharedId] = { ...raw, payments: buckets.get(owner) };
        else delete month[sharedId];
      } else if (raw && typeof raw === "object") {
        // Pre-"multiple payments" shape: one lump { amountPaid, paidDate }.
        const target = targetFor(raw.amountPaid);
        if (target !== owner) {
          month[target.newId] = raw;
          delete month[sharedId];
          target.movedPayments = (target.movedPayments || 0) + 1;
        }
      }
      // A legacy `true` ("paid") flag carries no amount to match on — it
      // stays with the original holder.
    }
  }
}

// Whether a paycheck source's own recurring schedule lands on `iso` — the
// same walk generatePaychecks does, so an override (keyed by the naturally
// computed date) can be traced back to the one source that produces it.
function isScheduledOn(source, iso) {
  if (!source?.nextPayDate || !iso) return false;
  const start = new Date(source.nextPayDate + "T00:00:00");
  const target = new Date(iso + "T00:00:00");
  if (isNaN(start) || isNaN(target)) return false;
  const frequency = source.frequency || "biweekly";
  if (frequency === "monthly") {
    let d = start;
    for (let guard = 0; d < target && guard < 1200; guard++) d = advanceByFrequency(d, "monthly");
    return d.getTime() === target.getTime();
  }
  const step = frequency === "weekly" ? 7 : 14;
  const days = Math.round((target - start) / 86400000);
  return ((days % step) + step) % step === 0;
}

function moveOverrides(paycheckOverrides, groups) {
  for (const [sharedId, members] of groups) {
    if (sharedId.startsWith("missing:")) continue;
    const forShared = paycheckOverrides[sharedId];
    if (!forShared || typeof forShared !== "object") continue;
    const owner = members[0];
    for (const natural of Object.keys(forShared)) {
      const hits = members.filter((m) => isScheduledOn(m.item, natural));
      const target = hits.length === 1 ? hits[0] : owner;
      if (target === owner) continue;
      paycheckOverrides[target.newId] = { ...(paycheckOverrides[target.newId] || {}), [natural]: forShared[natural] };
      delete forShared[natural];
      target.movedOverrides = (target.movedOverrides || 0) + 1;
    }
  }
}

function describeMember(e) {
  if (e.collection === "boosts") {
    return { collection: e.collection, name: `${Number(e.item.amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} in month ${e.item.month}` };
  }
  return { collection: e.collection, name: e.item.name || "(unnamed)" };
}

function toReportGroups(domain, groups) {
  return Array.from(groups, ([sharedId, members]) => ({
    domain,
    sharedId: sharedId.startsWith("missing:") ? null : sharedId,
    members: members.map((e, i) => ({
      ...describeMember(e),
      oldId: e.oldId,
      newId: e.newId,
      kept: i === 0 && e.oldId !== null,
      movedPayments: e.movedPayments || 0,
      movedOverrides: e.movedOverrides || 0,
    })),
  }));
}

// Repairs a household blob whose records share ids. Never mutates `data` —
// the caller keeps the untouched original to back up before writing the
// repaired copy. `report.changed` is false (and `data` comes back as-is)
// when every id is already unique.
export function repairDuplicateIds(data) {
  const empty = { changed: false, groups: [] };
  if (!data || typeof data !== "object") return { data, report: empty };

  const entriesFor = (keys) => keys.flatMap((collection) =>
    (Array.isArray(data[collection]) ? data[collection] : []).map((item, index) => ({ collection, index, item }))
  );
  const billEntries = entriesFor(BILL_COLLECTIONS);
  const incomeEntries = entriesFor(["incomeSources"]);
  const boostEntries = entriesFor(["boosts"]);

  // Ids that only survive as payment/override keys (e.g. a deleted fixed
  // expense's old payments) still count as taken, so a new id never
  // inherits someone else's leftover history.
  const billGroups = assignUniqueIds(billEntries, Object.values(data.paidByMonth || {}).flatMap((m) => (m && typeof m === "object" ? Object.keys(m) : [])));
  const incomeGroups = assignUniqueIds(incomeEntries, Object.keys(data.paycheckOverrides || {}));
  const boostGroups = assignUniqueIds(boostEntries, []);

  if (billGroups.size === 0 && incomeGroups.size === 0 && boostGroups.size === 0) return { data, report: empty };

  const repaired = JSON.parse(JSON.stringify(data));
  repaired.paidByMonth = repaired.paidByMonth || {};
  repaired.paycheckOverrides = repaired.paycheckOverrides || {};
  // The groups hold references into the original; point them at the copy.
  for (const e of [...billEntries, ...incomeEntries, ...boostEntries]) {
    e.item = repaired[e.collection][e.index];
  }
  movePayments(repaired.paidByMonth, billGroups);
  moveOverrides(repaired.paycheckOverrides, incomeGroups);
  for (const e of [...billEntries, ...incomeEntries, ...boostEntries]) {
    if (e.newId !== e.item.id) e.item.id = e.newId;
  }

  return {
    data: repaired,
    report: {
      changed: true,
      groups: [
        ...toReportGroups("bills", billGroups),
        ...toReportGroups("incomeSources", incomeGroups),
        ...toReportGroups("boosts", boostGroups),
      ],
    },
  };
}

// One plain-English line per repaired group — what the activity log stores.
export function describeIdRepair(report) {
  return (report?.groups || []).map((g) => {
    const [owner, ...others] = g.members;
    const label = (m) => `"${m.name}" (${COLLECTION_LABELS[m.collection] || m.collection})`;
    if (!g.sharedId) return `Gave ${label(owner)} an ID — it didn't have one`;
    const moved = others
      .filter((m) => m.movedPayments || m.movedOverrides)
      .map((m) => `${m.movedPayments ? `${m.movedPayments} payment${m.movedPayments === 1 ? "" : "s"}` : `${m.movedOverrides} paycheck date change${m.movedOverrides === 1 ? "" : "s"}`} to "${m.name}"`);
    return `Unlinked ${others.map(label).join(", ")} from ${label(owner)} — they shared ID ${g.sharedId}${moved.length ? `; moved ${moved.join(", ")}` : ""}`;
  });
}
