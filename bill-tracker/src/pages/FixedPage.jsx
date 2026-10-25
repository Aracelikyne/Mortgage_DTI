import { useState } from "react";
import { Plus, Zap } from "lucide-react";
import PageHeader from "../components/PageHeader";
import FixedEditorSheet from "../components/FixedEditorSheet";
import { ListRow, ListSection } from "../components/ui/List";
import { money } from "../utils/finance";
import { ordinal } from "../utils/format";
import { useHouseholdContext } from "../state/HouseholdContext";

export default function FixedPage({ headerActions }) {
  const h = useHouseholdContext();
  const [editing, setEditing] = useState(null); // an item, or "new"
  const editingItem = editing && editing !== "new" ? editing : null;

  return (
    <>
      <PageHeader
        title="Fixed Expenses"
        actions={(
          <>
            {headerActions}
            <button type="button" className="nav-btn" onClick={() => setEditing("new")} aria-label="Add expense" title="Add expense"><Plus size={24} /></button>
          </>
        )}
      />
      <div className="page-content">
        {h.fixed.length === 0 ? (
          <p className="muted center">No fixed expenses yet — tap + to add rent, utilities, subscriptions…</p>
        ) : (
          <ListSection
            header="Every month"
            headerDetail={<span className="num">{money(h.totalFixedMonthly)}/mo</span>}
            footer="Fixed expenses aren't debts — they don't count toward DTI unless it's rent and you've turned that on — but they're part of the Monthly Plan and the Paycheck Plan."
          >
            {h.fixed.map((f) => (
              <ListRow
                key={f.id}
                title={<>{f.name}{f.autopay && <Zap size={14} className="inline-icon tone-orange" aria-label="Autopay" />}</>}
                subtitle={[f.type, f.dueDay ? `due the ${ordinal(f.dueDay)}` : null, f.note || null].filter(Boolean).join(" · ")}
                detail={<span className="num">{money(Number(f.monthly || 0))}</span>}
                onClick={() => setEditing(f)}
              />
            ))}
          </ListSection>
        )}
      </div>

      {editing && (
        <FixedEditorSheet
          item={editingItem}
          onSave={(fields) => (editingItem ? h.updateFixed(editingItem.id, fields) : h.addFixed(fields))}
          onDelete={() => editingItem && h.removeFixed(editingItem.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
