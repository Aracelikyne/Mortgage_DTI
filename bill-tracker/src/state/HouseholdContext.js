import { createContext, useContext } from "react";

// Everything a page needs — the shared household data and its setters, the
// numbers derived from it, the edit actions, sync/sandbox/follow state and
// navigation — handed down once from AppShell instead of threaded through
// every page as props.
export const HouseholdContext = createContext(null);

export function useHouseholdContext() {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHouseholdContext must be used inside HouseholdContext.Provider");
  return ctx;
}
