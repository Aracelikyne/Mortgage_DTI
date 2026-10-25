import { Eye, FlaskConical, RefreshCw, TriangleAlert } from "lucide-react";
import Banner from "./ui/Banner";
import IdRepairBanner from "./IdRepairBanner";
import PresenceBar from "./PresenceBar";
import { useHouseholdContext } from "../state/HouseholdContext";

// App-wide notices, shown under every page's title.
export default function StatusBanners() {
  const h = useHouseholdContext();
  return (
    <div className="status-banners">
      {h.loadError && <Banner tone="danger" icon={<TriangleAlert size={18} />}>{h.loadError}</Banner>}
      {h.sandboxActive && (
        <Banner
          tone="sandbox"
          icon={<FlaskConical size={18} />}
          action={<button type="button" className="btn btn-sm btn-filled" onClick={h.exitSandbox}>Exit</button>}
        >
          <strong>Sandbox.</strong> Play with the numbers freely — nothing here saves, and it all reverts when you exit.
        </Banner>
      )}
      {h.spectating && (
        <Banner
          tone="info"
          icon={<Eye size={18} />}
          action={<button type="button" className="btn btn-sm btn-filled" onClick={h.unfollow}>Stop</button>}
        >
          Watching {h.followingName || "their"} screen live — read-only while following.
        </Banner>
      )}
      {h.remoteChangePending && !h.spectating && !h.sandboxActive && (
        <Banner
          tone="warning"
          icon={<RefreshCw size={18} />}
          action={<button type="button" className="btn btn-sm btn-filled" onClick={() => window.location.reload()}>Reload</button>}
        >
          {h.lastEditedBy.name || "Someone"} just made changes elsewhere — reload to see them.
        </Banner>
      )}
      <IdRepairBanner notice={h.idRepairNotice} onDismiss={h.dismissIdRepair} />
      <PresenceBar
        onlineUsers={h.onlineUsers}
        followingId={h.followingId}
        followedByNames={h.followedByNames}
        onFollow={h.followUser}
        onUnfollow={h.unfollow}
        disableFollow={h.sandboxActive}
      />
    </div>
  );
}
