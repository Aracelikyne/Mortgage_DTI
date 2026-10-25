import { useState } from "react";
import Sheet, { SheetAction } from "./ui/Sheet";
import SegmentedControl from "./ui/SegmentedControl";
import { ListSection, NumberField, TextField } from "./ui/List";

const FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

// Add or edit one paycheck source. Every occurrence after "next pay date"
// is calculated from the frequency.
export default function IncomeSourceSheet({ source, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(() => ({ name: "", amount: "", nextPayDate: "", frequency: "biweekly", ...source }));
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const isNew = !source?.id;

  return (
    <Sheet
      title={isNew ? "New Paycheck" : "Paycheck"}
      onClose={onClose}
      doneLabel={isNew ? "Add" : "Done"}
      doneDisabled={!draft.name.trim()}
      onDone={() => onSave({ ...draft, name: draft.name.trim() })}
    >
      <>
        <ListSection footer="Enter the next date this paycheck lands — every one after it is worked out from the frequency. A one-off shift (a holiday moving payday) can be set on that paycheck's card instead.">
          <TextField label="Name" value={draft.name} onChange={set("name")} placeholder="Your paycheck" autoFocus={isNew} />
          <NumberField label="Amount per check" value={draft.amount} onChange={set("amount")} placeholder="e.g. 2100" />
          <TextField label="Next pay date" type="date" value={draft.nextPayDate} onChange={set("nextPayDate")} />
          <div className="row segmented-row">
            <SegmentedControl options={FREQUENCIES} value={draft.frequency || "biweekly"} onChange={set("frequency")} label="How often" />
          </div>
        </ListSection>
        {!isNew && (
          <ListSection>
            <SheetAction destructive onClick={() => onDelete()}>Delete Paycheck</SheetAction>
          </ListSection>
        )}
      </>
    </Sheet>
  );
}
