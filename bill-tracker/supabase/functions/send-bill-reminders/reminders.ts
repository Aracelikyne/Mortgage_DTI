// Which bills get a reminder today, and what it says. Plain date logic with
// no imports, so the function stays independently deployable and the unit
// tests (supabase/functions/send-bill-reminders/reminders.test.ts) can run
// it under Node.
//
// Stateless by design: each reminder kind matches on exactly one day per
// due date, so a once-a-day run sends each one at most once, with no
// "already reminded" table to keep in sync.

export const REMINDER_DAYS_AHEAD = 3;

export type Bill = { id: string; name: string; monthly?: number; dueDay?: number | null; graceDays?: number; autopay?: boolean };
export type ReminderKind = "upcoming" | "today" | "passed" | "overdue";
export type Reminder = { bill: Bill; kind: ReminderKind; dueDate: Date };

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function dueDateInMonth(dueDay: number, year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const dim = lastDayOfMonth(first.getFullYear(), first.getMonth());
  return new Date(first.getFullYear(), first.getMonth(), Math.min(dueDay, dim));
}

function daysBetween(a: Date, b: Date) {
  const ms = 24 * 60 * 60 * 1000;
  const aUTC = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUTC = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bUTC - aUTC) / ms);
}

function monthKeyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Mirrors getPaymentRecord's amountPaid logic in src/utils/finance.js,
// trimmed to just what a reminder needs. Extra payments (kind: "extra",
// logged from the Extra money card) go toward the balance, not the bill's
// regular payment, so they never count as the bill having been paid.
function amountPaidFor(monthEntry: Record<string, unknown>, billId: string) {
  const raw = monthEntry?.[billId] as { payments?: { amount?: number; kind?: string }[] } | undefined;
  if (!raw || !Array.isArray(raw.payments)) return 0;
  return raw.payments.reduce((s, p) => s + (p.kind === "extra" ? 0 : Number(p.amount) || 0), 0);
}

// Each bill can get, per due date:
//   upcoming — REMINDER_DAYS_AHEAD days before (autopay too: a heads-up to
//              have the money there)
//   today    — on the due date
//   passed   — the day after, still not marked paid
//   overdue  — the day the grace period runs out, still unpaid (only for
//              bills with grace days, so it never repeats "passed")
// Autopay debits itself with nothing logged by hand, so it only gets the
// heads-up — never "today", "passed" or "overdue".
//
// Checks last month's, this month's and next month's due dates: a bill due
// the 1st needs its heads-up at the end of the prior month, and one due the
// 30th is "passed" or "overdue" early in the next.
export function billsDueForReminder(bills: Bill[], paidByMonth: Record<string, Record<string, unknown>>, today: Date): Reminder[] {
  const due: Reminder[] = [];
  for (const bill of bills) {
    const monthly = Number(bill.monthly) || 0;
    if (monthly <= 0 || bill.dueDay == null) continue;
    const grace = Number(bill.graceDays) || 0;
    for (const offset of [-1, 0, 1]) {
      const dueDate = dueDateInMonth(Number(bill.dueDay), today.getFullYear(), today.getMonth() + offset);
      if (amountPaidFor(paidByMonth[monthKeyOf(dueDate)] || {}, bill.id) >= monthly) continue;
      const daysUntil = daysBetween(today, dueDate); // positive = due date is in the future
      let kind: ReminderKind | null = null;
      if (daysUntil === REMINDER_DAYS_AHEAD) kind = "upcoming";
      else if (bill.autopay) kind = null;
      else if (daysUntil === 0) kind = "today";
      else if (daysUntil === -1) kind = "passed";
      else if (grace > 0 && daysUntil === -(grace + 1)) kind = "overdue";
      if (kind) { due.push({ bill, kind, dueDate }); break; }
    }
  }
  return due;
}

function money(n: number | undefined) {
  return `$${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
}

export function reminderMessage({ bill, kind }: Reminder) {
  const amount = money(bill.monthly);
  switch (kind) {
    case "upcoming":
      return {
        title: `${bill.name} due in ${REMINDER_DAYS_AHEAD} days`,
        body: bill.autopay
          ? `${amount} autopays in ${REMINDER_DAYS_AHEAD} days — make sure the money's there.`
          : `${amount} is due in ${REMINDER_DAYS_AHEAD} days.`,
      };
    case "today":
      return { title: `${bill.name} is due today`, body: `${amount} is due today. Already paid? Mark it in Monthly Plan.` };
    case "passed":
      return { title: `${bill.name} was due yesterday`, body: `${amount} isn't marked paid. If you paid it, mark it in Monthly Plan.` };
    case "overdue":
      return { title: `Overdue: ${bill.name}`, body: `${amount} is past its grace period and still not marked paid.` };
  }
}
