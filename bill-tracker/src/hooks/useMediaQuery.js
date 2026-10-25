import { useCallback, useSyncExternalStore } from "react";

// Whether a CSS media query currently matches, kept live as the window
// resizes or an iPad rotates.
export function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

// Sidebar instead of a tab bar from here up — iPad, or a desktop window.
export const WIDE_LAYOUT = "(min-width: 768px)";
