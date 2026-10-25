import { useState } from "react";
import Sheet, { SheetAction } from "./ui/Sheet";
import AutopayFields from "./AutopayFields";
import { ListSection, NumberField, SelectField, SwitchRow, TextField } from "./ui/List";
import { FIXED_CATEGORY_OPTIONS } from "../data/constants";
import { autopayDraft, autopayIncomplete, autopayPatch } from "../utils/autopay";
import { asInput, fromInput } from "../utils/format";

// Add or edit one fixed expense (rent, utilities…). Applies on Done.
export default function FixedEditorSheet({ item, onSave, onDelete, onClose }) {
  const isNew = !item;
  const [draft, setDraft] = useState(() => ({
    name: item?.name || "",
    type: item?.type || "Utility",
    monthly: asInput(item?.monthly),
    dueDay: asInput(item?.dueDay),
    graceDays: asInput(item?.graceDays ?? 0),
    note: item?.note || "",
    splitFriendly: !!item?.splitFriendly,
    ...autopayDraft(item),
  }));
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const valid = draft.name.trim() !== "" && (!isNew || draft.monthly !== "") && !autopayIncomplete(draft);

  function save() {
    onSave({
      name: draft.name.trim(),
      type: draft.type,
      monthly: fromInput(draft.monthly, 0),
      dueDay: fromInput(draft.dueDay),
      graceDays: fromInput(draft.graceDays, 0),
      note: draft.note,
      splitFriendly: draft.splitFriendly,
      ...autopayPatch(draft),
    });
  }

  return (
    <Sheet title={isNew ? "New Expense" : "Edit Expense"} onClose={onClose} onDone={save} doneLabel={isNew ? "Add" : "Done"} doneDisabled={!valid}>
      <>
        <ListSection>
          <TextField label="Name" value={draft.name} onChange={set("name")} placeholder="e.g. Power" autoFocus={isNew} />
          <SelectField label="Type" value={draft.type} onChange={set("type")} options={FIXED_CATEGORY_OPTIONS} />
          <NumberField label="Monthly amount" value={draft.monthly} onChange={set("monthly")} placeholder="required" />
          <NumberField label="Due day of month" value={draft.dueDay} onChange={set("dueDay")} placeholder="optional" min="1" max="31" step="1" />
          <NumberField label="Grace period (days)" value={draft.graceDays} onChange={set("graceDays")} placeholder="0" min="0" step="1" />
          <TextField label="Note" value={draft.note} onChange={set("note")} placeholder="optional" />
        </ListSection>
        <ListSection footer="Split-friendly bills can be divided across a month's paychecks with no real downside.">
          <SwitchRow label="OK to split across paychecks" checked={draft.splitFriendly} onChange={set("splitFriendly")} />
        </ListSection>
        <AutopayFields draft={draft} set={set} monthly={draft.monthly} />
        {!isNew && (
          <ListSection>
            <SheetAction destructive onClick={() => onDelete()}>Delete Expense</SheetAction>
          </ListSection>
        )}
      </>
    </Sheet>
  );
}
