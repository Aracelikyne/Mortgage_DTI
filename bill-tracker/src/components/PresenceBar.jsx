import { Eye, EyeOff } from "lucide-react";

// Who else is signed in right now, and the controls to start/stop watching
// their screen live. Also surfaces the reverse — if someone is currently
// watching you — so following is never a silent, one-sided thing.
export default function PresenceBar({ onlineUsers, followingId, followedByNames, onFollow, onUnfollow, disableFollow }) {
  if (onlineUsers.length === 0 && followedByNames.length === 0) return null;

  return (
    <div className="presence">
      {onlineUsers.map((u) => (
        <span key={u.userId} className="presence-pill">
          <span className="presence-dot" aria-hidden="true" />
          {u.userName} online
          {followingId === u.userId ? (
            <button type="button" className="btn btn-xs btn-gray" onClick={onUnfollow}>
              <EyeOff size={13} /> Stop following
            </button>
          ) : !disableFollow ? (
            <button type="button" className="btn btn-xs btn-tinted" onClick={() => onFollow(u.userId, u.userName)}>
              <Eye size={13} /> Follow
            </button>
          ) : null}
        </span>
      ))}
      {followedByNames.length > 0 && (
        <span className="presence-pill presence-watched">
          <Eye size={13} aria-hidden="true" /> {followedByNames.map((f) => f.name).join(", ")} watching you
        </span>
      )}
    </div>
  );
}
