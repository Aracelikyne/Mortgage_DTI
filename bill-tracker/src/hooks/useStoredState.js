import { useEffect, useState } from "react";

// useState backed by localStorage, for per-device preferences (tab order,
// a collapsed sidebar) that deliberately never go near the shared household
// data. Storage can be unavailable (private browsing, blocked site data),
// so every read and write is best effort.
export function useStoredState(key, initial, { parse = JSON.parse, serialize = JSON.stringify } = {}) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : parse(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, serialize(value)); } catch { /* best effort */ }
  }, [key, value, serialize]);
  return [value, setValue];
}
