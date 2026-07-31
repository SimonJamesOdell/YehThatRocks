import { expect, test } from "@playwright/test";

/**
 * Extended route coverage — pages not in the core 10 snapshots.
 * Covers auth forms, overlay routes, and edge-case pages.
 */

const BASE = "http://127.0.0.1:3000";

// Desktop overlay routes with distinct visual layouts
const DESKTOP_ROUTES = [
  { name: "favourites-auth-gate", path: "/favourites" },
  { name: "playlists-grid", path: "/playlists" },
  { name: "history", path: "/history" },
  { name: "login", path: "/login" },
  { name: "register", path: "/register" },
  { name: "forgot-password", path: "/forgot-password" },
  { name: "forum", path: "/forum" },
  { name: "account", path: "/account" },
  { name: "account-settings", path: "/account?tab=settings" },
  { name: "decade-80s", path: "/decade/1980s" },
  { name: "best-of-metal-2024", path: "/best-of/metal/2024" },
  { name: "desktop-only-fallback", path: "/desktop-only" },
];

// Mobile overlay routes
const MOBILE_ROUTES = [
  { name: "mobile-search", path: "/m/search" },
  { name: "mobile-login", path: "/m/login" },
  { name: "mobile-favourites", path: "/m/favourites" },
  { name: "mobile-new", path: "/m/new" },
  { name: "mobile-forum", path: "/m/forum" },
  { name: "mobile-top100", path: "/m/top100" },
  { name: "mobile-account", path: "/m/account" },
  { name: "mobile-register", path: "/m/register" },
  { name: "mobile-forgot-password", path: "/m/forgot-password" },
  { name: "mobile-verify-email", path: "/m/verify-email" },
  { name: "mobile-reset-password", path: "/m/reset-password" },
];

test.describe("visual regression — desktop overlays", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const route of DESKTOP_ROUTES) {
    test(`${route.name}`, async ({ page }) => {
      await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await expect(page).toHaveScreenshot(`routes/${route.name}-desktop.png`, {
        fullPage: false,
        maxDiffPixels: 200,
      });
    });
  }
});

test.describe("visual regression — mobile overlays", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of MOBILE_ROUTES) {
    test(`${route.name}`, async ({ page }) => {
      await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await expect(page).toHaveScreenshot(`routes/${route.name}-mobile.png`, {
        fullPage: false,
        maxDiffPixels: 200,
      });
    });
  }
});
