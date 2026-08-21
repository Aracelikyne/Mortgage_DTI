import { useState } from "react";
import { X } from "lucide-react";
import { FIXED_CATEGORY_OPTIONS } from "../data/constants";

export default function AddFixedModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ name: "", type: "Utility", monthly: "", note: "", dueDay: "", graceDays: "0" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add a fixed expense</h3>
          <button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => set("type", e.target.value)}>
              {FIXED_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Monthly amount</label>
            <input type="number" value={form.monthly} onChange={(e) => set("monthly", e.target.value)} />
          </div>
          <div className="field">
            <label>Due day of month</label>
            <input type="number" min="1" max="31" placeholder="optional" value={form.dueDay} onChange={(e) => set("dueDay", e.target.value)} />
          </div>
          <div className="field">
            <label>Grace period (days)</label>
            <input type="number" min="0" placeholder="0" value={form.graceDays} onChange={(e) => set("graceDays", e.target.value)} />
          </div>
          <div className="field">
            <label>Note</label>
            <input value={form.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!form.name || !form.monthly) return;
              onAdd({
                name: form.name,
                type: form.type,
                monthly: Number(form.monthly),
                note: form.note,
                dueDay: form.dueDay === "" ? null : Number(form.dueDay),
                graceDays: form.graceDays === "" ? 0 : Number(form.graceDays),
              });
            }}
          >
            Add expense
          </button>
        </div>
      </div>
    </div>
  );
}