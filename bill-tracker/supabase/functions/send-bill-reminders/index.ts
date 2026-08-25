// Deploy: supabase functions deploy send-bill-reminders
// Secrets it needs (supabase secrets set NAME=value):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto: address
//   or https:// URL identifying who's sending — required by the Web Push
//   spec, shown to push services, not to end users)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// the Edge Functions runtime — nothing to set for those.
//
// Meant to run once a day via the cron job in
// supabase/cron_bill_reminders.sql — see that file for how to schedule it.
// Stateless by design: a bill only matches "due in REMINDER_DAYS_AHEAD
// days" or "overdue" on the one specific day the arithmetic below lands on,
// so a daily run naturally reminds about each bill at most once per month
// per condition, with no separate "already reminded" table to keep in sync.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const REMINDER_DAYS_AHEAD = 3;

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function dueDateInMonth(dueDay: number, year: number, monthIndex: number) {
  const dim = lastDayOfMonth(year, monthIndex);
  const day = Math.min(dueDay, dim);
  return new Date(year, monthIndex, day);
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

// Mirrors getPaymentRecord's settledAmount logic in src/utils/finance.js,
// trimmed to just what a reminder needs — kept self-contained here rather
// than importing across the app/function boundary, so this function stays
// independently deployable.
function amountPaidFor(monthEntry: Record<string, unknown>, billId: string) {
  const raw = monthEntry?.[billId] as { payments?: { amount?: number }[] } | undefined;
  if (!raw || !Array.isArray(raw.payments)) return 0;
  return raw.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
}

type Bill = { id: string; name: string; monthly?: number; dueDay?: number | null; graceDays?: number };

// Checks both this month's and next month's occurrence of the due date —
// a bill due on the 1st needs its "3 days ahead" reminder to fire in the
// tail end of the PRIOR month, which a this-month-only check would miss
// entirely for any due day <= REMINDER_DAYS_AHEAD.
function billsDueForReminder(bills: Bill[], paidByMonth: Record<string, Record<string, unknown>>, today: Date) {
  const due: { bill: Bill; kind: "upcoming" | "overdue" }[] = [];
  for (const bill of bills) {
    const monthly = Number(bill.monthly) || 0;
    if (monthly <= 0 || bill.dueDay == null) continue;
    const grace = Number(bill.graceDays) || 0;
    const candidates = [
      dueDateInMonth(Number(bill.dueDay), today.getFullYear(), today.getMonth()),
      dueDateInMonth(Number(bill.dueDay), today.getFullYear(), today.getMonth() + 1),
    ];
    for (const dueDate of candidates) {
      const daysUntil = daysBetween(today, dueDate); // positive = due date is in the future
      const monthEntry = paidByMonth[monthKeyOf(dueDate)] || {};
      if (amountPaidFor(monthEntry, bill.id) >= monthly) continue;
      if (daysUntil === REMINDER_DAYS_AHEAD) { due.push({ bill, kind: "upcoming" }); break; }
      if (daysUntil === -(grace + 1)) { due.push({ bill, kind: "overdue" }); break; }
    }
  }
  return due;
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY")!;
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY")!;
  const vapidSubject = Deno.env.get("VAPID_SUBJECT")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const { data: householdRow, error: householdError } = await supabase
    .from("household_state")
    .select("data")
    .eq("id", "household")
    .maybeSingle();
  if (householdError || !householdRow) {
    return new Response(JSON.stringify({ error: householdError?.message || "No household_state row" }), { status: 500 });
  }

  const { data: subscriptions, error: subError } = await supabase.from("push_subscriptions").select("*");
  if (subError) {
    return new Response(JSON.stringify({ error: subError.message }), { status: 500 });
  }
  if (!subscriptions || subscriptions.length === 0) {
    return new Response(JSON.stringify({ sent: 0, due: 0, note: "No one has push reminders turned on." }), { status: 200 });
  }

  const state = householdRow.data || {};
  const debts: Bill[] = (state.debts || []).filter((d: { isDebt?: boolean }) => d.isDebt !== false);
  const fixed: Bill[] = state.fixed || [];
  const paidByMonth = state.paidByMonth || {};
  const today = new Date();

  const dueBills = billsDueForReminder([...debts, ...fixed], paidByMonth, today);

  let sent = 0;
  const staleEndpoints: string[] = [];

  for (const { bill, kind } of dueBills) {
    const title = kind === "overdue" ? `Overdue: ${bill.name}` : `${bill.name} due soon`;
    const body =
      kind === "overdue"
        ? `${bill.name}'s payment (${money(bill.monthly)}) is past its grace period and still unpaid.`
        : `${bill.name}'s ${money(bill.monthly)} payment is due in ${REMINDER_DAYS_AHEAD} days.`;
    const payload = JSON.stringify({ title, body, url: "/Mortgage_DTI/" });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) staleEndpoints.push(sub.endpoint);
        else console.error("push failed", sub.endpoint, err);
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  return new Response(
    JSON.stringify({ due: dueBills.length, subscriptions: subscriptions.length, sent, staleRemoved: staleEndpoints.length }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

function money(n: number | undefined) {
  const num = Number(n) || 0;
  return `$${Math.round(num).toLocaleString()}`;
}
