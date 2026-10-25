import { KeyRound } from "lucide-react";
import { TIERS } from "../data/constants";
import { money } from "../utils/finance";
import { useHouseholdContext } from "../state/HouseholdContext";

// The signature view: every debt as one bar, colored by payoff tier, with
// the part already paid down left open at the end.
export default function Wall() {
  const { sim, debtFreeLabel, tierGroups, runningBalanceOf, wallBaseline, protectedBalance, paidDownSoFar, totalDebtBalance } = useHouseholdContext();
  const width = (amount) => `${wallBaseline > 0 ? (amount / wallBaseline) * 100 : 0}%`;
  return (
    <section className="card wall-card">
      <div className="card-head">
        <div>
          <h2 className="card-title">The wall between you and the front door</h2>
          <div className="card-subtitle num">{money(totalDebtBalance)} remaining</div>
        </div>
        {sim.freedomMonth !== null ? (
          <span className="chip chip-green"><KeyRound size={13} aria-hidden="true" /> Debt-free {debtFreeLabel}</span>
        ) : (
          <span className="chip">Add extra payments on Payoff to see a debt-free date</span>
        )}
      </div>
      <div className="wall" role="img" aria-label={`${money(totalDebtBalance)} of debt remaining, ${money(paidDownSoFar)} paid off`}>
        {tierGroups.map(({ tier, items }) => {
          const balance = items.reduce((s, d) => s + runningBalanceOf(d), 0);
          return <div key={tier} className="wall-seg" style={{ width: width(balance), background: TIERS[tier].color }} title={`${TIERS[tier].label}: ${money(balance)}`} />;
        })}
        {protectedBalance > 0 && (
          <div className="wall-seg" style={{ width: width(protectedBalance), background: "var(--tier-protected)" }} title={`Protected (minimum-only): ${money(protectedBalance)}`} />
        )}
      </div>
      <div className="legend">
        {Object.entries(TIERS).map(([t, v]) => (
          <span key={t}><span className="swatch" style={{ background: v.color }} />{v.label}</span>
        ))}
        {protectedBalance > 0 && (
          <span><span className="swatch" style={{ background: "var(--tier-protected)" }} />Protected ({money(protectedBalance)})</span>
        )}
        {paidDownSoFar > 0 && (
          <span><span className="swatch swatch-empty" />Paid off already ({money(paidDownSoFar)})</span>
        )}
      </div>
    </section>
  );
}
