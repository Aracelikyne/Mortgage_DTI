import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBillStatus, biweeklyDebitsInMonth, statusesForMonth, summarizeStatuses, nextUpBills, markBillPaid } from "./billStatus";

// "Today" is Tuesday, October 20, 2026 for every test.
const TODAY = new Date(2026, 9, 20, 9, 30);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});
afterEach(() => vi.useRealTimers());

const bill = (over = {}) => ({ id: "b", name: "Bill", monthly: 100, dueDay: 15, graceDays: 0, ...over });
const pay = (amount, date, extra = {}) => ({ id: `${amount}-${date}`, amount, date, cleared: false, ...extra });
const oct = (b, payments = []) => getBillStatus(b, { [b.id]: { payments } }, 2026, 9, TODAY);

describe("getBillStatus", () => {
  it("is Paid once settled payments cover the bill", () => {
    const s = oct(bill(), [pay(60, "2026-10-01"), pay(40, "2026-10-14")]);
    expect(s).toMatchObject({ status: "paid", emoji: "✅", scheduled: false, paidAmount: 100, remaining: 0, note: "Paid Oct 14" });
  });

  it("counts a future-dated payment that covers the bill as Paid, noted as scheduled", () => {
    const s = oct(bill({ dueDay: 28 }), [pay(100, "2026-10-27")]);
    expect(s).toMatchObject({ status: "paid", scheduled: true, note: "Scheduled for Oct 27" });
  });

  it("doesn't count extra payments toward Paid", () => {
    const s = oct(bill({ dueDay: 25 }), [pay(500, "2026-10-10", { kind: "extra" })]);
    expect(s.status).toBe("dueSoon");
    expect(s.paidAmount).toBe(0);
    expect(s.extraPaid).toBe(500);
  });

  it("is Due soon within 7 days, and Upcoming beyond that", () => {
    expect(oct(bill({ dueDay: 20 }))).toMatchObject({ status: "dueSoon", note: "Due today" });
    expect(oct(bill({ dueDay: 21 }))).toMatchObject({ status: "dueSoon", note: "Due tomorrow" });
    expect(oct(bill({ dueDay: 27 }))).toMatchObject({ status: "dueSoon", emoji: "⚠️", note: "Due Oct 27 · in 7 days" });
    expect(oct(bill({ dueDay: 28 }))).toMatchObject({ status: "upcoming", emoji: "📅", note: "Due Oct 28" });
  });

  it("is Past due after the due date, counting down grace days", () => {
    expect(oct(bill({ dueDay: 18, graceDays: 5 }))).toMatchObject({ status: "pastDue", emoji: "🔴", graceDaysLeft: 3, note: "Was due Oct 18 · 3 grace days left" });
    expect(oct(bill({ dueDay: 15, graceDays: 5 }))).toMatchObject({ graceDaysLeft: 0, note: "Was due Oct 15 · last grace day" });
    expect(oct(bill({ dueDay: 12, graceDays: 3 }))).toMatchObject({ status: "pastDue", daysLate: 8, note: "Was due Oct 12 · 8 days late" });
  });

  it("keeps a partial payment's date-based status and shows $X of $Y", () => {
    expect(oct(bill({ dueDay: 25 }), [pay(40, "2026-10-05")])).toMatchObject({ status: "dueSoon", partial: true, paidAmount: 40, remaining: 60, note: "$40 of $100 · Due Oct 25 · in 5 days" });
    expect(oct(bill({ dueDay: 10 }), [pay(40, "2026-10-05")])).toMatchObject({ status: "pastDue", partial: true });
  });

  it("is Upcoming when no due day is set", () => {
    expect(oct(bill({ dueDay: null }))).toMatchObject({ status: "upcoming", dueDate: null, note: "No due date set" });
  });

  it("treats a $0 bill as nothing due", () => {
    expect(oct(bill({ monthly: 0 }))).toMatchObject({ status: "paid", note: "Nothing due this month" });
  });

  it("counts monthly autopay as paid once its debit date passes, and never past due", () => {
    const ap = bill({ autopay: true, autopayFrequency: "monthly", dueDay: 5, graceDays: 0 });
    expect(oct(ap)).toMatchObject({ status: "paid", note: "Autopay debited Oct 5" });
    expect(oct({ ...ap, dueDay: 30 })).toMatchObject({ status: "upcoming", note: "Autopay Oct 30" });
    expect(oct({ ...ap, dueDay: 22 })).toMatchObject({ status: "dueSoon", note: "Autopay Oct 22" });
    // a past month: debited, so paid — not "late"
    expect(getBillStatus(ap, {}, 2026, 8, TODAY).status).toBe("paid");
  });

  it("handles biweekly autopay: that month's debits, each paid once its date passes", () => {
    const ap = bill({ autopay: true, autopayFrequency: "biweekly", autopayAnchor: "2026-10-03", autopayAmount: 450, dueDay: null, monthly: 900 });
    expect(biweeklyDebitsInMonth("2026-10-03", 2026, 9).map((d) => d.getDate())).toEqual([3, 17, 31]);
    expect(oct(ap)).toMatchObject({ status: "upcoming", owed: 1350, paidAmount: 900, remaining: 450, partial: true, note: "$900 of $1,350 · Autopay Oct 31" });
    expect(getBillStatus(ap, {}, 2026, 8, TODAY)).toMatchObject({ status: "paid", note: "No autopay debits this month" }); // before the first debit
    expect(getBillStatus(ap, {}, 2026, 10, TODAY)).toMatchObject({ owed: 900, status: "upcoming" }); // Nov 14 + Nov 28
  });

  it("calls an unpaid bill from a past month past due", () => {
    expect(getBillStatus(bill({ dueDay: 15, graceDays: 3 }), {}, 2026, 8, TODAY)).toMatchObject({ status: "pastDue", daysLate: 35 });
  });

  it("can be Due soon in a future month", () => {
    expect(getBillStatus(bill({ dueDay: 1 }), {}, 2026, 10, new Date(2026, 9, 28))).toMatchObject({ status: "dueSoon", daysUntilDue: 4 });
  });
});

