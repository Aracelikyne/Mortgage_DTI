import PageHeader from "../components/PageHeader";
import Wall from "../components/Wall";
import ThisMonthCard from "../components/ThisMonthCard";
import MetricCard from "../components/MetricCard";
import { dashboardMetrics } from "../utils/metrics";
import { useHouseholdContext } from "../state/HouseholdContext";

export default function DashboardPage() {
  const h = useHouseholdContext();
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="page-content">
        <Wall />
        <ThisMonthCard bills={h.monthlyBills} paidByMonth={h.paidByMonth} setPaidByMonth={h.setPaidByMonth} onSeeAll={() => h.setPage("monthly")} />

        <h2 className="section-title">At a Glance</h2>
        <p className="section-sub">Tap any card to see exactly what it's calculating and how to change it.</p>
        <div className="widget-grid">
          {dashboardMetrics(h).map((m) => <MetricCard key={m.key} metric={m} onNavigate={h.setPage} />)}
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
