import { useState } from "react";
import { FileUp, Lock, Plus, Zap } from "lucide-react";
import PageHeader from "../components/PageHeader";
import DebtEditorSheet from "../components/DebtEditorSheet";
import Sheet, { SheetAction } from "../components/ui/Sheet";
import { ListRow, ListSection } from "../components/ui/List";
import { TIERS } from "../data/constants";
import { balanceAnchorOf, fmtDate, isUnderwater, money, willNeverGetExtra } from "../utils/finance";
import BillBadges from "../components/BillBadges";
import DuplicatesBanner from "../components/DuplicatesBanner";
import { ordinal, shortDate } from "../utils/format";
import { useHouseholdContext } from "../state/HouseholdContext";

// Debts as list rows grouped by payoff tier — name, today's balance,
// monthly payment and APR at a glance — each opening an edit sheet.
export default function DebtsPage() {
  const h = useHouseholdContext();
  const [editing, setEditing] = useState(null); // a debt, or "new"
  const [viewingArchived, setViewingArchived] = useState(null);

  // A debt is "growing" if its past payments haven't covered the interest,
  // if it'll never get extra money and its minimum doesn't cover interest,
  // or if the projection still has it growing because its turn never comes.
  function isGrowing(d) {
    const rb = h.runningBalances[d.id];
    if (!rb || rb.balance === null || rb.balance === undefined) return false;
    return rb.growing
      || (willNeverGetExtra(d) && isUnderwater({ ...d, balance: rb.balance }))
      || (h.sim.stillGrowingDebtIds || []).includes(d.id);
  }

  function debtRow(d) {
    const running = h.runningBalanceOf(d);
    const growing = isGrowing(d);
    const hasBalance = d.balance !== null && d.balance !== undefined;
    return (
      <ListRow
        key={d.id}
        title={(
          <>
            {d.name}{d.autopay && <Zap size={14} className="inline-icon tone-orange" aria-label="Autopay" />}
            <BillBadges item={d} kind="debts" />
          </>
        )}
        subtitle={(
          <>
            {[d.type, d.dueDay ? `due the ${ordinal(d.dueDay)}` : null, growing ? "growing" : null].filter(Boolean).join(" · ")}
            <span className="row-tracker">Payoff updated {shortDate(d.balanceUpdatedAt || balanceAnchorOf(d))}{d.balanceUpdatedBy ? ` · by ${d.balanceUpdatedBy}` : ""}</span>
          </>
        )}
        detail={(
          <span className="row-amounts">
            <span className={`num row-amount-main ${growing ? "tone-red" : ""}`}>{hasBalance ? money(running) : "—"}</span>
            <span className="num row-amount-sub">{money(Number(d.monthly || 0))}/mo{d.apr !== null && d.apr !== undefined && d.apr !== "" ? ` · ${Number(d.apr)}%` : ""}</span>
          </span>
        )}
        onClick={() => setEditing(d)}
      />
    );
  }

  const editingDebt = editing && editing !== "new" ? editing : null;
  return (
    <>
      <PageHeader
        title="Debts"
        actions={(
          <>
            <button type="button" className="nav-btn" onClick={() => h.openImport("statement")} aria-label="Import from Numbers" title="Import from Numbers"><FileUp size={22} /></button>
            <button type="button" className="nav-btn" onClick={() => setEditing("new")} aria-label="Add debt" title="Add debt"><Plus size={24} /></button>
          </>
        )}
      />
      <div className="page-content">
        <DuplicatesBanner kind="debts" />
        {h.debts.length === 0 && h.paidOffDebts.length === 0 && (
          <p className="muted center">No debts yet — tap + to add one.</p>
        )}
        {h.tierGroups.map(({ tier, items }) => {
          if (items.length === 0) return null;
          const balance = items.reduce((s, d) => s + h.runningBalanceOf(d), 0);
          const monthly = items.reduce((s, d) => s + Number(d.monthly || 0), 0);
          return (
            <ListSection
              key={tier}
              header={<><span className="tier-dot" style={{ background: TIERS[tier].color }} />{TIERS[tier].label}</>}
              headerDetail={<span className="num">{money(monthly)}/mo · {money(balance)}</span>}
            >
              {items.map(debtRow)}
            </ListSection>
          );
        })}

        {h.protectedGroup.length > 0 && (
          <ListSection
            header={<><Lock size={12} className="inline-icon" />Minimum only, forever</>}
            headerDetail={<span className="num">{money(h.protectedGroup.reduce((s, d) => s + Number(d.monthly || 0), 0))}/mo</span>}
            footer="These count toward your DTI and never get extra payments. Turn on “Count toward debt-free goal” if you want one in your debt-free date — it needs a balance to be projectable."
          >
            {h.protectedGroup.map(debtRow)}
          </ListSection>
        )}

        {h.paidOffDebts.length > 0 && (
          <ListSection
            header="Paid off"
            headerDetail={<span className="num">{money(h.paidOffTotal)} so far</span>}
            footer="Marking a debt paid off moves it here instead of erasing it, so this is a running record. Tap one to restore it or delete it for good."
          >
            {h.paidOffDebts.map((d) => (
              <ListRow
                key={d.id}
                title={d.name}
                subtitle={[d.type, d.payoffDate ? `paid off ${fmtDate(new Date(d.payoffDate + "T00:00:00"))}` : null].filter(Boolean).join(" · ")}
                detail={<span className="num">{money(d.balanceAtPayoff)}</span>}
                onClick={() => setViewingArchived(d)}
              />
            ))}
          </ListSection>
        )}
      </div>

      {editing && (
        <DebtEditorSheet
          debt={editingDebt}
          runningBalance={editingDebt ? h.runningBalances[editingDebt.id]?.balance : null}
          growing={editingDebt ? isGrowing(editingDebt) : false}
          paymentsApplied={editingDebt ? h.runningBalances[editingDebt.id]?.paymentsApplied || 0 : 0}
          userName={h.userName}
          categoryPatch={h.categoryPatch}
          onSave={(fields) => (editingDebt ? h.updateDebt(editingDebt.id, fields) : h.addDebt(fields))}
          onArchive={() => editingDebt && h.removeDebt(editingDebt.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {viewingArchived && (
        <Sheet title={viewingArchived.name} onClose={() => setViewingArchived(null)}>
          <ListSection>
            <ListRow title="Paid off" detail={<span className="num">{money(viewingArchived.balanceAtPayoff)}</span>} />
            <ListRow title="Date" detail={viewingArchived.payoffDate ? fmtDate(new Date(viewingArchived.payoffDate + "T00:00:00")) : "—"} />
          </ListSection>
          <ListSection footer="Restoring puts it back on the active list with its payment history.">
            <SheetAction onClick={() => h.restoreDebt(viewingArchived.id)}>Restore to Debts</SheetAction>
          </ListSection>
          <ListSection footer="Removes it from the Paid Off record for good — this can't be undone.">
            <SheetAction destructive onClick={() => h.deleteArchivedDebt(viewingArchived.id)}>Delete Permanently</SheetAction>
          </ListSection>
        </Sheet>
      )}
    </>
  );
}
