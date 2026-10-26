import { useState } from "react";
import { Camera, ClipboardPaste, Image as ImageIcon, ScanText } from "lucide-react";
import Sheet, { SheetAction } from "./ui/Sheet";
import { ListButton, ListSection, SwitchRow, TextField } from "./ui/List";
import { EXPENSE_CATEGORIES } from "../data/constants";
import { isoDate } from "../utils/finance";
import { parseTransactionText } from "../utils/expenseText";
import { readImageText } from "../lib/scanText";

const CATEGORY_EMOJI = {
  Groceries: "🛒", Gas: "⛽️", "Fast Food": "🍔", "Dining Out": "🍽️", Shopping: "🛍️", Entertainment: "🎟️",
  Health: "🩺", Household: "🏠", Subscriptions: "🔁", Travel: "✈️", Other: "•",
};

// Logging an expense should take seconds: type (or scan) an amount, tap a
// category, done. A screenshot of an Apple Wallet transaction — or a
// receipt photo — is read on the device and fills in the merchant, amount
// and date; text copied with iOS Live Text can be pasted instead. A
// merchant logged before brings back its category automatically.
export default function ExpenseEditorSheet({ expense, merchantCategories, recentMerchants = [], onSave, onDelete, onViewReceipt, onClose }) {
  const [form, setForm] = useState({
    amount: expense?.amount ?? "",
    category: expense?.category || "",
    date: expense?.date || isoDate(new Date()),
    note: expense?.note || "",
  });
  const [categoryTouched, setCategoryTouched] = useState(!!expense);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [scanFile, setScanFile] = useState(null);
  const [keepScan, setKeepScan] = useState(false);
  const [scanning, setScanning] = useState(null); // null, or 0–1 progress
  const [scanNote, setScanNote] = useState(null);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  function setMerchant(note) {
    setForm((f) => {
      const known = merchantCategories?.get(note.trim().toLowerCase());
      return { ...f, note, category: !categoryTouched && known ? known : f.category };
    });
  }

  function fillFrom(text, source) {
    const found = parseTransactionText(text);
    const known = found.merchant && merchantCategories?.get(found.merchant.toLowerCase());
    setForm((f) => ({
      ...f,
      amount: found.amount !== null ? found.amount.toFixed(2) : f.amount,
      note: found.merchant || f.note,
      date: found.date || f.date,
      category: !categoryTouched && known ? known : f.category,
    }));
    const got = [found.amount !== null && "amount", found.merchant && "merchant", found.date && "date"].filter(Boolean);
    setScanNote(got.length
      ? `Filled in the ${got.join(", ")} from the ${source}${found.refund ? " (it looks like a refund)" : ""} — check it, pick a category, and log it.`
      : `Couldn't find a merchant or amount in that ${source} — type them in instead.`);
  }

  async function scan(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanFile(file);
    setScanning(0);
    setScanNote(null);
    try {
      fillFrom(await readImageText(file, setScanning), "screenshot");
    } catch (err) {
      console.error(err);
      setScanNote("Couldn't read that image — type the details in instead.");
    }
    setScanning(null);
  }

  function pickReceipt(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
  }

  const receipt = receiptFile || (keepScan ? scanFile : null);
  return (
    <Sheet
      title={expense ? "Edit Expense" : "Log Expense"}
      onClose={onClose}
      doneLabel={saving ? "Saving…" : expense ? "Save" : "Log"}
      doneDisabled={saving || scanning !== null || !(Number(form.amount) > 0) || !form.date}
      onDone={() => {
        // Saving is async: keep the sheet open until it lands, then close it
        // from here — or show the error and stay put.
        setSaving(true);
        setError(null);
        onSave({ ...form, category: form.category || "Other" }, receipt).then(
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
      {!expense && (
        <div className="quick-sources">
          <label className={`btn btn-tinted quick-source ${scanning !== null ? "busy" : ""}`}>
            <ScanText size={18} aria-hidden="true" />
            {scanning !== null ? `Reading… ${Math.round(scanning * 100)}%` : "Scan a screenshot"}
            <input type="file" accept="image/*" onChange={scan} hidden disabled={scanning !== null} data-testid="scan-file" />
          </label>
          <button type="button" className="btn btn-gray quick-source" onClick={() => setPasting((v) => !v)}>
            <ClipboardPaste size={18} aria-hidden="true" /> Paste text
          </button>
        </div>
      )}
      {pasting && (
        <ListSection footer="On iPhone, open the screenshot in Photos, touch and hold the text, choose Select All → Copy, then paste here.">
          <div className="row paste-row">
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4} placeholder={"Costco\n$64.12\nYesterday"} aria-label="Pasted transaction text" />
          </div>
          <ListButton disabled={!pasteText.trim()} onClick={() => { fillFrom(pasteText, "pasted text"); setPasting(false); }}>Fill In</ListButton>
        </ListSection>
      )}
      {scanNote && <p className="scan-note" role="status">{scanNote}</p>}

      <div className="amount-entry">
        <span className="amount-currency" aria-hidden="true">$</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder="0.00"
          value={form.amount}
          onChange={(e) => set("amount")(e.target.value)}
          aria-label="Amount"
          autoFocus={!expense}
        />
      </div>

      <div className="category-chips" role="radiogroup" aria-label="Category">
        {EXPENSE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={form.category === c}
            className={`category-chip ${form.category === c ? "active" : ""}`}
            onClick={() => { setCategoryTouched(true); set("category")(c); }}
          >
            <span aria-hidden="true">{CATEGORY_EMOJI[c] || "•"}</span> {c}
          </button>
        ))}
      </div>

      <ListSection>
        <TextField label="Merchant" value={form.note} onChange={setMerchant} placeholder="optional" list="recent-merchants" />
        <TextField label="Date" type="date" value={form.date} onChange={set("date")} />
      </ListSection>
      <datalist id="recent-merchants">
        {recentMerchants.map((m) => <option key={m} value={m} />)}
      </datalist>

      <ListSection header="Receipt (optional)">
        {scanFile && !receiptFile && <SwitchRow label="Keep the screenshot as the receipt" checked={keepScan} onChange={setKeepScan} />}
        {receiptPreview && <img className="receipt-preview" src={receiptPreview} alt="New receipt" />}
        {expense?.receiptPath && !receiptFile && (
          <ListButton onClick={() => onViewReceipt(expense.receiptPath)}><ImageIcon size={17} aria-hidden="true" /> View Current Receipt</ListButton>
        )}
        <label className="row row-button row-action file-row">
          <Camera size={17} aria-hidden="true" /> {receiptFile || expense?.receiptPath ? "Replace Photo" : "Add Photo"}
          <input type="file" accept="image/*" capture="environment" onChange={pickReceipt} hidden />
        </label>
      </ListSection>

      {error && <p className="inline-warning">{error}</p>}

      {expense && (
        <ListSection>
          <SheetAction destructive onClick={() => onDelete()}>Delete Expense</SheetAction>
        </ListSection>
      )}
    </Sheet>
  );
}
