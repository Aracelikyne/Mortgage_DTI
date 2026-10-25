import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import Sheet from "./ui/Sheet";
import { ListSection } from "./ui/List";
import { TAB_BAR_SLOTS } from "../data/nav";

// Reorders the sections with both a drag handle and up/down buttons — drag
// is nicer, but a fine-motor drag gesture is genuinely hard on some
// touchscreens, so the arrows are a first-class fallback, not an
// afterthought. Saved per device, not shared with the other person — the
// whole point is each of you can order it for how you actually use the app.
export default function TabOrderSheet({ items, onSave, onClose }) {
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
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-tab-key]");
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

  const rows = (list, offset) => list.map((item, idx) => {
    const i = idx + offset;
    const Icon = item.icon;
    return (
      <div key={item.key} data-tab-key={item.key} className="row reorder-row">
        <span className="reorder-handle" onPointerDown={(e) => onPointerDown(item.key, e)} title="Drag to reorder" aria-hidden="true">
          <GripVertical size={18} />
        </span>
        <Icon size={19} className="reorder-icon" aria-hidden="true" />
        <span className="row-body"><span className="row-title">{item.label}</span></span>
        <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(item.key, -1)} aria-label={`Move ${item.label} up`}><ChevronUp size={18} /></button>
        <button type="button" className="icon-btn" disabled={i === order.length - 1} onClick={() => move(item.key, 1)} aria-label={`Move ${item.label} down`}><ChevronDown size={18} /></button>
      </div>
    );
  });

  return (
    <Sheet title="Reorder Tabs" onClose={onClose} doneLabel="Save" onDone={() => onSave(order.map((it) => it.key))}>
      <ListSection header="Tab bar" footer={`On a phone, the first ${TAB_BAR_SLOTS} get their own tab; the rest are under More. On an iPad or computer the sidebar shows them all in this order. This only changes the order on this device.`}>
        {rows(order.slice(0, TAB_BAR_SLOTS), 0)}
      </ListSection>
      <ListSection header="Under More">
        {rows(order.slice(TAB_BAR_SLOTS), TAB_BAR_SLOTS)}
      </ListSection>
    </Sheet>
  );
}
