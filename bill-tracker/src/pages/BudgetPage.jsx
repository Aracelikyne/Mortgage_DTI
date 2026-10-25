import { useMemo, useState } from "react";
import { TrendingDown, Undo2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import DtiGauge from "../components/DtiGauge";
import SuggestionLens from "../components/SuggestionLens";
import SegmentedControl from "../components/ui/SegmentedControl";
import { ListSection, ListRow, NumberField, SwitchRow } from "../components/ui/List";
import { fmtDate, money, monthKeyOf, monthLabelFull, pct, suggestExtraAllocation } from "../utils/finance";
import { useHouseholdContext } from "../state/HouseholdContext";

const STRATEGIES = [
  { value: "tiered", label: "Your tiers" },
  { value: "snowball", label: "Snowball" },
  { value: "avalanche", label: "Avalanche" },
];
const DTI_PRESETS = [
  { value: "36", label: "36%" },
  { value: "43", label: "43%" },
  { value: "50", label: "50%" },
];

export default function BudgetPage() {
  const h = useHouseholdContext();
  const [extraAmount, setExtraAmount] = useState("");
  // Only the amount that was submitted is state — the suggestion itself is
  // derived from current data, so it never shows yesterday's numbers.
  const [submittedExtra, setSubmittedExtra] = useState(null);
  const currentMonthKey = monthKeyOf(new Date());
  const suggestion = useMemo(
    () => (submittedExtra > 0
      ? suggestExtraAllocation({
          amount: submittedExtra,
          debts: h.debtsWithRunningBalance,
          monthEntry: h.paidByMonth[currentMonthKey] || {},
          recurringExtra: Number(h.recurringExtra) || 0,
          boosts: h.boosts,
        })
      : null),
    [submittedExtra, h.debtsWithRunningBalance, h.paidByMonth, currentMonthKey, h.recurringExtra, h.boosts]
  );

  function changeExtraAmount(value) {
    setExtraAmount(value);
    setSubmittedExtra(null); // results were for the old amount
  }
  function runSuggestion() {
    const amt = Number(extraAmount);
    if (amt > 0) setSubmittedExtra(amt);
  }
  function clearSuggestion() {
    setExtraAmount("");
    setSubmittedExtra(null);
  }
  function apply(lensKey) {
    h.applyExtraPayments(suggestion?.[lensKey]?.rows);
    clearSuggestion();
  }

  const batch = h.lastExtraBatch;
  return (
    <>
      <PageHeader title="Income & Budget" />
      <div className="page-content">
        <ListSection
          header="Income"
          footer="Gross drives the DTI numbers below — that's what lenders use. Net take-home drives what's available to put toward debt, since that's what actually lands in your account."
        >
          <NumberField label="Gross monthly income" value={h.income} onChange={(v) => h.setIncome(Number(v))} />
          <NumberField label="Net take-home pay" value={h.netIncome} placeholder="after taxes" onChange={h.setNetIncome} />
          <ListRow title="Monthly debt payments" detail={<span className="num">{money(h.totalDebtMonthly)}</span>} />
          <ListRow title="Fixed expenses" detail={<span className="num">{money(h.totalFixedMonthly)}</span>} />
          {h.netIncomeNum !== null && (
            <ListRow
              title="Left after bills"
              detail={<span className={`num ${h.availableAfterBills < 0 ? "tone-red" : "tone-green"}`}>{money(h.availableAfterBills)}</span>}
            />
          )}
          <SwitchRow label={`Include current rent (${money(h.rentMonthly)}) in DTI`} checked={h.includeRent} onChange={h.setIncludeRent} />
        </ListSection>
        {h.availableAfterBills !== null && h.availableAfterBills < 0 && (
          <p className="inline-warning">You're running a monthly shortfall on paper — worth double-checking the numbers above.</p>
        )}

        <section className="card">
          <div className="gauge-head">
            <span>Today — current debts only</span>
            <strong className="num">{pct(h.dti)}</strong>
          </div>
          <DtiGauge value={h.dti} label="Your DTI" />
          {h.dti !== null && <p className="muted small">{h.dtiBandLabel} — lenders vary, and this isn't lending advice, just a general reference point.</p>}
          <div className="gauge-head" style={{ marginTop: 18 }}>
            <span>With a {money(h.mortgageEstimate)}/mo mortgage</span>
            <strong className="num">{pct(h.trueDti)}</strong>
          </div>
          <DtiGauge value={h.trueDti} label="True DTI" markerColor="var(--red)" />
          <p className="muted small">
            This is the DTI a lender actually calculates when you apply — your current debts plus the mortgage payment
            itself, since current rent goes away once you buy.
          </p>
        </section>

        <ListSection
          header="Mortgage Goal"
          footer={'36% is the conventional target; 43% is FHA / the safe ceiling; 50% takes a strong file. 43% clears FHA and most automated conventional approvals without needing strong credit/reserves to back it up. 36% is the manual-underwriting ceiling and usually unlocks the best pricing. Neither is a guarantee — your lender\'s number can land anywhere in that range depending on credit and loan program. "Mortgage-ready by" on the Dashboard uses this target plus your mortgage estimate together.'}
        >
          <NumberField label="Mortgage estimate" value={h.mortgageEstimate} onChange={h.setMortgageEstimate} />
          <NumberField label="Target DTI (%)" value={h.targetDTI} onChange={h.setTargetDTI} />
          <div className="row segmented-row">
            <SegmentedControl
              options={DTI_PRESETS}
              value={String(Number(h.targetDTI))}
              onChange={(v) => h.setTargetDTI(Number(v))}
              label="Common DTI targets"
            />
          </div>
        </ListSection>

        <h2 className="section-title">Extra Money This Month</h2>
        <section className="card extra-card">
          {h.availableAfterBills !== null && (
            <p className="muted small" style={{ marginTop: 0 }}>
              Based on your net take-home minus debt payments and fixed expenses, you have about{" "}
              <strong className="num">{money(h.availableAfterBills)}</strong> left over most months before extras or savings.
            </p>
          )}
          <div className="extra-form">
            <label className="inline-field">
              <span>Amount you have available</span>
              <input type="number" inputMode="decimal" placeholder="e.g. 500" value={extraAmount} onChange={(e) => changeExtraAmount(e.target.value)} />
            </label>
            <div className="extra-buttons">
              <button type="button" className="btn btn-filled" onClick={runSuggestion}><TrendingDown size={17} aria-hidden="true" /> Suggest allocation</button>
              {(extraAmount !== "" || suggestion) && (
                <button type="button" className="btn btn-plain" onClick={clearSuggestion}>Clear</button>
              )}
            </div>
          </div>
          <p className="muted small">
            Where this specific amount does the most good, three ways at once, using each debt's balance as of today.
            Whatever's still unpaid of this month's minimum is treated as already spoken for, so only what's owed beyond it
            counts as needing extra dollars. "Apply this" logs the money as extra payments dated today — they show on the
            Monthly Plan (where each can be deleted), the Paycheck Plan and Expenses, and never count as a bill's regular payment.
          </p>

          {batch && (
            <div className="undo-row">
              <span>
                Last applied: <strong className="num">{money(batch.total)}</strong> extra to{" "}
                {batch.items.map((it) => h.billNameById.get(it.billId) || "a removed bill").join(", ")}
                {batch.date ? ` on ${fmtDate(new Date(batch.date + "T00:00:00"))}` : ""}.
              </span>
              <button type="button" className="btn btn-sm btn-gray" onClick={() => h.undoExtraBatch(batch.batchId)}><Undo2 size={15} aria-hidden="true" /> Undo</button>
            </div>
          )}

          {suggestion && (
            <div className="lens-grid">
              <SuggestionLens
                title="Frees the most monthly payment"
                metric={`+${money(suggestion.cashFlow.freedMonthly)}/mo freed`}
                lens={suggestion.cashFlow}
                empty="Not enough to fully clear any one bill."
                onApply={() => apply("cashFlow")}
              />
              <SuggestionLens
                title="Cuts the most interest cost"
                metric="Avalanche order"
                lens={suggestion.interestCost}
                hint={h.debts.some((d) => d.apr) ? "Ranked by the APRs you've entered." : "No APRs entered yet, so this matches your tiers for now — add interest rates for this to diverge."}
                onApply={() => apply("interestCost")}
              />
              <SuggestionLens
                title="Gets you debt-free fastest"
                metric={suggestion.fastest.freedomMonth !== null ? monthLabelFull(suggestion.fastest.freedomMonth) : "480+ months out"}
                lens={suggestion.fastest}
                hint={`Wins by simulating your recurring extra forward under ${suggestion.fastest.strategyLabel}.`}
                onApply={() => apply("fastest")}
              />
            </div>
          )}
        </section>

        <ListSection
          header="Ongoing Plan"
          footer="The strategy and recurring extra drive the debt-free projection on the Payoff tab. Add one-off boosts (bonuses, tax refunds) there too."
        >
          <div className="row segmented-row">
            <SegmentedControl options={STRATEGIES} value={h.strategy} onChange={h.setStrategy} label="Payoff strategy" />
          </div>
          <NumberField label="Extra every month" value={h.recurringExtra} onChange={(v) => h.setRecurringExtra(Number(v))} />
        </ListSection>
      </div>
    </>
  );
}
