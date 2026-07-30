import { expect, test } from "@playwright/test";

/**
 * Visual regression tests for yehthatrocks key pages.
 *
 * Baseline screenshots are stored in tests/visual/snapshots/.
 * Run `npx playwright test --config playwright.config.ts --project=visual` to
 * generate or update baselines. When a page changes visually, the test fails
 * with a diff image — review and update the baseline if the change is intentional.
 *
 * Pages covered:
 *   1. Homepage (player shell + hero grid)
 *   2. Artists overlay
 *   3. Player experience (with a video loaded)
 *   4. Admin dashboard
 *   5. Categories overlay
 *   6. Search overlay (with results)
 *   7. New videos overlay
 *   8. Top 100 overlay
 *   9. Magazine landing
 *  10. Mobile shell (homepage)
 */

const DEV_SERVER_URL = "http://127.0.0.1:3000";

test.describe("visual regression — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("01 — homepage shell + hero grid", async ({ page }) => {
    await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
    // Let hero grid animations settle
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("homepage-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("02 — artists overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/artists`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("artists-overlay-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("03 — categories overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/categories`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("categories-overlay-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("04 — search overlay with results", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/search?q=metal`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("search-overlay-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("05 — new videos overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("new-videos-overlay-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("06 — top 100 overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/top100`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("top100-overlay-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("07 — magazine landing", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/magazine`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("magazine-landing-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("08 — admin dashboard", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/admin`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    // Admin may show login/auth wall — that's fine, we're testing the visual
    // integrity of whatever renders at /admin
    await expect(page).toHaveScreenshot("admin-dashboard-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("09 — player experience with video", async ({ page }) => {
    // Load homepage, then navigate to a known working video
    await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
    // Click a video card to open player overlay
    const videoCard = page.locator(".heroGridItemCard").first();
    if (await videoCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await videoCard.click();
      await page.waitForTimeout(3000);
    }
    await expect(page).toHaveScreenshot("player-experience-desktop.png", {
      fullPage: false,
      maxDiffPixels: 300,
    });
  });
});

test.describe("visual regression — mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("10 — mobile homepage shell", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/m`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("homepage-mobile.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });
});
