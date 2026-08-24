import { useState } from "react";
import { X } from "lucide-react";

// Lets an existing debt or fixed expense be marked as autopay, so the app
// stops expecting a manual payment entry each cycle and instead treats the
// money as already committed the moment it's due. Monthly autopay reuses
// the bill's own "Due day" field; biweekly autopay needs its own anchor
// date and per-debit amount, since it lands twice a month on a shifting
// date rather than once on a fixed day.
export default function AutopaySettingsModal({ item, onClose, onSave }) {
  const [enabled, setEnabled] = useState(!!item.autopay);
  const [frequency, setFrequency] = useState(item.autopayFrequency || "biweekly");
  const [anchor, setAnchor] = useState(item.autopayAnchor || "");
  const [amount, setAmount] = useState(item.autopayAmount ?? (Number(item.monthly || 0) / 2 || ""));

  function save() {
    if (!enabled) {
      onSave({ autopay: false, autopayFrequency: null, autopayAnchor: null, autopayAmount: null });
      onClose();
      return;
    }
    if (frequency === "biweekly" && !anchor) return;
    onSave({
      autopay: true,
      autopayFrequency: frequency,
      autopayAnchor: frequency === "biweekly" ? anchor : null,
      autopayAmount: frequency === "biweekly" ? (amount === "" ? null : Number(amount)) : null,
    });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Autopay — {item.name}</h3>
          <button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={onClose}><X size={16} /></button>
        </div>

        <div className="toggle-row">
          <input type="checkbox" id="apon" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <label htmlFor="apon">This bill debits itself automatically — don't wait on a manual payment</label>
        </div>

        {enabled && (
          <>
            <div className="field-row">
              <div className="field">
                <label>Frequency</label>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                  <option value="monthly">Monthly (uses this bill's Due day)</option>
                  <option value="biweekly">Every 2 weeks (split in half)</option>
                </select>
              </div>
              {frequency === "biweekly" && (
                <>
                  <div className="field">
                    <label>First debit date</label>
                    <input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Amount per debit</label>
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                </>
              )}
            </div>
            {frequency === "biweekly" && (
              <div className="ctc-hint">
                Repeats every 14 days from the first debit date, so it keeps landing on the same weekday. This bill's
                "Monthly" amount still drives interest/payoff math — only these two fields drive the paycheck plan.
              </div>
            )}
          </>
        )}

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
