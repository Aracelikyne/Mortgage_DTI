import { ChevronRight } from "lucide-react";
import { money } from "../utils/finance";
import { STATUS_META, STATUS_ORDER, statusesForMonth, summarizeStatuses, nextUpBills, markBillPaid } from "../utils/billStatus";

// The Dashboard's at-a-glance version of the Monthly Plan: how much of this
// month is paid, a count per status, and the handful of bills that need
// attention next — each one a tap away from being marked paid.
export default function ThisMonthCard({ bills, paidByMonth, setPaidByMonth, onSeeAll }) {
  const today = new Date();
  const statuses = statusesForMonth(bills, paidByMonth, today.getFullYear(), today.getMonth(), today);
  const summary = summarizeStatuses(statuses);
  const nextUp = nextUpBills(bills, paidByMonth, today);
  const pct = summary.owedTotal > 0 ? (summary.paidAmount / summary.owedTotal) * 100 : 0;
  const countFor = { paid: summary.paidCount, pastDue: summary.pastDueCount, dueSoon: summary.dueSoonCount, upcoming: summary.upcomingCount };

  return (
    <div className="card this-month">
      <div className="wall-head">
        <span className="wall-title">This month · {today.toLocaleDateString("en-US", { month: "long" })}</span>
        <button className="link-button" onClick={onSeeAll}>See all <ChevronRight size={14} /></button>
      </div>
      <div className="wall-track" title={`${Math.round(pct)}% paid`}>
        <div className="wall-seg" style={{ width: `${pct}%`, background: "var(--pine)" }} />
      </div>
      <div className="this-month-totals">
        <span>Paid <strong className="ctc-mono">{money(summary.paidAmount)}</strong></span>
        <span>Remaining <strong className="ctc-mono">{money(summary.remainingAmount)}</strong></span>
      </div>
      <div className="status-counts">
        {["paid", ...STATUS_ORDER.filter((k) => k !== "paid")].map((key) => (
          <span key={key} className={`status-count ${countFor[key] === 0 ? "zero" : ""}`}>
            {STATUS_META[key].emoji} <strong>{countFor[key]}</strong> {STATUS_META[key].label}
          </span>
        ))}
      </div>

      <div className="next-up">
        <div className="next-up-title">Next up</div>
        {nextUp.length === 0 && <div className="ctc-hint">Nothing waiting on you right now. 🎉</div>}
        {nextUp.map((s) => (
          <div key={`${s.monthKey}-${s.billId}`} className="next-up-row">
            <span className="bill-row-emoji" aria-hidden="true">{s.emoji}</span>
            <div className="bill-row-text">
              <span className="bill-row-name">{s.bill.name}</span>
              <span className="bill-row-note">{s.note}</span>
            </div>
            <span className="ctc-mono next-up-amount">{money(s.remaining)}</span>
            {s.autopay ? (
              <span className="split-badge" title="Debits itself on its date">Autopay</span>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPaidByMonth((prev) => markBillPaid(prev, s.monthKey, s.bill))}
                title={`Logs ${money(s.remaining)} paid today`}
              >
                Mark paid
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
