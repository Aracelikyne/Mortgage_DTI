import { money } from "../utils/finance";

// One of the Extra money card's three answers. `lens.leftover` is whatever
// the amount couldn't be put toward — only non-zero when it's more than
// every targetable balance (after this month's minimums) combined.
export default function SuggestionLens({ title, metric, lens, hint, empty, onApply }) {
  return (
    <div className="lens-card">
      <div className="lens-title">{title}</div>
      <div className="lens-metric num">{metric}</div>
      <div className="lens-rows">
        {lens.rows.map((r) => (
          <div className="lens-row" key={r.id}>
            <span className="lens-name">{r.name}</span>
            <span className="lens-amount num">+{money(r.applied)}</span>
            <span className={`lens-result ${r.paidOff ? "paid-off" : ""}`}>
              {r.paidOff ? "paid off ✓" : `${money(r.newBalance)} left, continues next month`}
            </span>
          </div>
        ))}
      </div>
      {lens.rows.length === 0 && empty && <div className="muted">{empty}</div>}
      {lens.leftover >= 0.5 && (
        <div className="lens-leftover">{money(lens.leftover)} left over — more than every balance this can go toward.</div>
      )}
      {hint && <div className="lens-hint">{hint}</div>}
      <button type="button" className="btn btn-sm btn-tinted lens-apply" disabled={lens.rows.length === 0} onClick={onApply}>Apply this</button>
    </div>
  );
}
