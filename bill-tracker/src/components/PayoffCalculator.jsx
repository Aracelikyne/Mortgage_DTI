import { useState } from "react";
import { ListRow, ListSection, TextField } from "./ui/List";
import { isoDate, projectPayoff } from "../utils/finance";
import { shortDate } from "../utils/format";

const cents = (n) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

// What it would take to pay a debt off completely on a chosen date: the
// payoff rolled forward through every payment by then, plus the interest
// built up since the last one. `debt` is the sheet's draft (so a changed APR
// or payoff shows up before Done); `paidByMonth` holds the logged payments.
export default function PayoffCalculator({ debt, paidByMonth }) {
  const todayIso = isoDate(new Date());
  const [onIso, setOnIso] = useState(todayIso);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(onIso);
  const p = valid ? projectPayoff(debt, paidByMonth, new Date(onIso + "T00:00:00"), new Date()) : null;
  const future = valid && onIso > todayIso;
  const apr = Number(debt.apr) || 0;

  return (
    <ListSection
      header="Payoff calculator"
      footer={p && (
        <>
          {p.beforeAsOf
            ? `That's before this payoff's as-of date (${shortDate(p.asOf)}), so it's the payoff as entered. `
            : `Counts every payment from ${shortDate(p.asOf)} through ${shortDate(p.onDate)}, each split into interest and principal, then adds interest since the last one. `}
          {future && (debt.autopay
            ? "Future autopay debits are counted on their dates."
            : p.assumedCount > 0
              ? "Regular payments not logged yet are assumed paid on their due dates."
              : "")}
          {!apr && " No APR entered, so no interest is added — this is an estimate."}
        </>
      )}
    >
      <TextField label="Payoff on" type="date" value={onIso} onChange={setOnIso} />
      {!p && <ListRow title="Enter a payoff above to calculate this" />}
      {p && (
        <>
          <ListRow title={<strong>Payoff</strong>} detail={<strong className="num tone-green">{cents(p.payoff)}</strong>} />
          <ListRow
            title="Balance after last payment"
            subtitle={p.lastPaymentDate ? `Last payment ${shortDate(p.lastPaymentDate)} · ${p.paymentsApplied} since ${shortDate(p.asOf)}` : `No payments since ${shortDate(p.asOf)}`}
            detail={<span className="num">{cents(p.balanceAfterLastPayment)}</span>}
          />
          <ListRow
            title="Interest since then"
            subtitle={`${p.daysOfInterest} day${p.daysOfInterest === 1 ? "" : "s"} at ${apr}% APR`}
            detail={<span className="num">+{cents(p.interestSinceLastPayment)}</span>}
          />
          {future && p.scheduledCount > 0 && (
            <ListRow
              title="Payments still to come"
              subtitle={`${p.scheduledCount} between now and ${shortDate(p.onDate)}, already counted above`}
              detail={<span className="num">{cents(p.scheduledTotal)}</span>}
            />
          )}
        </>
      )}
    </ListSection>
  );
}
