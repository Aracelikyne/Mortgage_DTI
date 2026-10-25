import { describe, it, expect, vi, afterEach } from "vitest";
import { newId, repairDuplicateIds, describeIdRepair } from "./ids";

// Shaped like real data after a few sessions of the old resetting counter.
function brokenHousehold() {
  return {
    debts: [
      { id: "b1000", name: "Amex", monthly: 120, balance: 3400 },
      { id: "b1001", name: "Chase", monthly: 95, balance: 2100 },
      { id: "b1000", name: "Expedia", monthly: 45, balance: 900 },
      { id: "b1003", name: "Student loan", monthly: 180, balance: 22000 },
    ],
    fixed: [
      { id: "b1001", name: "Rent", monthly: 1650 },
      { id: "b1005", name: "Power", monthly: 140 },
    ],
    paidOffDebts: [{ id: "b1003", name: "Best Buy", monthly: 35, balanceAtPayoff: 350 }],
    incomeSources: [
      { id: "b1000", name: "Your paycheck", amount: 2400, nextPayDate: "2026-10-17", frequency: "biweekly" },
      { id: "b1001", name: "Partner", amount: 2100, nextPayDate: "2026-10-24", frequency: "biweekly" },
      { id: "b1001", name: "Side gig", amount: 300, nextPayDate: "2026-10-30", frequency: "monthly" },
    ],
    boosts: [
      { id: "b1000", month: 3, amount: 1000 },
      { id: "b1000", month: 6, amount: 500 },
    ],
    paidByMonth: {
      "2026-09": {
        b1000: { payments: [
          { id: "a", amount: 120, date: "2026-09-12" },
          { id: "e", amount: 45, date: "2026-09-08" },
        ] },
        b1001: { payments: [
          { id: "r", amount: 1650, date: "2026-09-01" },
          { id: "c", amount: 95, date: "2026-09-20" },
        ] },
        b1003: { amountPaid: 35, paidDate: "2026-08-30" },
      },
      "2026-10": {
        b1000: { payments: [
          { id: "a2", amount: 120, date: "2026-10-12" },
          { id: "odd", amount: 200, date: "2026-10-10" },
        ] },
        b1003: true,
      },
    },
    paycheckOverrides: {
      b1001: { "2026-11-07": "2026-11-06", "2026-11-30": "2026-11-27" },
    },
  };
}

