import { ChevronRight } from "lucide-react";
import ProgressBar from "./ui/ProgressBar";
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
  const countFor = { paid: summary.paidCount, pastDue: summary.pastDueCount, dueSoon: summary.dueSoonCount, upcoming: summary.upcomingCount };

  return (
    <section className="card this-month">
      <div className="card-head">
        <h2 className="card-title">This Month · {today.toLocaleDateString("en-US", { month: "long" })}</h2>
        <button type="button" className="btn-link" onClick={onSeeAll}>See All<ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <ProgressBar value={summary.owedTotal > 0 ? summary.paidAmount / summary.owedTotal : 0} label="Paid this month" />
      <div className="this-month-totals">
        <span>Paid <strong className="num">{money(summary.paidAmount)}</strong></span>
        <span>Remaining <strong className="num">{money(summary.remainingAmount)}</strong></span>
      </div>
      <div className="status-counts">
        {["paid", ...STATUS_ORDER.filter((k) => k !== "paid")].map((key) => (
          <span key={key} className={`status-count ${countFor[key] === 0 ? "zero" : ""}`}>
            <span aria-hidden="true">{STATUS_META[key].emoji}</span> <strong className="num">{countFor[key]}</strong> {STATUS_META[key].label}
          </span>
        ))}
      </div>

      <div className="next-up">
        <h3 className="next-up-title">Next Up</h3>
        {nextUp.length === 0 && <div className="muted">Nothing waiting on you right now. 🎉</div>}
        {nextUp.map((s) => (
          <div key={`${s.monthKey}-${s.billId}`} className="next-up-row">
            <span className="status-emoji" aria-hidden="true">{s.emoji}</span>
            <div className="next-up-text">
              <span className="next-up-name">{s.bill.name}</span>
              <span className="next-up-note">{s.note}</span>
            </div>
            <span className="num next-up-amount">{money(s.remaining)}</span>
            {s.autopay ? (
              <span className="badge badge-orange" title="Debits itself on its date">Autopay</span>
            ) : (
              <button
                type="button"
                className="btn btn-xs btn-tinted"
                onClick={() => setPaidByMonth((prev) => markBillPaid(prev, s.monthKey, s.bill))}
                title={`Logs ${money(s.remaining)} paid today`}
              >
                Mark paid
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
