import { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import Sheet from "./ui/Sheet";
import { ListButton, ListRow, ListSection } from "./ui/List";
import { getPaymentRecord, money } from "../utils/finance";
import { findDuplicateGroups, suggestedKeeper } from "../utils/duplicates";
import { ordinal, shortDate } from "../utils/format";
import { useHouseholdContext } from "../state/HouseholdContext";

// Like the Duplicates album in Photos: bills that look like the same one
// entered twice, side by side. Merge keeps the one you pick, moves every
// payment from the others onto it and fills in anything it's missing;
// "Not Duplicates" stops suggesting that group.
export default function DuplicatesSheet({ onClose }) {
  const h = useHouseholdContext();
  const groups = findDuplicateGroups(h.debts, h.fixed);
  const [keepers, setKeepers] = useState({}); // group's first bill id → id to keep

  const paymentCount = (b) => Object.values(h.paidByMonth || {}).reduce((n, m) => n + getPaymentRecord(m, b).payments.length, 0);
  function details(b) {
    return [
      b.monthly ? `${money(b.monthly)}/mo` : null,
      b.dueDay ? `due the ${ordinal(b.dueDay)}` : null,
      b.balance !== null && b.balance !== undefined ? `${money(b.balance)} payoff` : null,
      b.apr ? `${b.apr}%` : null,
      `${paymentCount(b)} payment${paymentCount(b) === 1 ? "" : "s"} logged`,
      b.balanceUpdatedAt || b.balanceAsOf ? `updated ${shortDate(b.balanceUpdatedAt || b.balanceAsOf)}` : null,
    ].filter(Boolean).join(" · ");
  }

  return (
    <Sheet title="Duplicates" onClose={onClose}>
      {groups.length === 0 && (
        <ListSection footer="Bills with the same name, or a similar name and the same payment, due day or payoff, show up here.">
          <ListRow title="No duplicates found" />
        </ListSection>
      )}
      {groups.map((g) => {
        const groupKey = g.items[0].id;
        const keepId = keepers[groupKey] || suggestedKeeper(g.items, h.paidByMonth).id;
        const keep = g.items.find((b) => b.id === keepId);
        const others = g.items.filter((b) => b.id !== keepId);
        return (
          <ListSection
            key={groupKey}
            header={`${g.reason} · ${g.kind === "debts" ? "Debts" : "Fixed Expenses"}`}
            footer={`Merging keeps ${keep.name}, moves ${others.length === 1 ? "the other one's" : "the others'"} payments onto it, fills in anything it's missing, and deletes ${others.length === 1 ? "the other" : "the rest"}.`}
          >
            <div role="radiogroup" aria-label={`Which ${g.items[0].name} to keep`}>
              {g.items.map((b) => {
                const on = b.id === keepId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="row row-button import-row duplicate-row"
                    onClick={() => setKeepers((k) => ({ ...k, [groupKey]: b.id }))}
                  >
                    {on ? <CheckCircle2 size={22} className="import-check on" aria-hidden="true" /> : <Circle size={22} className="import-check" aria-hidden="true" />}
                    <span className="row-body">
                      <span className="row-title">{b.name} {on && <span className="badge badge-blue">Keep</span>}</span>
                      <span className="row-subtitle">{details(b)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <ListButton onClick={() => h.mergeBills(g.kind, keepId, others.map((b) => b.id))}>Merge into {keep.name}</ListButton>
            <ListButton onClick={() => h.markNotDuplicates(g.kind, g.items.map((b) => b.id))}>Not Duplicates</ListButton>
          </ListSection>
        );
      })}
    </Sheet>
  );
}