describe("month summaries", () => {
  const bills = [
    bill({ id: "rent", name: "Rent", monthly: 1650, dueDay: 1 }),
    bill({ id: "card", name: "Card", monthly: 100, dueDay: 18, graceDays: 5 }),
    bill({ id: "power", name: "Power", monthly: 140, dueDay: 24 }),
    bill({ id: "car", name: "Car", monthly: 410, dueDay: 30 }),
  ];
  const pbm = { "2026-10": { rent: { payments: [pay(1650, "2026-10-01")] }, card: { payments: [pay(30, "2026-10-02")] } } };

  it("groups past due first, then due soon, upcoming, paid", () => {
    const statuses = statusesForMonth(bills, pbm, 2026, 9, TODAY);
    expect(statuses.map((s) => [s.bill.name, s.status])).toEqual([["Card", "pastDue"], ["Power", "dueSoon"], ["Car", "upcoming"], ["Rent", "paid"]]);
  });

  it("totals paid vs still to pay", () => {
    const sum = summarizeStatuses(statusesForMonth(bills, pbm, 2026, 9, TODAY));
    expect(sum).toEqual({
      owedTotal: 2300, paidAmount: 1680, paidCount: 1, remainingAmount: 620, remainingCount: 3,
      pastDueCount: 1, dueSoonCount: 1, upcomingCount: 1,
    });
  });

  it("lists next up: urgent first, a few upcoming, plus next month's bills already due soon", () => {
    const list = nextUpBills(bills, pbm, new Date(2026, 9, 28), 3);
    expect(list.map((s) => [s.bill.name, s.status, s.monthKey])).toEqual([
      ["Card", "pastDue", "2026-10"], // most overdue first
      ["Power", "pastDue", "2026-10"],
      ["Car", "dueSoon", "2026-10"],
      ["Rent", "dueSoon", "2026-11"],
    ]);
  });
});

describe("markBillPaid", () => {
  it("logs what's still owed, dated today", () => {
    const next = markBillPaid({ "2026-10": { b: { payments: [pay(30, "2026-10-02")] } } }, "2026-10", bill());
    const added = next["2026-10"].b.payments[1];
    expect(added).toMatchObject({ amount: 70, date: "2026-10-20" });
  });

  it("settles an already-scheduled payment instead of logging a second one", () => {
    const next = markBillPaid({ "2026-10": { b: { payments: [pay(100, "2026-10-27")] } } }, "2026-10", bill());
    expect(next["2026-10"].b.payments).toHaveLength(1);
    expect(next["2026-10"].b.payments[0].cleared).toBe(true);
  });
});
