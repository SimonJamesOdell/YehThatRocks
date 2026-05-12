import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const shouldManageServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: false,
  timeout: 45_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: shouldManageServer
    ? {
        command: "cross-env NEXT_PUBLIC_DISABLE_DESKTOP_INTRO=1 npm -w web run dev",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : undefined,
});