import { CopyCheck } from "lucide-react";
import Banner from "./ui/Banner";
import { useHouseholdContext } from "../state/HouseholdContext";

// Shown above Debts or Fixed Expenses while any of them look like the same
// bill entered twice.
export default function DuplicatesBanner({ kind }) {
  const h = useHouseholdContext();
  const count = h.duplicateGroups.filter((g) => g.kind === kind).length;
  if (count === 0) return null;
  return (
    <Banner
      tone="warning"
      icon={<CopyCheck size={18} />}
      action={<button type="button" className="btn btn-sm btn-filled" onClick={h.openDuplicates}>Review</button>}
    >
      {count === 1 ? "1 bill looks like it's in here twice." : `${count} bills look like they're in here twice.`}
    </Banner>
  );
}
