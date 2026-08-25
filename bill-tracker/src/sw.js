import { precacheAndRoute } from "workbox-precaching";

// Same app-shell precaching vite-plugin-pwa's generateSW mode did before —
// this file exists instead of that mode only because push notifications
// need custom event listeners generateSW has no hook for.
precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A bill-reminder push arrives as JSON: { title, body, url }. Falls back to
// a generic message if the payload is missing/malformed rather than
// silently dropping the notification.
self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Clear to Close";
  const options = {
    body: payload.body || "You have a bill reminder.",
    icon: "/Mortgage_DTI/icon-192.png",
    badge: "/Mortgage_DTI/icon-192.png",
    data: { url: payload.url || "/Mortgage_DTI/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focuses an already-open tab instead of always opening a new one, so
// tapping a reminder doesn't pile up duplicate installed-app windows.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/Mortgage_DTI/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/Mortgage_DTI/") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
