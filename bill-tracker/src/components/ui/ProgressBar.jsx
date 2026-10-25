// A thin rounded progress track. `value` is 0–1.
export default function ProgressBar({ value, label, color = "var(--green)" }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
