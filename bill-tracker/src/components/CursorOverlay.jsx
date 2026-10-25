// Renders whoever you're following as a ghost cursor at their live mouse
// position — a fraction of their viewport, mapped onto yours, so it stays
// in the right relative spot even if the two windows are different sizes.
// Only shows up while they're on the same page/tab you've been mirrored to.
export default function CursorOverlay({ leaderState, currentPage }) {
  // hasPointer is false when the leader is on a touch screen with no cursor to show.
  if (!leaderState || leaderState.page !== currentPage || leaderState.hasPointer === false) return null;
  const left = leaderState.x * window.innerWidth;
  const top = leaderState.y * window.innerHeight;

  return (
    <div
      style={{
        position: "fixed", left, top, zIndex: 9999, pointerEvents: "none",
        transition: "left 0.08s linear, top 0.08s linear",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))" }}>
        <path d="M1 1 L1 14 L5 11 L7.5 16 L9.5 15 L7 10 L12 10 Z" fill="var(--tint)" stroke="white" strokeWidth="1" />
      </svg>
      <div
        style={{
          marginLeft: 14, marginTop: -2, display: "inline-block", whiteSpace: "nowrap",
          background: "var(--tint)", color: "#fff", fontSize: 12, fontWeight: 600,
          padding: "2px 8px", borderRadius: 999, fontFamily: "var(--font)",
        }}
      >
        {leaderState.userName}
      </div>
    </div>
  );
}
