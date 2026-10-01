import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  oxc: {
    // The project tsconfig sets `jsx: "preserve"` (Next.js compiles JSX itself).
    // Vitest must compile JSX on its own so tests can import .tsx modules that
    // contain JSX (e.g. page.tsx in social-share metadata tests).
    jsx: { runtime: "automatic" },
  },
});
