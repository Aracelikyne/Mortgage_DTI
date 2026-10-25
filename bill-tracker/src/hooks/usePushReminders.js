import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// The public half of the VAPID key pair the send-bill-reminders Edge
// Function signs pushes with — safe to ship in client code (that's the
// whole point of the public/private split). Must match VAPID_PUBLIC_KEY in
// that function's secrets; see supabase/cron_bill_reminders.sql for setup.
const VAPID_PUBLIC_KEY = "BAiXVfZDrMTpqFJEAxgOZ6HMYXGup8JwA2aRY6DrngCqlAG0tyPo8BV4Tl_KsDTm5_VWjLWsWpN4qPp2RlGmKZI";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Bill-due-date push notifications. Each browser/device that turns this on
// gets its own subscription row — so switching it on here only affects
// notifications on this device, not the other person's.
export function usePushReminders({ userId, userName }) {
  const [supported] = useState(() => "serviceWorker" in navigator && "PushManager" in window);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, [supported]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          user_name: userName,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        },
        { onConflict: "endpoint" }
      );
      if (error) throw error;
      setSubscribed(true);
    } catch (err) {
      console.error(err);
    }
    setBusy(false);
  }, [userId, userName]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (err) {
      console.error(err);
    }
    setBusy(false);
  }, []);

  return { supported, subscribed, busy, setEnabled: (on) => (on ? enable() : disable()) };
}
