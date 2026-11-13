import { useState } from "react";
import Sheet, { SheetAction } from "./ui/Sheet";
import AutopayFields, { PaymentScheduleFields } from "./AutopayFields";
import ReviewSection from "./ReviewSection";
import PayoffCalculator from "./PayoffCalculator";
import { autopayDraft, autopayIncomplete, autopayPatch, monthlyFromDraft } from "../utils/autopay";
import { ListRow, ListSection, NumberField, SelectField, SwitchRow, TextField } from "./ui/List";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS } from "../data/constants";
import { balanceAnchorOf, isoDate, money, projectPayoff } from "../utils/finance";
import { needsInfo } from "../utils/statementSync";
import { asInput, fromInput, shortDate } from "../utils/format";

function categoryValueOf(d) {
  return d.protected ? "protected" : String(d.priority ?? 2);
}

// Add or edit one debt — everything the old spreadsheet row held, as an iOS
// form. Changes apply on Done, as one edit (and one activity-log entry),
// not a save per keystroke. "Payoff today" is worked out live from the
// draft — the entered payoff rolled forward through every payment since its
// as-of date, plus interest since the last one — and is the same figure the
// rest of the app uses. Changing the payoff restamps it as updated today by
// `userName`, so only payments after today come off the new figure.
export default function DebtEditorSheet({ debt, growing, paidByMonth, userName, onSave, onArchive, onClose, categoryPatch }) {
  const isNew = !debt;
  const [showCalculator, setShowCalculator] = useState(false);
  const [draft, setDraft] = useState(() => ({
    name: debt?.name || "",
    type: debt?.type || "Credit Card",
    category: debt ? categoryValueOf(debt) : "2",
    monthly: asInput(debt?.monthly),
    balance: asInput(debt?.balance),
    apr: asInput(debt?.apr),
    dueDay: asInput(debt?.dueDay),
    graceDays: asInput(debt?.graceDays ?? 0),
    inGoal: debt ? !debt.excludeFromGoal : true,
    splitFriendly: !!debt?.splitFriendly,
    review: debt?.review || {},
    ...autopayDraft(debt),
  }));
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  // Moving a debt into or out of "forever loan" also flips whether it counts
  // toward the goal, same as the old category dropdown did — the switch
  // below can still override it.
  const setCategory = (v) => setDraft((d) => ({ ...d, category: v, inGoal: v !== "protected" }));

  // A payoff over $10 million is a typo, not a debt — saving one used to throw
  // the debt wall's "paid off already" into the billions.
  const payoffTooBig = Number(draft.balance) > 10_000_000;
  const valid = draft.name.trim() !== "" && (!isNew || draft.monthly !== "" || draft.twiceMonthly) && !autopayIncomplete(draft) && !payoffTooBig;

  const draftBalance = fromInput(draft.balance);
  const payoffChanged = isNew || String(draftBalance ?? "") !== String(debt.balance ?? "");
  const draftAsOf = payoffChanged ? isoDate(new Date()) : balanceAnchorOf(debt);
  // The debt as it would be saved, for the live payoff and the calculator.
  const liveDebt = {
    ...(debt || {}),
    id: debt?.id ?? "new",
    balance: draftBalance,
    balanceAsOf: draftAsOf,
    apr: fromInput(draft.apr),
    monthly: monthlyFromDraft(draft),
    dueDay: fromInput(draft.dueDay),
    ...autopayPatch(draft),
  };
  const payoffToday = projectPayoff(liveDebt, paidByMonth || {}, new Date(), new Date());

  function save() {
    const balance = draftBalance;
    onSave({
      name: draft.name.trim(),
      type: draft.type,
      monthly: monthlyFromDraft(draft),
      balance,
      ...(payoffChanged ? { balanceAsOf: isoDate(new Date()), balanceUpdatedAt: isoDate(new Date()), balanceUpdatedBy: userName } : {}),
      review: draft.review,
      apr: fromInput(draft.apr),
      dueDay: fromInput(draft.dueDay),
      graceDays: fromInput(draft.graceDays, 0),
      ...categoryPatch(draft.category),
      excludeFromGoal: !draft.inGoal,
      splitFriendly: draft.splitFriendly,
      ...autopayPatch(draft),
    });
  }

  const missing = needsInfo({ balance: fromInput(draft.balance), apr: fromInput(draft.apr) });

  return (
    <Sheet title={isNew ? "New Debt" : "Edit Debt"} onClose={onClose} onDone={save} doneLabel={isNew ? "Add" : "Done"} doneDisabled={!valid}>
      <>
        <ReviewSection draft={draft} setDraft={setDraft} />
        <ListSection>
          <TextField label="Name" value={draft.name} onChange={set("name")} placeholder="e.g. Amex" autoFocus={isNew} />
          <SelectField label="Type" value={draft.type} onChange={set("type")} options={CATEGORY_OPTIONS} />
          <SelectField label="Payoff category" value={draft.category} onChange={setCategory} options={PRIORITY_OPTIONS} />
        </ListSection>

        <ListSection
          footer={(
            <>
              {isNew
                ? "The payoff is what you owe today; every payment logged after today comes off it, interest included."
                : <>Payoff last updated {shortDate(debt.balanceUpdatedAt || balanceAnchorOf(debt))}{debt.balanceUpdatedBy ? ` by ${debt.balanceUpdatedBy}` : ""}. It includes payments through {shortDate(balanceAnchorOf(debt))}; payments after that come off automatically, interest included.</>}
              {payoffToday && payoffToday.paymentsApplied > 0 && <> Payoff today counts {payoffToday.paymentsApplied} payment{payoffToday.paymentsApplied === 1 ? "" : "s"} since then. It's what Extra money uses to pay a debt off completely.</>}
              {growing && <span className="tone-red"> Growing — payments aren't covering the interest.</span>}
              {missing.length > 0 && <span className="tone-red"> Needs info: {missing.join(" and ")}.</span>}
              {payoffTooBig && <span className="tone-red"> A payoff over $10 million looks like a typo — check the number.</span>}
            </>
          )}
        >
          <PaymentScheduleFields draft={draft} set={set} setDraft={setDraft} />
          <NumberField label={`Payoff as of ${shortDate(draftAsOf)}`} value={draft.balance} onChange={set("balance")} placeholder="Needs info" />
          <NumberField label="APR %" value={draft.apr} onChange={set("apr")} placeholder="Needs info" />
          <NumberField label="Grace period (days)" value={draft.graceDays} onChange={set("graceDays")} placeholder="0" min="0" step="1" />
          {payoffToday && (
            <ListRow
              title="Payoff today"
              subtitle={payoffToday.interestSinceLastPayment >= 0.5 ? `Includes ${money(payoffToday.interestSinceLastPayment)} interest since ${payoffToday.lastPaymentDate ? "the last payment" : shortDate(payoffToday.asOf)}` : undefined}
              detail={<span className={`num ${growing ? "tone-red" : "tone-green"}`}>{money(payoffToday.payoff)}</span>}
            />
          )}
          <ListRow
            title="Payoff calculator"
            className="tone-link"
            accessory="chevron"
            aria-expanded={showCalculator}
            onClick={() => setShowCalculator((v) => !v)}
          />
        </ListSection>
        {showCalculator && <PayoffCalculator debt={liveDebt} paidByMonth={paidByMonth || {}} />}

        <ListSection footer="Counting toward the goal includes it in the debt-free date. Split-friendly bills can be divided across a month's paychecks with no real downside.">
          <SwitchRow label="Count toward debt-free goal" checked={draft.inGoal} onChange={set("inGoal")} />
          <SwitchRow label="OK to split across paychecks" checked={draft.splitFriendly} onChange={set("splitFriendly")} />
        </ListSection>

        <AutopayFields draft={draft} set={set} />

        {!isNew && (
          <ListSection footer="Moves it to the Paid Off list — nothing's erased, and it can be restored from there.">
            <SheetAction destructive onClick={() => onArchive()}>Mark Paid Off</SheetAction>
          </ListSection>
        )}
      </>
    </Sheet>
  );
}
