import { needsInfo, reviewItems } from "../utils/statementSync";

// "Needs review" (a statement update disagreed with what's here) and
// "Needs info" (no payoff or APR yet) markers next to a bill's name.
export default function BillBadges({ item, kind }) {
  const review = reviewItems(item).length;
  const info = needsInfo(item, kind).length;
  return (
    <>
      {review > 0 && <span className="badge badge-orange inline-badge">Needs review</span>}
      {info > 0 && <span className="badge badge-red inline-badge">Needs info</span>}
    </>
  );
}
