import { useState } from "react";
import { X } from "lucide-react";
import { CATEGORY_OPTIONS } from "../data/constants";

export default function AddDebtModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ name: "", type: "Credit Card", monthly: "", balance: "", apr: "", dueDay: "", graceDays: "0", priority: 2, protectedFlag: false, splitFriendly: false });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add a debt</h3>
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
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Monthly payment</label>
            <input type="number" value={form.monthly} onChange={(e) => set("monthly", e.target.value)} />
          </div>
          <div className="field">
            <label>Payoff balance</label>
            <input type="number" value={form.balance} onChange={(e) => set("balance", e.target.value)} />
          </div>
          <div className="field">
            <label>Interest rate (APR %)</label>
            <input type="number" placeholder="optional" value={form.apr} onChange={(e) => set("apr", e.target.value)} />
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
            <label>Priority tier</label>
            <select value={form.priority} onChange={(e) => set("priority", Number(e.target.value))}>
              <option value={1}>1 — Quick wins</option>
              <option value={2}>2 — Core payoff</option>
              <option value={3}>3 — Large loans</option>
              <option value={4}>4 — Deprioritized</option>
            </select>
          </div>
        </div>
        <div className="toggle-row">
          <input type="checkbox" id="prot" checked={form.protectedFlag} onChange={(e) => set("protectedFlag", e.target.checked)} />
          <label htmlFor="prot">Minimum only, forever — never target with extra payments</label>
        </div>
        <div className="toggle-row">
          <input type="checkbox" id="splitok" checked={form.splitFriendly} onChange={(e) => set("splitFriendly", e.target.checked)} />
          <label htmlFor="splitok">OK to split across this month's paychecks with no real downside</label>
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
                balance: form.balance === "" ? null : Number(form.balance),
                apr: form.apr === "" ? null : Number(form.apr),
                dueDay: form.dueDay === "" ? null : Number(form.dueDay),
                graceDays: form.graceDays === "" ? 0 : Number(form.graceDays),
                priority: form.protectedFlag ? null : form.priority,
                protected: form.protectedFlag,
                excludeFromGoal: form.protectedFlag,
                splitFriendly: form.splitFriendly,
              });
            }}
          >
            Add debt
          </button>
        </div>
      </div>
    </div>
  );
}