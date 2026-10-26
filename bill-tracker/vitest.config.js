import { defineConfig } from "vitest/config";

// Kept separate from vite.config.js so unit tests don't spin up the React
// and PWA plugins — everything tested here is plain data logic.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js", "supabase/functions/**/*.test.ts"],
  },
});
