import { Link2Off, X } from "lucide-react";
import Banner from "./ui/Banner";

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
    <Banner
      tone="success"
      icon={<Link2Off size={18} />}
      action={<button type="button" className="icon-btn repair-dismiss" onClick={onDismiss} aria-label="Dismiss" title="Dismiss"><X size={18} /></button>}
    >
      <div className="repair-banner">
        <strong>Unlinked records that were sharing an ID.</strong> Editing or deleting one of these used to change the
        other too. Each one now has its own ID; payments that clearly belonged to one bill (same amount as its monthly
        payment) moved with it, and anything ambiguous stayed with the first.
        <ul>
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
          <p>
            <strong>Check the Paid Off list:</strong>{" "}
            {archivedSuspects.map((g) => g.members.find((m) => m.collection === "paidOffDebts").name).join(", ")}{" "}
            {archivedSuspects.length === 1 ? "was" : "were"} archived while linked to another bill. Deleting one of a
            linked pair used to archive whichever came first and remove both — make sure the right one is marked paid off.
          </p>
        )}
        <p className="repair-banner-foot">
          {notice.saved
            ? <>The original data was backed up first, as <code>{notice.backupId}</code> in household_state.</>
            : "Couldn't save the repair to Supabase yet — it'll retry (backing up the original first) with your next change."}
        </p>
      </div>
    </Banner>
  );
}
