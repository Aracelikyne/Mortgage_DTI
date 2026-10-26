import { useState } from "react";
import Sheet, { SheetAction } from "./ui/Sheet";
import AutopayFields from "./AutopayFields";
import ReviewSection from "./ReviewSection";
import { autopayDraft, autopayIncomplete, autopayPatch } from "../utils/autopay";
import { ListSection, NumberField, SelectField, SwitchRow, TextField } from "./ui/List";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS } from "../data/constants";
import { balanceAnchorOf, isoDate, money } from "../utils/finance";
import { needsInfo } from "../utils/statementSync";
import { asInput, fromInput, shortDate } from "../utils/format";

function categoryValueOf(d) {
  return d.protected ? "protected" : String(d.priority ?? 2);
}

// Add or edit one debt — everything the old spreadsheet row held, as an iOS
// form. Changes apply on Done, as one edit (and one activity-log entry),
// not a save per keystroke. `runningBalance` is where the balance actually
// stands today once payments since the payoff's as-of date are counted.
// Changing the payoff restamps it as updated today by `userName`, so only
// payments after today come off the new figure.
export default function DebtEditorSheet({ debt, runningBalance, paymentsApplied = 0, growing, userName, onSave, onArchive, onClose, categoryPatch }) {
  const isNew = !debt;
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

  const valid = draft.name.trim() !== "" && (!isNew || draft.monthly !== "") && !autopayIncomplete(draft);

  function save() {
    const balance = fromInput(draft.balance);
    const payoffChanged = isNew || String(balance ?? "") !== String(debt.balance ?? "");
    onSave({
      name: draft.name.trim(),
      type: draft.type,
      monthly: fromInput(draft.monthly, 0),
      balance,
      ...(payoffChanged ? { balanceAsOf: isoDate(new Date()), balanceUpdatedBy: userName } : {}),
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

  const showRunning = !isNew && runningBalance !== null && runningBalance !== undefined
    && (Math.abs(runningBalance - Number(debt.balance || 0)) >= 0.5 || growing);
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
                : <>Payoff last updated {shortDate(balanceAnchorOf(debt))}{debt.balanceUpdatedBy ? ` by ${debt.balanceUpdatedBy}` : ""}. Payments logged after that date come off it automatically, interest included.</>}
              {showRunning && (
                <span className={growing ? "tone-red" : "tone-green"}>
                  {" "}{growing ? "Growing — " : "Now "}{money(runningBalance)} after {paymentsApplied} payment{paymentsApplied === 1 ? "" : "s"}{growing ? " (payments aren't covering the interest)" : ""}.
                </span>
              )}
              {missing.length > 0 && <span className="tone-red"> Needs info: {missing.join(" and ")}.</span>}
            </>
          )}
        >
          <NumberField label="Monthly payment" value={draft.monthly} onChange={set("monthly")} placeholder="required" />
          <NumberField label="Payoff" value={draft.balance} onChange={set("balance")} placeholder="Needs info" />
          <NumberField label="APR %" value={draft.apr} onChange={set("apr")} placeholder="Needs info" />
          <NumberField label="Due day of month" value={draft.dueDay} onChange={set("dueDay")} placeholder="optional" min="1" max="31" step="1" />
          <NumberField label="Grace period (days)" value={draft.graceDays} onChange={set("graceDays")} placeholder="0" min="0" step="1" />
        </ListSection>

        <ListSection footer="Counting toward the goal includes it in the debt-free date. Split-friendly bills can be divided across a month's paychecks with no real downside.">
          <SwitchRow label="Count toward debt-free goal" checked={draft.inGoal} onChange={set("inGoal")} />
          <SwitchRow label="OK to split across paychecks" checked={draft.splitFriendly} onChange={set("splitFriendly")} />
        </ListSection>

        <AutopayFields draft={draft} set={set} monthly={draft.monthly} />

        {!isNew && (
          <ListSection footer="Moves it to the Paid Off list — nothing's erased, and it can be restored from there.">
            <SheetAction destructive onClick={() => onArchive()}>Mark Paid Off</SheetAction>
          </ListSection>
        )}
      </>
    </Sheet>
  );
}
