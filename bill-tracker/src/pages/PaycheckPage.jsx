import { useState } from "react";
import { CheckCircle2, Clock, Pencil, Plus, TriangleAlert } from "lucide-react";
import PageHeader from "../components/PageHeader";
import IncomeSourceSheet from "../components/IncomeSourceSheet";
import Banner from "../components/ui/Banner";
import { ListRow, ListSection, NumberField } from "../components/ui/List";
import { fmtDate, isoDate, money } from "../utils/finance";
import { useHouseholdContext } from "../state/HouseholdContext";

const FREQUENCY_LABEL = { weekly: "weekly", biweekly: "every 2 weeks", monthly: "monthly" };

export default function PaycheckPage() {
  const h = useHouseholdContext();
  const plan = h.paycheckPlan;
  const [editingSource, setEditingSource] = useState(null); // a source, or {} for a new one
  const [editingPaycheckId, setEditingPaycheckId] = useState(null);

  function saveSource(draft) {
    if (draft.id) h.updateIncomeSource(draft.id, draft);
    else h.addIncomeSource(draft);
  }

  return (
    <>
      <PageHeader
        title="Paycheck Plan"
        actions={<button type="button" className="nav-btn" onClick={() => setEditingSource({})} aria-label="Add paycheck source" title="Add paycheck source"><Plus size={24} /></button>}
      />
      <div className="page-content">
        <ListSection
          header="Paychecks"
          footer="Bills are assigned to whichever paycheck falls in their billing window, factoring in each bill's grace period. A bill too big for one check gets split across the checks that cover it."
        >
          {h.incomeSources.length === 0 && <div className="row muted">No paychecks yet — tap + to add one.</div>}
          {h.incomeSources.map((src) => (
            <ListRow
              key={src.id}
              title={src.name || "Unnamed paycheck"}
              subtitle={[
                src.amount ? money(Number(src.amount)) : "No amount",
                FREQUENCY_LABEL[src.frequency || "biweekly"],
                src.nextPayDate ? `next ${fmtDate(new Date(src.nextPayDate + "T00:00:00"))}` : "no date set",
              ].join(" · ")}
              onClick={() => setEditingSource(src)}
            />
          ))}
        </ListSection>

        <ListSection footer="Held back from every check before bills are assigned — never counted as available to spend down.">
          <NumberField
            label="Reserve per paycheck"
            value={h.paycheckReserve}
            min="0"
            placeholder="gas & groceries"
            onChange={(v) => h.setPaycheckReserve(v === "" ? "" : Number(v))}
          />
        </ListSection>

        {plan.noIncome ? (
          <p className="muted center">Add an amount and a next pay date to a paycheck to see your plan.</p>
        ) : (
          <>
            {plan.shortfalls.length > 0 && (
              <Banner tone="warning" icon={<TriangleAlert size={18} />}>
                <strong>Heads up:</strong> {plan.shortfalls.length} bill{plan.shortfalls.length > 1 ? "s" : ""} in this window
                may not be fully covered by income before it's due — {plan.shortfalls.map((s) => s.name).join(", ")}.
              </Banner>
            )}
            {plan.lateButInGrace.length > 0 && (
              <Banner tone="info">
                <strong>Paid within grace, not by the due date:</strong>{" "}
                {plan.lateButInGrace.map((l) => `${l.name} (${l.daysLate}d late)`).join(", ")}.
              </Banner>
            )}

            <h2 className="section-title">Upcoming Paychecks</h2>
            <div className="paycheck-row">
              {plan.paychecks.slice(0, 8).map((p) => (
                <article className="paycheck-card" key={p.id}>
                  <div className="paycheck-head">
                    <div className="paycheck-date">{fmtDate(p.date)}</div>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Adjust this paycheck's date"
                      aria-label="Adjust this paycheck's date"
                      aria-expanded={editingPaycheckId === p.id}
                      onClick={() => setEditingPaycheckId(editingPaycheckId === p.id ? null : p.id)}
                    >
                      <Pencil size={15} />
                    </button>
                  </div>
                  {editingPaycheckId === p.id && (
                    <div className="paycheck-override">
                      {p.sources.map((s, idx) => (
                        <div key={idx} className="paycheck-override-row">
                          <span>{s.sourceName}</span>
                          <input
                            type="date"
                            defaultValue={isoDate(p.date)}
                            aria-label={`${s.sourceName} pay date`}
                            onChange={(e) => h.overridePaycheckDate(s.sourceId, s.originalDate, e.target.value)}
                          />
                          <button type="button" className="btn btn-xs btn-gray" onClick={() => h.overridePaycheckDate(s.sourceId, s.originalDate, null)}>Reset</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="paycheck-source num">
                    {p.sources.length > 1
                      ? p.sources.map((s) => `${s.sourceName} ${money(s.amount)}`).join(" + ") + ` = ${money(p.amount)}`
                      : `${p.sourceName} · ${money(p.amount)}`}
                  </div>
                  <div className="paycheck-items">
                    {p.items.length === 0 && <div className="muted small">No bills assigned this check.</div>}
                    {p.items.map((it, idx) => (
                      <button
                        type="button"
                        className={`paycheck-item ${it.settled ? "settled" : ""}`}
                        key={`${it.billId}-${idx}`}
                        disabled={it.autopay}
                        title={it.autopay ? (it.settled ? "Autopay — already debited" : "Autopay — scheduled, will debit automatically") : (it.paid ? (it.extra ? "Remove this payment" : "Mark unpaid") : "Mark paid")}
                        onClick={() => h.togglePaidFromPaycheckItem(it)}
                      >
                        <span className="paycheck-item-name">
                          {it.settled && <CheckCircle2 size={14} color="var(--green)" aria-label="Paid" />}
                          {it.paid && !it.settled && <Clock size={14} color="var(--orange)" aria-label="Scheduled" />}
                          {it.name}
                          {it.split && <span className="badge">{it.splitLabel}</span>}
                          {it.extra && <span className="badge badge-green" title="Beyond this bill's minimum">Extra</span>}
                          {it.autopay && <span className="badge badge-orange">Autopay</span>}
                        </span>
                        <span className="num">{money(it.amount)}</span>
                      </button>
                    ))}
                  </div>
                  {p.reserved > 0 && <div className="muted small paycheck-reserved">{money(p.reserved)} reserved for gas &amp; groceries</div>}
                  <div className={`paycheck-leftover ${p.remaining < 0 ? "tone-red" : "tone-green"}`}>
                    {p.remaining < 0 ? "Short " : "Left over "}
                    <span className="num">{money(Math.abs(p.remaining))}</span>
                  </div>
                </article>
              ))}
            </div>
            {plan.unscheduled.length > 0 && (
              <p className="muted small">
                Not shown above (no due date set yet): {plan.unscheduled.map((b) => b.name).join(", ")}. Add a due day to each on
                the Debts or Fixed Expenses tab to include them here.
              </p>
            )}
          </>
        )}
      </div>

      {editingSource && (
        <IncomeSourceSheet
          source={editingSource.id ? editingSource : null}
          onSave={saveSource}
          onDelete={() => h.removeIncomeSource(editingSource.id)}
          onClose={() => setEditingSource(null)}
        />
      )}
    </>
  );
}
