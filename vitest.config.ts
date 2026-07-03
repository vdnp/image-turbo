import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    unstubGlobals: true,
    // e2e/*.spec.ts belongs to Playwright, not Vitest
    exclude: [...configDefaults.exclude, "e2e/**", "examples/**"],
  },
});
