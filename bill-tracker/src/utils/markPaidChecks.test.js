import { describe, it, expect } from "vitest";
import { lastMonthUnpaid, pastDueNow } from "./markPaidChecks";
import { billStatusesForMonth } from "./billStatus";

const card = { id: "c", name: "Amex", monthly: 85, dueDay: 20, graceDays: 0, balance: 1000, balanceAsOf: "2026-11-12" };
const rowFor = (bill, y, m, today, pbm = {}) => billStatusesForMonth(bill, pbm, y, m, today)[0];

describe("last month's payment check", () => {
  it("asks when last month's payment, due since the rules began, was never marked", () => {
    const jan5 = new Date(2027, 0, 5);
    const behind = lastMonthUnpaid(rowFor(card, 2027, 0, jan5), "2027-01", {}, jan5);
    expect(behind.prevKey).toBe("2026-12");
    expect(behind.rows.map((r) => r.remaining)).toEqual([85]);
  });

  it("doesn't ask once it's marked, for autopay, or for anything due before Nov 12, 2026", () => {
    const jan5 = new Date(2027, 0, 5);
    const paidDec = { "2026-12": { c: { payments: [{ id: "p", amount: 85, date: "2026-12-19" }] } } };
    expect(lastMonthUnpaid(rowFor(card, 2027, 0, jan5), "2027-01", paidDec, jan5)).toBeNull();
    expect(lastMonthUnpaid(rowFor({ ...card, autopay: true }, 2027, 0, jan5), "2027-01", {}, jan5)).toBeNull();
    // Marking December: November 20 is after the rules began but before this debt's payoff date? No — after it, so it asks.
    const dec5 = new Date(2026, 11, 5);
    expect(lastMonthUnpaid(rowFor(card, 2026, 11, dec5), "2026-12", {}, dec5)).not.toBeNull();
    // A debt whose payoff is dated after last month's due date: that payment is already in the payoff.
    expect(lastMonthUnpaid(rowFor({ ...card, balanceAsOf: "2026-11-25" }, 2026, 11, dec5), "2026-12", {}, dec5)).toBeNull();
    // Due before the rules began (Oct 20): never asks.
    const nov15 = new Date(2026, 10, 15);
    expect(lastMonthUnpaid(rowFor({ ...card, balanceAsOf: "2026-08-01" }, 2026, 10, nov15), "2026-11", {}, nov15)).toBeNull();
  });
});

describe("past-due reminder", () => {
  it("lists what's past due since the rules began, except the bill just marked", () => {
    const dec22 = new Date(2026, 11, 22);
    const other = { ...card, id: "o", name: "Ineos", dueDay: 9 };
    const due = pastDueNow([card, other], {}, "c", dec22);
    expect(due.map((r) => `${r.displayName} ${r.dueDate.getMonth() + 1}/${r.dueDate.getDate()}`)).toEqual(["Ineos 12/9"]);
    // Nov 9 was before the rules began: not listed even though it's unpaid.
    expect(pastDueNow([other], {}, null, new Date(2026, 10, 20))).toEqual([]);
  });
});
