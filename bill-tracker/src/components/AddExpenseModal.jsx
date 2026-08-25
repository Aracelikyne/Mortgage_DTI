import { useState } from "react";
import { X, Camera } from "lucide-react";
import { EXPENSE_CATEGORIES } from "../data/constants";
import { isoDate } from "../utils/finance";

export default function AddExpenseModal({ expense, onClose, onSave }) {
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
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function pickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
  }

  async function submit() {
    if (!form.amount || !form.category || !form.date) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(form, receiptFile);
    } catch (err) {
      console.error(err);
      setError("Couldn't save — check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{expense ? "Edit expense" : "Log an expense"}</h3>
          <button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Amount</label>
            <input type="number" placeholder="0.00" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={(e) => set("category", e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} style={{ fontFamily: "Inter" }} />
          </div>
          <div className="field">
            <label>Merchant / note</label>
            <input placeholder="optional" value={form.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-soft)", fontWeight: 600, marginBottom: 5 }}>
            Receipt photo
          </div>
          {(receiptPreview || (expense?.receiptPath && !receiptFile)) && (
            <div className="ctc-hint" style={{ marginBottom: 6 }}>
              {receiptPreview ? "New photo selected — will replace the current one on save." : "A receipt is already attached — pick a new file to replace it."}
            </div>
          )}
          {receiptPreview && (
            <img src={receiptPreview} alt="Receipt preview" style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 4, marginBottom: 8, display: "block" }} />
          )}
          <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", width: "fit-content" }}>
            <Camera size={13} /> {receiptFile ? "Change photo" : "Add photo"}
            <input type="file" accept="image/*" capture="environment" onChange={pickFile} style={{ display: "none" }} />
          </label>
        </div>

        {error && <div className="ctc-hint" style={{ color: "var(--brick)", marginTop: 10 }}>{error}</div>}

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : expense ? "Save changes" : "Log expense"}
          </button>
        </div>
      </div>
    </div>
  );
}
