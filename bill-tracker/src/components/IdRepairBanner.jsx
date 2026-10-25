import { Link2Off, X } from "lucide-react";

const KIND = {
  debts: "Debts",
  fixed: "Fixed Expenses",
  paidOffDebts: "Paid Off",
  incomeSources: "Paycheck",
  boosts: "Boost",
};

// Shown once, after repairDuplicateIds() unlinked records that had been
// sharing an id — so it's clear what changed and what's worth a second look.
export default function IdRepairBanner({ notice, onDismiss }) {
  if (!notice) return null;
  const billGroups = notice.groups.filter((g) => g.domain === "bills");
  const otherGroups = notice.groups.filter((g) => g.domain !== "bills");
  const archivedSuspects = billGroups.filter((g) => g.members.some((m) => m.collection === "paidOffDebts"));

  return (
    <div className="repair-banner" role="status">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Link2Off size={18} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <strong>Unlinked records that were sharing an ID.</strong> Editing or deleting one of these used to change the
          other too. Each one now has its own ID; payments that clearly belonged to one bill (same amount as its monthly
          payment) moved with it, and anything ambiguous stayed with the first.
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {billGroups.map((g) => (
              <li key={`${g.sharedId}-${g.members.map((m) => m.newId).join("|")}`}>
                {g.members.map((m) => `${m.name} (${KIND[m.collection] || m.collection})`).join(" ↔ ")}
                {g.members.filter((m) => m.movedPayments > 0).map((m) => (
                  <span key={m.newId}> — {m.movedPayments} payment{m.movedPayments === 1 ? "" : "s"} moved to {m.name}</span>
                ))}
              </li>
            ))}
            {otherGroups.map((g) => (
              <li key={`${g.domain}-${g.sharedId}-${g.members.map((m) => m.newId).join("|")}`}>
                {g.members.map((m) => `${m.name} (${KIND[m.collection] || m.collection})`).join(" ↔ ")}
                {g.members.filter((m) => m.movedOverrides > 0).map((m) => (
                  <span key={m.newId}> — {m.movedOverrides} paycheck date change{m.movedOverrides === 1 ? "" : "s"} moved to {m.name}</span>
                ))}
              </li>
            ))}
          </ul>
          {archivedSuspects.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Check the Paid Off list:</strong>{" "}
              {archivedSuspects.map((g) => g.members.find((m) => m.collection === "paidOffDebts").name).join(", ")}{" "}
              {archivedSuspects.length === 1 ? "was" : "were"} archived while linked to another bill. Deleting one of a
              linked pair used to archive whichever came first and remove both — make sure the right one is marked paid off.
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12 }}>
            {notice.saved
              ? <>The original data was backed up first, as <code>{notice.backupId}</code> in household_state.</>
              : "Couldn't save the repair to Supabase yet — it'll retry (backing up the original first) with your next change."}
          </div>
        </div>
        <button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={onDismiss} title="Dismiss">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
