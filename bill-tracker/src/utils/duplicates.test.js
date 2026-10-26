import { describe, it, expect } from "vitest";
import { findDuplicateGroups, mergedBill, mergePayments, suggestedKeeper } from "./duplicates";

const debt = (id, name, over = {}) => ({ id, name, monthly: 100, dueDay: 10, balance: 1000, apr: 20, ...over });

describe("findDuplicateGroups", () => {
  it("groups the same bill entered twice", () => {
    const groups = findDuplicateGroups([debt("a", "Amex"), debt("b", "AMEX"), debt("c", "Tires", { monthly: 57, dueDay: 11 })], []);
    expect(groups.map((g) => [g.items.map((b) => b.id), g.reason])).toEqual([[["a", "b"], "Same name"]]);
  });

  it("catches a similar name with the same payment or due day", () => {
    const groups = findDuplicateGroups([debt("a", "Amex"), debt("b", "Amex Blue Cash", { balance: 3000, dueDay: 22 })], []);
    expect(groups[0].reason).toBe("Similar name, same payment");
  });

  it("leaves different people's and different-numbered bills alone", () => {
    const list = [debt("a", "SK Upstart"), debt("b", "MK Upstart"), debt("c", "MAK Cap 1"), debt("d", "MAK Cap2"), debt("e", "SK Iphone"), debt("f", "MK Iphone")];
    expect(findDuplicateGroups(list, [])).toEqual([]);
  });

  it("needs more than a similar name", () => {
    expect(findDuplicateGroups([debt("a", "Amex"), debt("b", "Amex Gold", { monthly: 40, dueDay: 3, balance: 50 })], [])).toEqual([]);
  });

  it("stops suggesting a pair marked not duplicates", () => {
    expect(findDuplicateGroups([debt("a", "Amex", { notDuplicateOf: ["b"] }), debt("b", "Amex")], [])).toEqual([]);
  });

  it("checks fixed expenses too, separately from debts", () => {
    const groups = findDuplicateGroups([debt("a", "Rent")], [{ id: "r1", name: "Rent", monthly: 2589 }, { id: "r2", name: "rent", monthly: 2589 }]);
    expect(groups.map((g) => [g.kind, g.items.map((b) => b.id)])).toEqual([["fixed", ["r1", "r2"]]]);
  });
});

describe("merging", () => {
  const keep = debt("a", "Amex", { apr: null });
  const other = debt("b", "AMEX", { apr: 24.99, autopay: true, autopayFrequency: "monthly" });
  const paid = {
    "2026-09": { a: { payments: [{ id: "p1", amount: 100, date: "2026-09-10" }] }, b: { amountPaid: 50, paidDate: "2026-09-12" } },
    "2026-10": { b: { payments: [{ id: "p2", amount: 100, date: "2026-10-10" }] }, x: { payments: [] } },
  };

  it("moves every payment onto the kept bill", () => {
    const out = mergePayments(paid, keep, [other]);
    expect(out["2026-09"].b).toBeUndefined();
    expect(out["2026-09"].a.payments.map((p) => p.amount)).toEqual([100, 50]);
    expect(out["2026-10"].a.payments.map((p) => p.id)).toEqual(["p2"]);
    expect(out["2026-10"].x).toEqual({ payments: [] });
  });

  it("fills the kept bill's blanks from the other", () => {
    expect(mergedBill(keep, [other])).toMatchObject({ id: "a", name: "Amex", apr: 24.99, autopay: true, autopayFrequency: "monthly" });
  });

  it("keeps the one with more payments by default", () => {
    expect(suggestedKeeper([keep, other], { "2026-10": { b: { payments: [{ amount: 1 }, { amount: 2 }] } } }).id).toBe("b");
  });
});
