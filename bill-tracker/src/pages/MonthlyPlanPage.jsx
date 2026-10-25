import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, Plus, Trash2, Zap } from "lucide-react";
import PageHeader from "../components/PageHeader";
import SegmentedControl from "../components/ui/SegmentedControl";
import Switch from "../components/ui/Switch";
import ProgressBar from "../components/ui/ProgressBar";
import { ListSection } from "../components/ui/List";
import { money, monthKeyOf, isoDate, getPaymentRecord, addPaymentRecord, removePaymentRecord, updatePaymentRecord, clearPaymentRecord, isExtraPayment } from "../utils/finance";
import { STATUS_META, STATUS_ORDER, statusesForMonth, summarizeStatuses, markBillPaid } from "../utils/billStatus";
import { useHouseholdContext } from "../state/HouseholdContext";

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
export default function MonthlyPlanPage() {
  const { monthlyBills: bills, paidByMonth, setPaidByMonth } = useHouseholdContext();
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
    <>
      <PageHeader title="Monthly Plan" />
      <div className="page-content">
        <div className="month-switcher">
          <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={22} /></button>
          <span className="month-switcher-label">{monthLabelText}</span>
          <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={22} /></button>
          {!isCurrentMonth && (
            <button type="button" className="btn btn-xs btn-tinted" onClick={() => { setViewDate(new Date()); setExpandedId(null); }}>Today</button>
          )}
        </div>

        <div className="widget-grid status-tiles">
          <div className="widget">
            <div className="widget-label">{STATUS_META.paid.emoji} Paid</div>
            <div className="widget-value num tone-green">{money(summary.paidAmount)}</div>
            <div className="widget-sub">{summary.paidCount} of {statuses.length} bill{statuses.length === 1 ? "" : "s"}</div>
          </div>
          <div className="widget">
            <div className="widget-label">Still to pay</div>
            <div className="widget-value num tone-red">{money(summary.remainingAmount)}</div>
            <div className="widget-sub">{summary.remainingCount} bill{summary.remainingCount === 1 ? "" : "s"}</div>
          </div>
          <div className="widget">
            <div className="widget-label">{STATUS_META.pastDue.emoji} Past due</div>
            <div className={`widget-value num ${summary.pastDueCount > 0 ? "tone-red" : ""}`}>{summary.pastDueCount}</div>
          </div>
          <div className="widget">
            <div className="widget-label">{STATUS_META.dueSoon.emoji} Due soon</div>
            <div className={`widget-value num ${summary.dueSoonCount > 0 ? "tone-orange" : ""}`}>{summary.dueSoonCount}</div>
            <div className="widget-sub">next 7 days</div>
          </div>
        </div>

        <ProgressBar value={summary.owedTotal > 0 ? summary.paidAmount / summary.owedTotal : 0} label={`${monthLabelText} paid`} />

        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} label="Show" className="monthly-filter" />

        {statuses.length === 0 && (
          <p className="muted center">No debts or fixed expenses yet — add some on the Debts or Fixed Expenses tabs.</p>
        )}
        {statuses.length > 0 && groups.length === 0 && (
          <p className="muted center">
            {filter === "toPay" ? `Everything's paid for ${monthLabelText}. 🎉` : `Nothing marked paid for ${monthLabelText} yet.`}
          </p>
        )}

        {groups.map((g) => (
          <ListSection
            key={g.key}
            className="status-group"
            header={`${STATUS_META[g.key].emoji} ${STATUS_META[g.key].label}`}
            headerDetail={<span className="num">{g.items.length}</span>}
          >
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
          </ListSection>
        ))}
      </div>
    </>
  );
}

function BillRow({ status: s, rec, expanded, onToggleExpand, onMarkPaid, onMarkUnpaid, onAddPayment, onRemovePayment, onUpdatePayment }) {
  const isPaid = s.status === "paid";
  // Autopay settles itself, and a $0 month has nothing to mark.
  const canToggle = !s.autopay && s.owed > 0.005;
  const extraTotal = Math.max(0, rec.amountPaid - s.owed) + rec.extraPaid;

  return (
    <div className={`row bill-row ${expanded ? "expanded" : ""} ${isPaid ? "is-paid" : ""}`}>
      <div className="bill-row-main">
        {canToggle ? (
          <button
            type="button"
            className="mark-paid"
            onClick={isPaid ? onMarkUnpaid : onMarkPaid}
            title={isPaid ? "Mark unpaid" : `Mark paid — logs ${money(s.remaining)} today`}
            aria-label={isPaid ? `Mark ${s.bill.name} unpaid` : `Mark ${s.bill.name} paid`}
          >
            {isPaid ? <CheckCircle2 size={24} className="tone-green" /> : <Circle size={24} className="mark-paid-empty" />}
          </button>
        ) : (
          <span className="mark-paid" title={s.autopay ? "Autopay — debits itself" : "Nothing due"}>
            {s.autopay ? <Zap size={20} className="tone-orange" aria-label="Autopay" /> : <CheckCircle2 size={24} className="mark-paid-empty" />}
          </span>
        )}
        <button type="button" className="bill-row-toggle" onClick={onToggleExpand} aria-expanded={expanded}>
          <span className="status-emoji" aria-hidden="true">{s.emoji}</span>
          <span className="bill-row-text">
            <span className="bill-row-name">
              {s.bill.name}
              {s.autopay && <span className="badge badge-orange">Autopay</span>}
            </span>
            <span className="bill-row-note">{s.note}</span>
          </span>
          <span className="bill-row-amount num">
            {s.partial ? <>{money(s.paidAmount)} <span className="of">of {money(s.owed)}</span></> : money(s.owed)}
            {extraTotal > 0.005 && <span className="bill-row-extra">+{money(extraTotal)} extra</span>}
          </span>
          <ChevronDown size={18} className="bill-row-chevron" aria-hidden="true" />
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
      {rec.payments.length === 0 && <div className="muted small">No payments logged this month.</div>}
      {rec.payments.map((p) => (
        <div key={p.id} className="payment-line">
          <div className="payment-line-top">
            <span className="num payment-amount">{money(p.amount)}</span>
            {isExtraPayment(p) && (
              <span className="badge badge-green" title="Logged from the Extra money card — doesn't count toward this bill's regular payment">Extra</span>
            )}
            <input
              type="date"
              value={p.date || ""}
              aria-label="Payment date"
              onChange={(e) => onUpdatePayment(p.id, { date: e.target.value || null })}
              className="payment-input"
            />
            <button type="button" className="icon-btn destructive" title="Remove this payment" aria-label="Remove this payment" onClick={() => onRemovePayment(p.id)}>
              <Trash2 size={17} />
            </button>
          </div>
          <div className="payment-line-bottom">
            <input
              value={p.bank || ""}
              onChange={(e) => onUpdatePayment(p.id, { bank: e.target.value })}
              placeholder="Bank / account"
              aria-label="Bank or account"
              className="payment-input payment-bank"
            />
            <span className="payment-cleared">
              Cleared
              <Switch checked={!!p.cleared} onChange={(on) => onUpdatePayment(p.id, { cleared: on })} label="Cleared" />
            </span>
          </div>
        </div>
      ))}
      <div className="payment-add">
        <input type="number" inputMode="decimal" placeholder="Amount" aria-label="Payment amount" value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)} className="payment-input payment-add-amount" />
        <input type="date" aria-label="Payment date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="payment-input" />
        <button type="button" className="btn btn-sm btn-tinted" onClick={submitDraft}><Plus size={16} aria-hidden="true" /> Add payment</button>
      </div>
    </div>
  );
}
