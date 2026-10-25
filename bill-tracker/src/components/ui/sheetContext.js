import { createContext, useContext } from "react";

// The open sheet's animated close, for controls inside its body.
export const SheetCloseContext = createContext(() => {});

export function useCloseSheet() {
  return useContext(SheetCloseContext);
}
