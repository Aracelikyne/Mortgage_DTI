import { describe, it, expect } from "vitest";
import { billsDueForReminder, reminderMessage } from "./reminders";

const day = (m: number, d: number) => new Date(2026, m - 1, d, 7, 0); // 7am local
const bill = (over = {}) => ({ id: "b1", name: "Amex", monthly: 120, dueDay: 15, ...over });
const kinds = (bills: object[], today: Date, paid = {}) =>
  billsDueForReminder(bills as never, paid, today).map((r) => `${r.bill.name}:${r.kind}`);

describe("billsDueForReminder", () => {
  it("reminds 3 days ahead, on the day, and the day after", () => {
    expect(kinds([bill()], day(10, 12))).toEqual(["Amex:upcoming"]);
    expect(kinds([bill()], day(10, 15))).toEqual(["Amex:today"]);
    expect(kinds([bill()], day(10, 16))).toEqual(["Amex:passed"]);
    expect(kinds([bill()], day(10, 13))).toEqual([]);
    expect(kinds([bill()], day(10, 17))).toEqual([]);
  });

  it("stays quiet once the month's payment is marked paid — but extras don't count", () => {
    const paid = { "2026-10": { b1: { payments: [{ amount: 120 }] } } };
    expect(kinds([bill()], day(10, 16), paid)).toEqual([]);
    const extraOnly = { "2026-10": { b1: { payments: [{ amount: 500, kind: "extra" }] } } };
    expect(kinds([bill()], day(10, 16), extraOnly)).toEqual(["Amex:passed"]);
  });

  it("sends the overdue one when grace runs out, only for bills with grace days", () => {
    expect(kinds([bill({ graceDays: 5 })], day(10, 21))).toEqual(["Amex:overdue"]);
    expect(kinds([bill({ graceDays: 0 })], day(10, 21))).toEqual([]);
  });

  it("autopay gets the heads-up only", () => {
    const a = bill({ autopay: true });
    expect(kinds([a], day(10, 12))).toEqual(["Amex:upcoming"]);
    expect(kinds([a], day(10, 15))).toEqual([]);
    expect(kinds([a], day(10, 16))).toEqual([]);
  });

  it("crosses month ends both ways", () => {
    // Due the 1st: heads-up lands in the prior month.
    expect(kinds([bill({ dueDay: 1 })], day(10, 29))).toEqual(["Amex:upcoming"]);
    // Due the 31st in October: passed on November 1st; overdue after grace in November.
    expect(kinds([bill({ dueDay: 31 })], day(11, 1))).toEqual(["Amex:passed"]);
    expect(kinds([bill({ dueDay: 30, graceDays: 5 })], day(11, 5))).toEqual(["Amex:overdue"]);
    // Due the 31st in a 30-day month counts as the 30th.
    expect(kinds([bill({ dueDay: 31 })], day(11, 30))).toEqual(["Amex:today"]);
  });

  it("skips bills with no amount or due day", () => {
    expect(kinds([bill({ monthly: 0 }), bill({ dueDay: null })], day(10, 15))).toEqual([]);
  });
});

describe("reminderMessage", () => {
  it("says what happened and what to do", () => {
    const [r] = billsDueForReminder([bill({ monthly: 1234.5 })], {}, day(10, 16));
    expect(reminderMessage(r)).toEqual({ title: "Amex was due yesterday", body: "$1,235 isn't marked paid. If you paid it, mark it in Monthly Plan." });
  });
});
