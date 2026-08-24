import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const CURSOR_THROTTLE_MS = 50;

// Presence + cursor broadcasting for "follow the leader": lets one signed-in
// household member watch the other's mouse move and pages change live, the
// way Figma/Google Docs show a collaborator's cursor. Nothing here touches
// the shared bill data — this is purely ephemeral view state exchanged over
// a realtime channel, so it never goes through household_state.
export function useLiveFollow({ userId, userName, page, onLeaderUpdate }) {
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [followingId, setFollowingId] = useState(null);
  const [followingName, setFollowingName] = useState(null);
  const [leaderState, setLeaderState] = useState(null);
  const [followedByNames, setFollowedByNames] = useState([]);

  const channelRef = useRef(null);
  const pageRef = useRef(page);
  const followingIdRef = useRef(null);
  const lastSentRef = useRef(0);
  const onLeaderUpdateRef = useRef(onLeaderUpdate);

  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { followingIdRef.current = followingId; }, [followingId]);
  useEffect(() => { onLeaderUpdateRef.current = onLeaderUpdate; }, [onLeaderUpdate]);

  useEffect(() => {
    const channel = supabase.channel("household-presence", {
      config: { presence: { key: userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const others = Object.values(state).flat().filter((u) => u.userId !== userId);
        setOnlineUsers(others);
        // Whoever we're following just went offline — nothing left to watch.
        // Handled right here, in the callback that caused it, rather than a
        // separate effect reacting to the resulting onlineUsers state.
        if (followingIdRef.current && !others.some((u) => u.userId === followingIdRef.current)) {
          setFollowingId(null);
          setFollowingName(null);
          setLeaderState(null);
        }
      })
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        if (payload.userId !== followingIdRef.current) return;
        setLeaderState(payload);
        onLeaderUpdateRef.current?.(payload);
      })
      .on("broadcast", { event: "follow-status" }, ({ payload }) => {
        if (payload.targetId !== userId) return;
        setFollowedByNames((prev) => {
          const without = prev.filter((n) => n.id !== payload.followerId);
          return payload.following ? [...without, { id: payload.followerId, name: payload.followerName }] : without;
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId, userName, page: pageRef.current });
        }
      });

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, userName]);

  // Keep this client's presence record current so the other person's
  // "online, viewing X" shows the right page.
  useEffect(() => {
    channelRef.current?.track({ userId, userName, page });
  }, [page, userId, userName]);

  const follow = useCallback((targetId, targetName) => {
    setFollowingId(targetId);
    setFollowingName(targetName);
    setLeaderState(null);
    channelRef.current?.send({
      type: "broadcast",
      event: "follow-status",
      payload: { followerId: userId, followerName: userName, targetId, following: true },
    });
  }, [userId, userName]);

  const unfollow = useCallback(() => {
    if (followingIdRef.current) {
      channelRef.current?.send({
        type: "broadcast",
        event: "follow-status",
        payload: { followerId: userId, followerName: userName, targetId: followingIdRef.current, following: false },
      });
    }
    setFollowingId(null);
    setFollowingName(null);
    setLeaderState(null);
  }, [userId, userName]);

  // Only worth broadcasting our own cursor when someone is actually
  // watching — otherwise it's wasted traffic (and exposure) for nobody.
  useEffect(() => {
    if (followedByNames.length === 0) return;
    function handleMove(e) {
      const now = Date.now();
      if (now - lastSentRef.current < CURSOR_THROTTLE_MS) return;
      lastSentRef.current = now;
      const doc = document.documentElement;
      const maxScroll = Math.max(1, doc.scrollHeight - doc.clientHeight);
      channelRef.current?.send({
        type: "broadcast",
        event: "cursor",
        payload: {
          userId, userName, page: pageRef.current,
          x: e.clientX / window.innerWidth,
          y: e.clientY / window.innerHeight,
          scrollFrac: doc.scrollTop / maxScroll,
        },
      });
    }
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [followedByNames.length, userId, userName]);

  return { onlineUsers, followingId, followingName, leaderState, followedByNames, follow, unfollow };
}
