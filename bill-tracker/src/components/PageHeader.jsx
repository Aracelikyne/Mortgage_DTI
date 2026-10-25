import { ChevronLeft, CloudAlert, LoaderCircle } from "lucide-react";
import NavBar from "./ui/NavBar";
import StatusBanners from "./StatusBanners";
import { useHouseholdContext } from "../state/HouseholdContext";

// Every page's top: the large-title nav bar, page actions on the right, a
// "‹ More" back button for sections reached through More on phones, and the
// app-wide banners (sandbox, following, repairs…) right under the title.
export default function PageHeader({ title, actions }) {
  const { page, setPage, isWide, moreKeys, saveStatus } = useHouseholdContext();
  const reachedThroughMore = !isWide && moreKeys.includes(page);
  return (
    <NavBar
      title={title}
      leading={reachedThroughMore ? (
        <button type="button" className="nav-btn nav-back" onClick={() => setPage("more")}>
          <ChevronLeft size={26} strokeWidth={2.4} aria-hidden="true" />More
        </button>
      ) : null}
      trailing={(
        <>
          {saveStatus === "saving" && <LoaderCircle className="sync-spinner" size={18} aria-label="Saving" />}
          {saveStatus === "error" && (
            <span className="sync-error" role="alert"><CloudAlert size={18} aria-hidden="true" /> Not saved</span>
          )}
          {actions}
        </>
      )}
      below={<StatusBanners />}
    />
  );
}
