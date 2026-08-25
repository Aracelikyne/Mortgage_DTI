import { useRef, useState } from "react";
import { X, GripVertical, ChevronUp, ChevronDown } from "lucide-react";

// Reorders a small list (the nav tabs) with both a drag handle and up/down
// buttons — drag is nicer, but a fine-motor drag gesture is genuinely hard
// on some touchscreens, so the arrows are a first-class fallback, not an
// afterthought. Saved per-device (see App.jsx), not shared with the other
// person — the whole point is each of you can order it for how you
// actually use the app.
export default function TabOrderModal({ items, onSave, onClose }) {
  const [order, setOrder] = useState(items);
  const dragKey = useRef(null);

  function move(key, delta) {
    setOrder((prev) => {
      const i = prev.findIndex((it) => it.key === key);
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function onPointerDown(key, e) {
    dragKey.current = key;
    e.preventDefault();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }
  function onPointerMove(e) {
    if (!dragKey.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest("[data-tab-key]");
    const targetKey = row?.getAttribute("data-tab-key");
    if (!targetKey || targetKey === dragKey.current) return;
    setOrder((prev) => {
      const from = prev.findIndex((it) => it.key === dragKey.current);
      const to = prev.findIndex((it) => it.key === targetKey);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  function onPointerUp() {
    dragKey.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Reorder tabs</h3>
          <button className="btn-ghost btn-sm" style={{ border: "none" }} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ctc-hint" style={{ marginBottom: 10 }}>Drag, or use the arrows — this only changes the order on this device.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {order.map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                data-tab-key={item.key}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 8px",
                  border: "1px solid var(--line)", borderRadius: 4, background: "#fff",
                }}
              >
                <span
                  onPointerDown={(e) => onPointerDown(item.key, e)}
                  style={{ cursor: "grab", touchAction: "none", display: "flex" }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} style={{ opacity: 0.5 }} />
                </span>
                <Icon size={15} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{item.label}</span>
                <button className="btn-ghost btn-sm" style={{ border: "none", padding: 3 }} disabled={i === 0} onClick={() => move(item.key, -1)} title="Move up">
                  <ChevronUp size={14} />
                </button>
                <button className="btn-ghost btn-sm" style={{ border: "none", padding: 3 }} disabled={i === order.length - 1} onClick={() => move(item.key, 1)} title="Move down">
                  <ChevronDown size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(order.map((it) => it.key))}>Save order</button>
        </div>
      </div>
    </div>
  );
}
