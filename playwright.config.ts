import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const shouldManageServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  timeout: 45_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixels: 200,
      animations: "disabled",
    },
  },
  snapshotDir: "./tests/visual/snapshots",
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
      testDir: "./tests/smoke",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual",
      testDir: "./tests/visual",
      use: {
        ...devices["Desktop Chrome"],
        screenshot: "on",
      },
    },
  ],
  webServer: shouldManageServer
    ? {
        command: "cross-env NEXT_PUBLIC_DISABLE_DESKTOP_INTRO=1 npm -w web run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      }
    : undefined,
});
