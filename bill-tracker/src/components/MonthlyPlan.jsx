import { useMemo, useState } from "react";
import { Calendar, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, Plus, Trash2, Zap } from "lucide-react";
import { money, monthKeyOf, isoDate, getPaymentRecord, addPaymentRecord, removePaymentRecord, updatePaymentRecord, clearPaymentRecord, isExtraPayment } from "../utils/finance";
import { STATUS_META, STATUS_ORDER, statusesForMonth, summarizeStatuses, markBillPaid } from "../utils/billStatus";
import SegmentedControl from "./ui/SegmentedControl";

const FILTERS = [
  { value: "toPay", label: "To pay" },
  { value: "paid", label: "Paid" },
  { value: "all", label: "All" },
];
const GROUPS_FOR = {
  toPay: ["pastDue", "dueSoon", "upcoming"],
  paid: ["paid"],
  all: STATUS_ORDER,
};

// Every debt and fixed expense for one month, grouped by where it stands —
// past due on top — with paid vs. still-to-pay totals. Tapping a row opens
// its individual payments (amount, date, cleared, bank) for editing.
export default function MonthlyPlan({ bills, paidByMonth, setPaidByMonth }) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [filter, setFilter] = useState("toPay");
  const [expandedId, setExpandedId] = useState(null);
  const monthKey = monthKeyOf(viewDate);
  const monthEntry = paidByMonth[monthKey] || {};

  const statuses = useMemo(
    () => statusesForMonth(bills, paidByMonth, viewDate.getFullYear(), viewDate.getMonth()),
    [bills, paidByMonth, viewDate]
  );
  const summary = summarizeStatuses(statuses);
  const progressPct = summary.owedTotal > 0 ? (summary.paidAmount / summary.owedTotal) * 100 : 0;
  const groups = GROUPS_FOR[filter]
    .map((key) => ({ key, items: statuses.filter((s) => s.status === key) }))
    .filter((g) => g.items.length > 0);

  function addPayment(billId, amount, date) {
    if (!(amount > 0)) return;
    setPaidByMonth((prev) => addPaymentRecord(prev, monthKey, billId, { amount, date: date || isoDate(new Date()) }));
  }

  function shiftMonth(delta) {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
    setExpandedId(null);
  }

  const monthLabelText = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const isCurrentMonth = monthKeyOf(new Date()) === monthKey;

  return (
    <div style={{ marginTop: 4 }}>
      <div className="ctc-section-head" style={{ marginTop: 18 }}>
        <div className="ctc-h2"><Calendar size={18} /> Monthly plan</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-ghost btn-sm" style={{ border: "1px solid var(--line)" }} onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={15} /></button>
          <span className="ctc-mono" style={{ minWidth: 130, textAlign: "center", fontWeight: 600 }}>{monthLabelText}</span>
          <button className="btn-ghost btn-sm" style={{ border: "1px solid var(--line)" }} onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={15} /></button>
          {!isCurrentMonth && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setViewDate(new Date()); setExpandedId(null); }}>Today</button>
          )}
        </div>
      </div>

      <div className="status-tiles">
        <div className="stat-card">
          <div className="stat-label">{STATUS_META.paid.emoji} Paid</div>
          <div className="stat-value pine">{money(summary.paidAmount)}</div>
          <div className="ctc-hint">{summary.paidCount} of {statuses.length} bill{statuses.length === 1 ? "" : "s"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Still to pay</div>
          <div className="stat-value brick">{money(summary.remainingAmount)}</div>
          <div className="ctc-hint">{summary.remainingCount} bill{summary.remainingCount === 1 ? "" : "s"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{STATUS_META.pastDue.emoji} Past due</div>
          <div className={`stat-value ${summary.pastDueCount > 0 ? "brick" : ""}`}>{summary.pastDueCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{STATUS_META.dueSoon.emoji} Due soon</div>
          <div className={`stat-value ${summary.dueSoonCount > 0 ? "brass" : ""}`}>{summary.dueSoonCount}</div>
          <div className="ctc-hint">next 7 days</div>
        </div>
      </div>

      <div className="wall-track" style={{ marginTop: 12 }} title={`${Math.round(progressPct)}% paid`}>
        <div className="wall-seg" style={{ width: `${progressPct}%`, background: "var(--pine)" }} />
      </div>

      <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} label="Show" className="monthly-filter" />

      {statuses.length === 0 && (
        <div className="card"><div className="ctc-hint">No debts or fixed expenses yet — add some from the Debts or Fixed Expenses tabs.</div></div>
      )}
      {statuses.length > 0 && groups.length === 0 && (
        <div className="card">
          <div className="ctc-hint">
            {filter === "toPay" ? `Everything's paid for ${monthLabelText}. 🎉` : `Nothing marked paid for ${monthLabelText} yet.`}
          </div>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="status-group">
          <div className="status-group-head">
            <span>{STATUS_META[g.key].emoji} {STATUS_META[g.key].label}</span>
            <span className="status-group-count">{g.items.length}</span>
          </div>
          <div className="card bill-list">
            {g.items.map((s) => (
              <BillRow
                key={s.billId}
                status={s}
                rec={getPaymentRecord(monthEntry, s.bill)}
                expanded={expandedId === s.billId}
                onToggleExpand={() => setExpandedId((id) => (id === s.billId ? null : s.billId))}
                onMarkPaid={() => setPaidByMonth((prev) => markBillPaid(prev, monthKey, s.bill))}
                onMarkUnpaid={() => setPaidByMonth((prev) => clearPaymentRecord(prev, monthKey, s.billId))}
                onAddPayment={(amount, date) => addPayment(s.billId, amount, date)}
                onRemovePayment={(paymentId) => setPaidByMonth((prev) => removePaymentRecord(prev, monthKey, s.billId, paymentId))}
                onUpdatePayment={(paymentId, patch) => setPaidByMonth((prev) => updatePaymentRecord(prev, monthKey, s.billId, paymentId, patch))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function BillRow({ status: s, rec, expanded, onToggleExpand, onMarkPaid, onMarkUnpaid, onAddPayment, onRemovePayment, onUpdatePayment }) {
  const isPaid = s.status === "paid";
  // Autopay settles itself, and a $0 month has nothing to mark.
  const canToggle = !s.autopay && s.owed > 0.005;
  const extraTotal = Math.max(0, rec.amountPaid - s.owed) + rec.extraPaid;

  return (
    <div className={`bill-row ${expanded ? "expanded" : ""} ${isPaid ? "is-paid" : ""}`}>
      <div className="bill-row-main">
        {canToggle ? (
          <button
            className="mark-paid"
            onClick={isPaid ? onMarkUnpaid : onMarkPaid}
            title={isPaid ? "Mark unpaid" : `Mark paid — logs ${money(s.remaining)} today`}
            aria-label={isPaid ? `Mark ${s.bill.name} unpaid` : `Mark ${s.bill.name} paid`}
          >
            {isPaid ? <CheckCircle2 size={22} color="var(--pine-deep)" /> : <Circle size={22} color="var(--line)" />}
          </button>
        ) : (
          <span className="mark-paid" title={s.autopay ? "Autopay — debits itself" : "Nothing due"}>
            {s.autopay ? <Zap size={18} color="var(--brass-deep)" /> : <CheckCircle2 size={22} color="var(--line)" />}
          </span>
        )}
        <button className="bill-row-toggle" onClick={onToggleExpand} aria-expanded={expanded}>
          <span className="bill-row-emoji" aria-hidden="true">{s.emoji}</span>
          <span className="bill-row-text">
            <span className="bill-row-name">
              {s.bill.name}
              {s.autopay && <span className="split-badge">Autopay</span>}
            </span>
            <span className="bill-row-note">{s.label} · {s.note}</span>
          </span>
          <span className="bill-row-amount ctc-mono">
            {s.partial ? <>{money(s.paidAmount)} <span className="of">of {money(s.owed)}</span></> : money(s.owed)}
            {extraTotal > 0.005 && <span className="bill-row-extra">+{money(extraTotal)} extra</span>}
          </span>
          <ChevronDown size={16} className="bill-row-chevron" />
        </button>
      </div>
      {expanded && (
        <PaymentDetails rec={rec} onAddPayment={onAddPayment} onRemovePayment={onRemovePayment} onUpdatePayment={onUpdatePayment} />
      )}
    </div>
  );
}

// The bill's individual payments for the month — each with its own date,
// cleared flag and bank — plus a form to log another.
function PaymentDetails({ rec, onAddPayment, onRemovePayment, onUpdatePayment }) {
  const [draftAmount, setDraftAmount] = useState("");
  const [draftDate, setDraftDate] = useState(() => isoDate(new Date()));

  function submitDraft() {
    const amt = Number(draftAmount);
    if (amt > 0) {
      onAddPayment(amt, draftDate);
      setDraftAmount("");
    }
  }

  return (
    <div className="payment-details">
      {rec.payments.length === 0 && <div className="ctc-hint">No payments logged this month.</div>}
      {rec.payments.map((p) => (
        <div key={p.id} className="payment-line">
          <span className="ctc-mono" style={{ fontWeight: 600, minWidth: 55 }}>{money(p.amount)}</span>
          {isExtraPayment(p) && (
            <span className="split-badge" title="Logged from the Extra money card — doesn't count toward this bill's regular payment">Extra</span>
          )}
          <input
            type="date"
            value={p.date || ""}
            aria-label="Payment date"
            onChange={(e) => onUpdatePayment(p.id, { date: e.target.value || null })}
            className="payment-input"
          />
          <label className="payment-cleared">
            <input type="checkbox" checked={!!p.cleared} onChange={(e) => onUpdatePayment(p.id, { cleared: e.target.checked })} />
            Cleared
          </label>
          <input
            value={p.bank || ""}
            onChange={(e) => onUpdatePayment(p.id, { bank: e.target.value })}
            placeholder="Bank/account"
            aria-label="Bank or account"
            className="payment-input payment-bank"
          />
          <button className="btn-ghost btn-sm" style={{ border: "none", padding: 2 }} title="Remove this payment" onClick={() => onRemovePayment(p.id)}>
            <Trash2 size={13} color="#A5473A" />
          </button>
        </div>
      ))}
      <div className="payment-line payment-add">
        <input type="number" placeholder="Amount" aria-label="Payment amount" value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)} className="payment-input" style={{ width: 90 }} />
        <input type="date" aria-label="Payment date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="payment-input" />
        <button className="btn btn-ghost btn-sm" onClick={submitDraft}><Plus size={13} /> Add payment</button>
      </div>
    </div>
  );
}
