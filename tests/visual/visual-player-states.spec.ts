import { expect, test } from "@playwright/test";

/**
 * Player state coverage — error states, auth walls, unavailable video overlays.
 * These test the player-chrome.css rules that only trigger in non-playing states.
 */

const BASE = "http://127.0.0.1:3000";

test.describe("visual regression — player error states", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("player — nonexistent video ID (error overlay)", async ({ page }) => {
    // Navigate to a video that definitely doesn't exist
    await page.goto(`${BASE}/?v=thisvideodoesnotexist12345`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(3000);

    await expect(page).toHaveScreenshot("player-states/nonexistent-video.png", {
      fullPage: false,
      maxDiffPixels: 300,
    });
  });

  test("player — invalid video ID format", async ({ page }) => {
    await page.goto(`${BASE}/?v=!!!invalid!!!`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);

    await expect(page).toHaveScreenshot("player-states/invalid-video-id.png", {
      fullPage: false,
      maxDiffPixels: 300,
    });
  });

  test("player — homepage with autoplay disabled state", async ({ page }) => {
    // Visit homepage without ?v= param — should show player boot/connecting state
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    await expect(page).toHaveScreenshot("player-states/homepage-boot.png", {
      fullPage: false,
      maxDiffPixels: 300,
    });
  });

  test("auth wall — favourites overlay", async ({ page }) => {
    // Favourites should show auth gate for unauthenticated users
    await page.goto(`${BASE}/favourites`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    await expect(page).toHaveScreenshot("player-states/favourites-auth-gate.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("auth wall — history overlay", async ({ page }) => {
    await page.goto(`${BASE}/history`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    await expect(page).toHaveScreenshot("player-states/history-auth-gate.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("auth wall — playlists overlay", async ({ page }) => {
    await page.goto(`${BASE}/playlists`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    await expect(page).toHaveScreenshot("player-states/playlists-auth-gate.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("auth wall — admin dashboard", async ({ page }) => {
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    await expect(page).toHaveScreenshot("player-states/admin-auth-gate.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("empty state — search with no results query", async ({ page }) => {
    await page.goto(`${BASE}/search?q=xyznonexistentquery12345`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(2000);

    await expect(page).toHaveScreenshot("player-states/search-no-results.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });
});
