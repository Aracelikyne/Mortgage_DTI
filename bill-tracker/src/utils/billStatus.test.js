import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBillStatus, billStatusesForMonth, statusesForMonth, summarizeStatuses, nextUpBills, markBillPaid } from "./billStatus";

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

  it("before the rules began (Nov 12, 2026), a future-dated payment that covers the bill counts as Paid", () => {
    const s = oct(bill({ dueDay: 28 }), [pay(100, "2026-10-27")]);
    expect(s).toMatchObject({ status: "paid", scheduled: true, note: "Scheduled for Oct 27" });
    // ...and nothing is assumed paid: those balances were already current.
    expect(getBillStatus(bill({ dueDay: 15 }), {}, 2026, 7, TODAY)).toMatchObject({ status: "pastDue", assumed: false });
  });

  it("from Nov 12, 2026: a payment dated ahead keeps the bill in To pay until it happens or is cleared", () => {
    const dec = new Date(2026, 11, 3);
    const b = bill({ dueDay: 28 });
    const s = getBillStatus(b, { b: { payments: [pay(100, "2026-12-27")] } }, 2026, 11, dec);
    expect(s).toMatchObject({ status: "upcoming", scheduled: true, paidAmount: 0, remaining: 100, note: "Scheduled for Dec 27 · due Dec 28" });
    expect(getBillStatus(b, { b: { payments: [pay(100, "2026-12-27", { cleared: true })] } }, 2026, 11, dec)).toMatchObject({ status: "paid", paidAmount: 100 });
  });

  it("from Nov 12, 2026: a payment left unmarked 60 days past its due date is assumed paid", () => {
    const b = bill({ dueDay: 15 });
    expect(getBillStatus(b, {}, 2026, 11, new Date(2027, 1, 14))).toMatchObject({ status: "paid", assumed: true, note: "Assumed paid — not marked within 60 days" }); // Dec 15: 61 days
    expect(getBillStatus(b, {}, 2026, 11, new Date(2027, 1, 12))).toMatchObject({ status: "pastDue", assumed: false }); // 59 days
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

  it("shows a twice-a-month bill as two payments, each with its own date and status", () => {
    // MK Upstart: $250 on the 1st and the 15th, by hand. $250 paid Nov 2 (a
    // day late for payment 1), $250 logged ahead for Nov 15; today Nov 12.
    const mk = bill({ id: "mk", name: "MK Upstart", twiceMonthly: true, dueDay: 1, dueDay2: 15, paymentAmount: 250, monthly: 510 });
    const nov = { mk: { payments: [{ id: "a", amount: 250, date: "2026-11-02" }, { id: "b", amount: 250, date: "2026-11-15" }] } };
    const rows = billStatusesForMonth(mk, nov, 2026, 10, new Date(2026, 10, 12));
    expect(rows.map((r) => [r.displayName, r.owed, r.status, r.note])).toEqual([
      ["MK Upstart · payment 1 of 2", 250, "paid", "Paid Nov 2"],
      ["MK Upstart · payment 2 of 2", 250, "dueSoon", "Scheduled for Nov 15 · due Nov 15"],
    ]);
    // Leaves To pay only once both are done: marked paid, dated past, or cleared.
    const cleared = { mk: { payments: [nov.mk.payments[0], { ...nov.mk.payments[1], cleared: true }] } };
    expect(billStatusesForMonth(mk, cleared, 2026, 10, new Date(2026, 10, 12)).map((r) => r.status)).toEqual(["paid", "paid"]);
    // Together they're the bill's monthly payment, every month.
    expect(rows.reduce((s, r) => s + r.owed, 0)).toBe(500);
    // Nothing logged: payment 1 is past due, payment 2 due soon.
    expect(billStatusesForMonth(mk, {}, 2026, 10, new Date(2026, 10, 12)).map((r) => r.status)).toEqual(["pastDue", "dueSoon"]);
  });

  it("autopay twice a month: each payment paid once its date passes", () => {
    const mk = bill({ id: "mk", twiceMonthly: true, dueDay: 1, dueDay2: 15, paymentAmount: 250, autopay: true });
    expect(billStatusesForMonth(mk, {}, 2026, 10, new Date(2026, 10, 12)).map((r) => [r.status, r.note])).toEqual([
      ["paid", "Autopay debited Nov 1"],
      ["dueSoon", "Autopay Nov 15"],
    ]);
  });

  it("marks one payment of a twice-a-month bill paid, tagged so it counts toward that payment", () => {
    const mk = bill({ id: "mk", twiceMonthly: true, dueDay: 1, dueDay2: 15, paymentAmount: 250 });
    const today = new Date(2026, 10, 12);
    const [, second] = billStatusesForMonth(mk, {}, 2026, 10, today);
    const pbm = markBillPaid({}, "2026-11", mk, today, second);
    expect(pbm["2026-11"].mk.payments).toMatchObject([{ amount: 250, part: 2 }]);
    const rows = billStatusesForMonth(mk, pbm["2026-11"], 2026, 10, today);
    expect(rows.map((r) => r.status)).toEqual(["pastDue", "paid"]);
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
