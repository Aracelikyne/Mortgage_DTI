import { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import Sheet from "./ui/Sheet";
import { ListRow, ListSection } from "./ui/List";

// A Dashboard number that explains itself: a one-line caption saying what
// it measures, and a tap for the full story — how it's calculated (with the
// real numbers), what's holding it back, and where to change it.
export default function MetricCard({ metric, onNavigate }) {
  const [open, setOpen] = useState(false);
  const { label, value, tone, small, caption, details = [], blockers = [], actions = [] } = metric;
  return (
    <>
      <button type="button" className="widget metric-card" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="widget-label">{label}<Info size={13} className="metric-info" aria-hidden="true" /></span>
        <span className={`widget-value num ${tone ? `tone-${tone}` : ""} ${small ? "small" : ""}`}>{value}</span>
        {caption && <span className="widget-sub">{caption}</span>}
      </button>
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          <div className="metric-value-big num">{value}</div>
          {details.map((d) => (
            <ListSection key={d.title} header={d.title}>
              <div className="row metric-text">{d.text}</div>
            </ListSection>
          ))}
          {blockers.length > 0 && (
            <ListSection header="What's holding it back">
              {blockers.map((b) => <ListRow key={b.name} title={b.name} subtitle={b.reason} />)}
            </ListSection>
          )}
          {actions.length > 0 && (
            <ListSection header="Change it">
              {actions.map((a) => (
                <button key={a.label} type="button" className="row row-button" onClick={() => { setOpen(false); onNavigate(a.page); }}>
                  <span className="row-body"><span className="row-title tone-blue">{a.label}</span></span>
                  <ChevronRight className="row-chevron" size={18} aria-hidden="true" />
                </button>
              ))}
            </ListSection>
          )}
        </Sheet>
      )}
    </>
  );
}
