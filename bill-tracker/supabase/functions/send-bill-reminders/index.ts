// Deploy: supabase functions deploy send-bill-reminders
// Secrets it needs (supabase secrets set NAME=value):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto: address
//   or https:// URL identifying who's sending — required by the Web Push
//   spec, shown to push services, not to end users)
// Optional, for a daily email digest as well as (or instead of) pushes —
// sent through Resend (resend.com, free for 100 emails a day):
//   RESEND_API_KEY, REMINDER_EMAIL_FROM (an address on a domain verified in
//   Resend, e.g. "Clear to Close <reminders@yourdomain.com>"),
//   REMINDER_EMAIL_TO (comma-separated recipients)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// the Edge Functions runtime — nothing to set for those.
//
// Meant to run once a day via the cron job in
// supabase/cron_bill_reminders.sql — see that file for how to schedule it.
// Which bills get reminded, and when, lives in reminders.ts.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import { billsDueForReminder, reminderMessage, type Bill } from "./reminders.ts";

const APP_URL = "/Mortgage_DTI/";

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

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

  const state = householdRow.data || {};
  const debts: Bill[] = (state.debts || []).filter((d: { isDebt?: boolean }) => d.isDebt !== false);
  const fixed: Bill[] = state.fixed || [];
  const reminders = billsDueForReminder([...debts, ...fixed], state.paidByMonth || {}, new Date());
  const messages = reminders.map((r) => ({ ...reminderMessage(r), billId: r.bill.id }));

  let sent = 0;
  const staleEndpoints: string[] = [];
  if (messages.length > 0 && subscriptions && subscriptions.length > 0) {
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
    for (const { title, body, billId } of messages) {
      // One tag per bill: "was due yesterday" replaces "due today" on the
      // phone instead of stacking up beside it.
      const payload = JSON.stringify({ title, body, url: APP_URL, tag: `bill-${billId}` });
      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) staleEndpoints.push(sub.endpoint);
          else console.error("push failed", sub.endpoint, err);
        }
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  const emailed = messages.length > 0 ? await sendDigestEmail(messages) : 0;

  return new Response(
    JSON.stringify({ due: reminders.length, subscriptions: subscriptions?.length || 0, sent, staleRemoved: staleEndpoints.length, emailed }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

// One email a day listing every reminder, when the Resend secrets are set.
// Returns how many recipients it went to (0 when email isn't set up).
async function sendDigestEmail(messages: { title: string; body: string }[]) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("REMINDER_EMAIL_FROM");
  const to = (Deno.env.get("REMINDER_EMAIL_TO") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey || !from || to.length === 0) return 0;

  const subject = messages.length === 1 ? messages[0].title : `${messages.length} bill reminders`;
  const text = messages.map((m) => `• ${m.title} — ${m.body}`).join("\n");
  const html = `<ul>${messages.map((m) => `<li><strong>${escapeHtml(m.title)}</strong> — ${escapeHtml(m.body)}</li>`).join("")}</ul>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  if (!res.ok) {
    console.error("email failed", res.status, await res.text());
    return 0;
  }
  return to.length;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
