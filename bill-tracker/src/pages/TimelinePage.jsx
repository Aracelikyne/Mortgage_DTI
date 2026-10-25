import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PageHeader from "../components/PageHeader";
import Banner from "../components/ui/Banner";
import { ListSection } from "../components/ui/List";
import { money, monthLabel } from "../utils/finance";
import { useHouseholdContext } from "../state/HouseholdContext";

const AXIS_TICK = { fontSize: 11, fill: "var(--label-2)", fontFamily: "var(--font)" };

export default function TimelinePage() {
  const h = useHouseholdContext();
  const { sim } = h;
  const under = sim.underwaterDebts || [];
  const growing = sim.stillGrowingDebts || [];

  return (
    <>
      <PageHeader
        title="Payoff Timeline"
        actions={<button type="button" className="nav-btn" onClick={h.addBoost} aria-label="Add one-time boost" title="Add one-time boost"><Plus size={24} /></button>}
      />
      <div className="page-content">
        {under.length > 0 && (
          <Banner tone="warning" icon={<TriangleAlert size={18} />}>
            <strong>Heads up:</strong> {under.join(", ")} {under.length > 1 ? "have" : "has"} a minimum payment that doesn't
            cover its own interest, and never gets extra payments — either it's marked "minimum only, forever," or it's
            not counted toward the goal. At current terms {under.length > 1 ? "these will" : "this will"} never pay down —
            its balance is held flat in this projection rather than shown compounding forever. Raise the minimum,
            double-check the APR, or reconsider the goal setting, on the Debts tab.
          </Banner>
        )}
        {growing.length > 0 && (
          <Banner tone="warning" icon={<TriangleAlert size={18} />}>
            <strong>Heads up:</strong> {growing.join(", ")} {growing.length > 1 ? "are" : "is"} still growing at the end of
            this projection — {growing.length > 1 ? "they're" : "it's"} eligible for extra payments, but{" "}
            {growing.length > 1 ? "sit" : "sits"} far enough behind other debts in the payoff order that{" "}
            {growing.length > 1 ? "they never get" : "it never gets"} any within this window, so interest keeps outpacing the
            minimum the whole time. Move it to a higher-priority tier, raise its minimum, or increase your extra payment.
          </Banner>
        )}

        <section className="card chart-card">
          <div className="card-head">
            <h2 className="card-title">Total debt over time</h2>
            {sim.freedomMonth !== null && <span className="chip chip-green">Debt-free {h.debtFreeLabel}</span>}
          </div>
          <div className="chart" style={{ height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={h.chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--separator)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} stroke="var(--separator)" tickLine={false} />
                <YAxis tick={AXIS_TICK} stroke="var(--separator)" tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip
                  formatter={(v) => money(v)}
                  contentStyle={{ fontFamily: "var(--font)", fontSize: 13, borderRadius: 10, border: "none", background: "var(--grouped-bg-2)", color: "var(--label)", boxShadow: "0 4px 16px rgba(0,0,0,.15)" }}
                />
                {sim.freedomMonth !== null && (
                  <ReferenceLine x={monthLabel(sim.freedomMonth)} stroke="var(--green)" strokeDasharray="4 4" label={{ value: "Debt-free", fontSize: 11, fill: "var(--green)" }} />
                )}
                <Line type="monotone" dataKey="total" stroke="var(--red)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <ListSection
          header="One-Time Boosts"
          footer="Bonuses, tax refunds, anything extra in a specific month. These go toward debt on top of your recurring extra (set on Income & Budget)."
        >
          {h.boosts.length === 0 && <div className="row muted">No boosts yet — tap + to add one.</div>}
          {h.boosts.map((b) => (
            <div key={b.id} className="row boost-row">
              <label className="inline-field">
                <span>Months from now</span>
                <input type="number" inputMode="numeric" min="1" value={b.month} onChange={(e) => h.updateBoost(b.id, { month: Number(e.target.value) })} />
              </label>
              <label className="inline-field">
                <span>Amount</span>
                <input type="number" inputMode="decimal" value={b.amount} onChange={(e) => h.updateBoost(b.id, { amount: Number(e.target.value) })} />
              </label>
              <button type="button" className="icon-btn destructive" onClick={() => h.removeBoost(b.id)} aria-label="Remove boost" title="Remove boost">
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </ListSection>
      </div>
    </>
  );
}
