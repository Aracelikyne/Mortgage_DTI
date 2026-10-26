import { useEffect } from "react";
import { useStoredState } from "./useStoredState";

const BAR_COLOR = { light: "#F2F2F7", dark: "#000000" };

// Light, Dark, or follow the device ("system") — a per-device preference.
// Sets data-theme on <html> (app.css keys the dark palette off it) and
// points the browser/status-bar color at the chosen appearance. index.html
// applies the saved choice before first paint so there's no flash.
export function useTheme() {
  const [theme, setTheme] = useStoredState("ctc-theme", "system");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else delete root.dataset.theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      const scheme = meta.media.includes("dark") ? "dark" : "light";
      meta.content = BAR_COLOR[theme === "system" ? scheme : theme];
    });
  }, [theme]);

  return [theme, setTheme];
}

export const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
