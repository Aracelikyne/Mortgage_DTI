import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import { SheetCloseContext, useCloseSheet } from "./sheetContext";
import { ListButton } from "./List";

// How many sheets are open — the page underneath stays scroll-locked until
// the last one closes.
let openSheets = 0;

// A modal sheet. On phones it slides up from the bottom with a grabber and
// can be dragged down to dismiss; on wider screens it's a centered form
// sheet. The header is iOS's: Cancel on the left, the title, and the
// primary action (Done/Save/Add) on the right.
//
// `onDone` commits; return false from it to keep the sheet open (e.g. a
// required field is empty). Without `onDone`, the right button just closes.
// Controls in the body that should close the sheet once they've run use
// <SheetAction> (or useCloseSheet()).
// `onBack` swaps Cancel for "‹ Back", for sheets with more than one step.
export default function Sheet({ title, onClose, onDone, onBack, doneLabel = "Done", doneDisabled = false, cancelLabel = "Cancel", headerTrailing, children, className = "" }) {
  const [shown, setShown] = useState(false);
  const sheetRef = useRef(null);
  const closing = useRef(false);
  const closeTimer = useRef(null);
  const drag = useRef(null);
  const titleId = useId();

  useEffect(() => {
    openSheets++;
    document.documentElement.classList.add("sheet-open");
    const previouslyFocused = document.activeElement;
    const frame = requestAnimationFrame(() => setShown(true));
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(closeTimer.current);
      if (--openSheets === 0) document.documentElement.classList.remove("sheet-open");
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  function close() {
    if (closing.current) return;
    closing.current = true;
    if (sheetRef.current) sheetRef.current.style.transform = "";
    setShown(false);
    closeTimer.current = setTimeout(() => onClose?.(), 260);
  }

  function done() {
    if (onDone && onDone() === false) return;
    close();
  }

  // Drag-to-dismiss from the grabber/header, phones only.
  function onPointerDown(e) {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    if (e.target.closest("button, input, select, textarea, a")) return;
    drag.current = { startY: e.clientY, dy: 0, startedAt: performance.now() };
    sheetRef.current.style.transition = "none";
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.startY);
    sheetRef.current.style.transform = `translateY(${drag.current.dy}px)`;
  }
  function onPointerUp() {
    if (!drag.current) return;
    const { dy, startedAt } = drag.current;
    drag.current = null;
    const el = sheetRef.current;
    el.style.transition = "";
    const velocity = dy / Math.max(1, performance.now() - startedAt); // px per ms
    if (dy > 120 || (dy > 30 && velocity > 0.6)) close();
    else el.style.transform = "";
  }

  const showCancel = !!onDone && cancelLabel !== null;

  return createPortal(
    <>
      <div className={`sheet-backdrop ${shown ? "open" : ""}`} onClick={close} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={`sheet ${shown ? "open" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
      >
        <div className="sheet-drag" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="sheet-grabber" aria-hidden="true" />
          <div className="sheet-header">
            <div className="sheet-header-leading">
              {onBack ? (
                <button type="button" className="nav-btn nav-back" onClick={onBack}><ChevronLeft size={24} strokeWidth={2.4} aria-hidden="true" />Back</button>
              ) : showCancel && <button type="button" className="nav-btn" onClick={close}>{cancelLabel}</button>}
            </div>
            <h2 className="sheet-title" id={titleId}>{title}</h2>
            <div className="sheet-header-trailing">
              {headerTrailing}
              <button type="button" className="nav-btn nav-btn-strong" disabled={doneDisabled} onClick={done}>
                {onDone ? doneLabel : "Done"}
              </button>
            </div>
          </div>
        </div>
        <div className="sheet-body">
          <SheetCloseContext.Provider value={close}>{children}</SheetCloseContext.Provider>
        </div>
      </div>
    </>,
    document.body
  );
}

// A full-width action row in a sheet ("Delete Expense", "Restore") that
// runs, then closes the sheet with its usual animation.
export function SheetAction({ onClick, ...props }) {
  const close = useCloseSheet();
  return <ListButton {...props} onClick={() => { onClick?.(); close(); }} />;
}
