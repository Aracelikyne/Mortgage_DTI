import { useState } from "react";
import Sheet, { SheetAction } from "./ui/Sheet";
import AutopayFields from "./AutopayFields";
import { autopayDraft, autopayIncomplete, autopayPatch } from "../utils/autopay";
import { ListSection, NumberField, SelectField, SwitchRow, TextField } from "./ui/List";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS } from "../data/constants";
import { BALANCE_ANCHOR_DATE, fmtDate, money } from "../utils/finance";
import { asInput, fromInput } from "../utils/format";

function categoryValueOf(d) {
  return d.protected ? "protected" : String(d.priority ?? 2);
}

// Add or edit one debt — everything the old spreadsheet row held, as an iOS
// form. Changes apply on Done, as one edit (and one activity-log entry),
// not a save per keystroke. `runningBalance` is where the balance actually
// stands today once payments since the anchor date are counted.
export default function DebtEditorSheet({ debt, runningBalance, growing, onSave, onArchive, onClose, categoryPatch }) {
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
    ...autopayDraft(debt),
  }));
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  // Moving a debt into or out of "forever loan" also flips whether it counts
  // toward the goal, same as the old category dropdown did — the switch
  // below can still override it.
  const setCategory = (v) => setDraft((d) => ({ ...d, category: v, inGoal: v !== "protected" }));

  const valid = draft.name.trim() !== "" && (!isNew || draft.monthly !== "") && !autopayIncomplete(draft);

  function save() {
    onSave({
      name: draft.name.trim(),
      type: draft.type,
      monthly: fromInput(draft.monthly, 0),
      balance: fromInput(draft.balance),
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

  return (
    <Sheet title={isNew ? "New Debt" : "Edit Debt"} onClose={onClose} onDone={save} doneLabel={isNew ? "Add" : "Done"} doneDisabled={!valid}>
      <>
        <ListSection>
          <TextField label="Name" value={draft.name} onChange={set("name")} placeholder="e.g. Amex" autoFocus={isNew} />
          <SelectField label="Type" value={draft.type} onChange={set("type")} options={CATEGORY_OPTIONS} />
          <SelectField label="Payoff category" value={draft.category} onChange={setCategory} options={PRIORITY_OPTIONS} />
        </ListSection>

        <ListSection
          footer={(
            <>
              The balance is what you owed as of {fmtDate(new Date(BALANCE_ANCHOR_DATE + "T00:00:00"))}; every payment logged
              since then is applied on top of it.
              {showRunning && (
                <span className={growing ? "tone-red" : "tone-green"}>
                  {" "}{growing ? "Growing — " : "Now "}{money(runningBalance)} after payments{growing ? " (payments aren't covering the interest)" : ""}.
                </span>
              )}
            </>
          )}
        >
          <NumberField label="Monthly payment" value={draft.monthly} onChange={set("monthly")} placeholder="required" />
          <NumberField label="Balance" value={draft.balance} onChange={set("balance")} placeholder={draft.category === "protected" ? "unknown" : "0"} />
          <NumberField label="APR %" value={draft.apr} onChange={set("apr")} placeholder="optional" />
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
