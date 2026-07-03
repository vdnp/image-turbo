import { defineConfig } from "@playwright/test";

const PORT = 3111;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // the demos share one mock bucket; keep runs deterministic
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    navigationTimeout: 60_000, // first hit compiles the page in next dev
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    cwd: "./examples/nextjs-app",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
