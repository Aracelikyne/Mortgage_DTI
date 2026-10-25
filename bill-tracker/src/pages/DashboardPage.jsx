import PageHeader from "../components/PageHeader";
import Wall from "../components/Wall";
import ThisMonthCard from "../components/ThisMonthCard";
import { money, pct } from "../utils/finance";
import { useHouseholdContext } from "../state/HouseholdContext";

function Widget({ label, value, tone, small }) {
  return (
    <div className="widget">
      <div className="widget-label">{label}</div>
      <div className={`widget-value num ${tone ? `tone-${tone}` : ""} ${small ? "small" : ""}`}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const h = useHouseholdContext();
  const dtiTone = h.dtiBand === "good" ? "green" : h.dtiBand === "over" ? "red" : "orange";
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="page-content">
        <Wall />
        <ThisMonthCard bills={h.monthlyBills} paidByMonth={h.paidByMonth} setPaidByMonth={h.setPaidByMonth} onSeeAll={() => h.setPage("monthly")} />

        <h2 className="section-title">At a Glance</h2>
        <div className="widget-grid">
          <Widget label="Total debt balance" value={money(h.totalDebtBalance)} tone="red" />
          <Widget label="Monthly debt payments" value={money(h.totalDebtMonthly)} />
          <Widget label="Current DTI" value={pct(h.dti)} tone={dtiTone} />
          <Widget label="Target debt-free" value={h.debtFreeLabel} tone="green" small />
          <Widget label={`True DTI (with ${money(h.mortgageEstimate)} mortgage)`} value={pct(h.trueDti)} tone={h.trueDti !== null && h.trueDti <= h.targetDTI ? "green" : "red"} />
          <Widget label={`Under ${h.targetDTI || 0}% DTI by`} value={h.dtiTargetLabel} tone="orange" small />
          <Widget label={`Mortgage-ready by (${h.targetDTI || 0}% with mortgage)`} value={h.dtiWithMortgageTargetLabel} tone="orange" small />
          {h.hasExcludedWithBalance && <Widget label="Totally debt-free (incl. forever loans)" value={h.fullDebtFreeLabel} small />}
          {h.availableAfterBills !== null && (
            <Widget label="Available toward debt each month" value={money(h.availableAfterBills)} tone={h.availableAfterBills < 0 ? "red" : "green"} />
          )}
        </div>

        <p className="page-footnote">
          Balances shown as "—" haven't been entered yet. Interest only accrues where you've set an APR — daily between
          the payments you log, and monthly in the payoff projection — otherwise minimum payments are treated as pure
          principal reduction. DTI reference bands (36% / 43%) are common general guidelines, not a specific lender's
          requirement — actual qualifying DTI varies by loan program and lender. This tool isn't financial or lending
          advice. Your data is saved to your account automatically as you go, and only visible when you're signed in.
        </p>
      </div>
    </>
  );
}
