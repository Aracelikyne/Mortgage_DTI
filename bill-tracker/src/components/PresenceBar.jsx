import { Eye, EyeOff } from "lucide-react";

// Who else is signed in right now, and the controls to start/stop watching
// their screen live. Also surfaces the reverse — if someone is currently
// watching you — so following is never a silent, one-sided thing.
export default function PresenceBar({ onlineUsers, followingId, followedByNames, onFollow, onUnfollow, disableFollow }) {
  if (onlineUsers.length === 0 && followedByNames.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
      {onlineUsers.map((u) => (
        <div key={u.userId} className="ctc-hint" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--pine)", display: "inline-block" }} />
          {u.userName} online
          {followingId === u.userId ? (
            <button className="btn-ghost btn-sm" style={{ border: "1px solid var(--line)" }} onClick={onUnfollow}>
              <EyeOff size={12} /> Stop following
            </button>
          ) : !disableFollow ? (
            <button className="btn-ghost btn-sm" style={{ border: "1px solid var(--line)" }} onClick={() => onFollow(u.userId, u.userName)}>
              <Eye size={12} /> Follow
            </button>
          ) : null}
        </div>
      ))}
      {followedByNames.length > 0 && (
        <span className="ctc-hint">
          <Eye size={12} style={{ verticalAlign: -2 }} /> {followedByNames.map((f) => f.name).join(", ")} watching you
        </span>
      )}
    </div>
  );
}
