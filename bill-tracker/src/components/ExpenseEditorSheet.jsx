import { useState } from "react";
import { Camera, Image as ImageIcon } from "lucide-react";
import Sheet, { SheetAction } from "./ui/Sheet";
import { ListButton, ListSection, NumberField, SelectField, TextField } from "./ui/List";
import { EXPENSE_CATEGORIES } from "../data/constants";
import { isoDate } from "../utils/finance";

// Log a new expense or edit one, with an optional receipt photo (camera or
// library on phones). `onSave(form, receiptFile)` throws if the save fails.
export default function ExpenseEditorSheet({ expense, onSave, onDelete, onViewReceipt, onClose }) {
  const [form, setForm] = useState({
    amount: expense?.amount ?? "",
    category: expense?.category || EXPENSE_CATEGORIES[0],
    date: expense?.date || isoDate(new Date()),
    note: expense?.note || "",
  });
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  function pickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
  }

  return (
    <Sheet
      title={expense ? "Edit Expense" : "Log Expense"}
      onClose={onClose}
      doneLabel={saving ? "Saving…" : expense ? "Save" : "Log"}
      doneDisabled={saving || !form.amount || !form.category || !form.date}
      onDone={() => {
        // Saving is async: keep the sheet open until it lands, then close it
        // from here — or show the error and stay put.
        setSaving(true);
        setError(null);
        onSave(form, receiptFile).then(
          () => onClose(),
          (err) => {
            console.error(err);
            setError("Couldn't save — check your connection and try again.");
            setSaving(false);
          }
        );
        return false;
      }}
    >
      <>
        <ListSection>
          <NumberField label="Amount" value={form.amount} onChange={set("amount")} placeholder="0.00" />
          <SelectField label="Category" value={form.category} onChange={set("category")} options={EXPENSE_CATEGORIES} />
          <TextField label="Date" type="date" value={form.date} onChange={set("date")} />
          <TextField label="Merchant / note" value={form.note} onChange={set("note")} placeholder="optional" />
        </ListSection>

        <ListSection header="Receipt">
          {receiptPreview && <img className="receipt-preview" src={receiptPreview} alt="New receipt" />}
          {expense?.receiptPath && !receiptFile && (
            <ListButton onClick={() => onViewReceipt(expense.receiptPath)}><ImageIcon size={17} aria-hidden="true" /> View Current Receipt</ListButton>
          )}
          <label className="row row-button row-action file-row">
            <Camera size={17} aria-hidden="true" /> {receiptFile || expense?.receiptPath ? "Replace Photo" : "Add Photo"}
            <input type="file" accept="image/*" capture="environment" onChange={pickFile} hidden />
          </label>
        </ListSection>

        {error && <p className="inline-warning">{error}</p>}

        {expense && (
          <ListSection>
            <SheetAction destructive onClick={() => onDelete()}>Delete Expense</SheetAction>
          </ListSection>
        )}
      </>
    </Sheet>
  );
}
