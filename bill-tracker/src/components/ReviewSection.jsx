import { ListSection } from "./ui/List";
import { reviewItems } from "../utils/statementSync";
import { ordinal } from "../utils/format";

const USE_LABEL = {
  monthly: (v) => `Use ${Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
  dueDay: (v) => `Use the ${ordinal(v)}`,
};

// Flags a statement update left on a bill (see utils/statementSync.js), each
// settled with one tap: take the statement's value, or keep what's here.
// Works on an edit sheet's draft — nothing is saved until Done.
export default function ReviewSection({ draft, setDraft }) {
  const items = reviewItems(draft);
  if (items.length === 0) return null;

  function settle(key, accept) {
    setDraft((d) => {
      const review = { ...(d.review || {}) };
      const next = { ...d };
      if (accept && review[key]?.statement !== undefined) next[key] = String(review[key].statement);
      delete review[key];
      next.review = review;
      return next;
    });
  }

  return (
    <ListSection header="Needs review" footer="From the last statement update. Settle each one; nothing changes until you tap Done.">
      {items.map((r) => (
        <div key={r.key} className="row review-row">
          <span className="row-body"><span className="row-title">{r.label}</span></span>
          {r.statement !== undefined && USE_LABEL[r.key] && (
            <button type="button" className="btn btn-xs btn-tinted" onClick={() => settle(r.key, true)}>{USE_LABEL[r.key](r.statement)}</button>
          )}
          <button type="button" className="btn btn-xs btn-gray" onClick={() => settle(r.key, false)}>
            {r.key === "apr" ? "Confirm" : "Keep"}
          </button>
        </div>
      ))}
    </ListSection>
  );
}
