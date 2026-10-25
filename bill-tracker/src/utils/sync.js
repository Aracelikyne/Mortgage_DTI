import { relativeTime } from "./time";

// "Saved · Last edit: Bob · 5m ago" — the sync line shown in More and the sidebar.
export function syncStatusText(saveStatus, lastEditedBy) {
  const status = { saving: "Saving…", saved: "Saved", error: "Couldn't save", idle: "Up to date" }[saveStatus] || "Up to date";
  const last = lastEditedBy?.name ? `Last edit: ${lastEditedBy.name}${lastEditedBy.at ? ` · ${relativeTime(lastEditedBy.at)}` : ""}` : null;
  return [status, last].filter(Boolean).join(" · ");
}