describe("newId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns distinct UUIDs", () => {
    const ids = new Set(Array.from({ length: 500 }, newId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("falls back to getRandomValues outside a secure context", () => {
    // no randomUUID — like the dev server opened from a phone over plain http
    vi.stubGlobal("crypto", { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) % 256; return a; } });
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("repairDuplicateIds", () => {
  it("leaves data with unique ids alone", () => {
    const data = { debts: [{ id: "x", name: "A" }], fixed: [{ id: "y", name: "B" }], paidByMonth: {} };
    const { data: out, report } = repairDuplicateIds(data);
    expect(report.changed).toBe(false);
    expect(out).toBe(data);
  });

  it("handles empty / missing data", () => {
    expect(repairDuplicateIds(null).report.changed).toBe(false);
    expect(repairDuplicateIds({}).report.changed).toBe(false);
  });

  it("keeps the first holder's id and gives later duplicates -2, -3…", () => {
    const { data } = repairDuplicateIds(brokenHousehold());
    expect(data.debts.map((d) => d.id)).toEqual(["b1000", "b1001", "b1000-2", "b1003"]);
    // fixed and the Paid Off archive share the bills domain with debts
    expect(data.fixed.map((f) => f.id)).toEqual(["b1001-2", "b1005"]);
    expect(data.paidOffDebts[0].id).toBe("b1003-2");
  });

  it("makes every id unique within each domain", () => {
    const { data } = repairDuplicateIds(brokenHousehold());
    const billIds = [...data.debts, ...data.fixed, ...data.paidOffDebts].map((x) => x.id);
    expect(new Set(billIds).size).toBe(billIds.length);
    expect(new Set(data.incomeSources.map((s) => s.id)).size).toBe(3);
    expect(new Set(data.boosts.map((b) => b.id)).size).toBe(2);
  });

  it("treats domains independently — a paycheck may share an id with a debt", () => {
    const { data } = repairDuplicateIds(brokenHousehold());
    expect(data.incomeSources[0].id).toBe("b1000"); // same as Amex, different domain
    expect(data.boosts.map((b) => b.id)).toEqual(["b1000", "b1000-2"]);
  });

  it("skips suffixes that are already taken, including ids that only survive in paidByMonth", () => {
    const { data } = repairDuplicateIds({
      debts: [{ id: "b1", name: "A", monthly: 1 }, { id: "b1-2", name: "B", monthly: 2 }, { id: "b1", name: "C", monthly: 3 }],
      fixed: [],
      paidByMonth: { "2026-10": { "b1-3": { payments: [{ id: "old", amount: 9 }] } } },
    });
    expect(data.debts.map((d) => d.id)).toEqual(["b1", "b1-2", "b1-4"]);
  });

  it("moves a payment only when its amount matches exactly one duplicate's monthly amount", () => {
    const { data } = repairDuplicateIds(brokenHousehold());
    const sep = data.paidByMonth["2026-09"];
    expect(sep.b1000.payments.map((p) => p.id)).toEqual(["a"]); // Amex's $120 stays
    expect(sep["b1000-2"].payments.map((p) => p.id)).toEqual(["e"]); // Expedia's $45 moves
    expect(sep.b1001.payments.map((p) => p.id)).toEqual(["c"]); // Chase's $95 stays with Chase
    expect(sep["b1001-2"].payments.map((p) => p.id)).toEqual(["r"]); // Rent's $1,650 follows Rent
    const oct = data.paidByMonth["2026-10"];
    // $200 matches nobody's monthly amount — ambiguous, so it stays with the first
    expect(oct.b1000.payments.map((p) => p.id)).toEqual(["a2", "odd"]);
    expect(oct["b1000-2"]).toBeUndefined();
  });

  it("moves an old single-lump record whole, and leaves a bare `true` with the first holder", () => {
    const { data } = repairDuplicateIds(brokenHousehold());
    // { amountPaid: 35 } matches the archived Best Buy card's $35 monthly
    expect(data.paidByMonth["2026-09"]["b1003-2"]).toEqual({ amountPaid: 35, paidDate: "2026-08-30" });
    expect(data.paidByMonth["2026-09"].b1003).toBeUndefined();
    expect(data.paidByMonth["2026-10"].b1003).toBe(true);
  });

  it("keeps a payment with the first holder when it matches several duplicates", () => {
    const { data } = repairDuplicateIds({
      debts: [{ id: "d", name: "A", monthly: 50 }, { id: "d", name: "B", monthly: 50 }],
      paidByMonth: { "2026-10": { d: { payments: [{ id: "p", amount: 50 }] } } },
    });
    expect(data.paidByMonth["2026-10"].d.payments).toHaveLength(1);
    expect(data.paidByMonth["2026-10"]["d-2"]).toBeUndefined();
  });

  it("moves a paycheck date override to the one duplicate source whose schedule produces that date", () => {
    const { data } = repairDuplicateIds(brokenHousehold());
    // 2026-11-07 is two weeks after Partner's 10-24; 2026-11-30 is a month after Side gig's 10-30
    expect(data.paycheckOverrides.b1001).toEqual({ "2026-11-07": "2026-11-06" });
    expect(data.paycheckOverrides["b1001-2"]).toEqual({ "2026-11-30": "2026-11-27" });
  });

  it("gives items with no id at all their own id", () => {
    const { data, report } = repairDuplicateIds({ debts: [{ name: "A" }, { name: "B" }], fixed: [] });
    expect(data.debts.map((d) => d.id)).toEqual(["item-1", "item-2"]);
    expect(report.changed).toBe(true);
  });

  it("never mutates its input", () => {
    const input = brokenHousehold();
    const snapshot = JSON.stringify(input);
    repairDuplicateIds(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("is deterministic and idempotent, so two devices land on the same result", () => {
    const a = repairDuplicateIds(brokenHousehold());
    const b = repairDuplicateIds(brokenHousehold());
    expect(a.data).toEqual(b.data);
    const again = repairDuplicateIds(a.data);
    expect(again.report.changed).toBe(false);
  });

  it("reports what was unlinked", () => {
    const { report } = repairDuplicateIds(brokenHousehold());
    const amex = report.groups.find((g) => g.domain === "bills" && g.sharedId === "b1000");
    expect(amex.members.map((m) => [m.name, m.newId, m.kept, m.movedPayments])).toEqual([
      ["Amex", "b1000", true, 0],
      ["Expedia", "b1000-2", false, 1],
    ]);
    const lines = describeIdRepair(report);
    expect(lines).toContain('Unlinked "Expedia" (debt) from "Amex" (debt) — they shared ID b1000; moved 1 payment to "Expedia"');
    expect(lines.some((l) => l.includes('"Best Buy" (paid-off debt)'))).toBe(true);
    expect(lines.some((l) => l.includes("paycheck date change"))).toBe(true);
  });
});
