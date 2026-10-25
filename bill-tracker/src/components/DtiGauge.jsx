import { pct } from "../utils/finance";

// A 0–100% track with the common lender bands (≤36% comfortable, ≤43% the
// usual ceiling) and a marker for where `value` falls.
export default function DtiGauge({ value, label, markerColor = "var(--label)" }) {
  return (
    <div className="gauge-wrap">
      <div className="gauge" role="img" aria-label={`${label}: ${pct(value)}`}>
        <span className="gauge-band" style={{ left: "0%", width: "36%", background: "var(--gauge-good)" }} />
        <span className="gauge-band" style={{ left: "36%", width: "7%", background: "var(--gauge-watch)" }} />
        <span className="gauge-band" style={{ left: "43%", width: "27%", background: "var(--gauge-over)" }} />
        {value !== null && <span className="gauge-marker" style={{ left: `${Math.min(100, value)}%`, background: markerColor }} />}
      </div>
      <div className="gauge-scale"><span>0%</span><span>36%</span><span>43%</span><span>70%+</span></div>
    </div>
  );
}
