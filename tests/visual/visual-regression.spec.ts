import { expect, test } from "@playwright/test";

/**
 * Visual regression tests for yehthatrocks key pages.
 *
 * Baseline screenshots are stored in tests/visual/snapshots/.
 * Run `npx playwright test --config playwright.config.ts --project=visual` to
 * generate or update baselines. When a page changes visually, the test fails
 * with a diff image — review and update the baseline if the change is intentional.
 *
 * Masking: dynamic content areas (video cards, thumbnails, search results,
 * leaderboard rows) are masked so that database updates don't cause false
 * positives. Only the static shell is verified — header, navigation, player
 * chrome, overlay frames, and layout structure.
 */

// ── Mask selectors for dynamic content ──────────────────────────────────────

const DYNAMIC_CONTENT = [
  ".heroGridItemCard",
  ".catalogCard",
  ".leaderboardCard",
  ".magazineArticleCard",
  ".relatedCard",
  ".categoryCard",
  ".artistResultCard",
  ".forumThreadCard",
  ".searchResultCard",
];

const DEV_SERVER_URL = "http://127.0.0.1:3000";

function maskLocators(page: import("@playwright/test").Page, extra: string[] = []): import("@playwright/test").Locator[] {
  return [...DYNAMIC_CONTENT, ...extra].map((sel) => page.locator(sel));
}

test.describe("visual regression — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("01 — homepage shell + hero grid", async ({ page }) => {
    await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("homepage-desktop.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("02 — artists overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/artists`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("artists-overlay-desktop.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page, [".artistAlphabetButton"]),
    });
  });

  test("03 — categories overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/categories`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("categories-overlay-desktop.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("04 — search overlay with results", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/search?q=metal`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("search-overlay-desktop.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("05 — new videos overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("new-videos-overlay-desktop.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("06 — top 100 overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/top100`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("top100-overlay-desktop.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("07 — magazine landing", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/magazine`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("magazine-landing-desktop.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("08 — admin dashboard", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/admin`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("admin-dashboard-desktop.png", {
      fullPage: false, maxDiffPixels: 200,
    });
  });

  test("09 — player experience with video", async ({ page }) => {
    await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
    const videoCard = page.locator(".heroGridItemCard").first();
    if (await videoCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      await videoCard.click();
      await page.waitForTimeout(3000);
    }
    await expect(page).toHaveScreenshot("player-experience-desktop.png", {
      fullPage: false, maxDiffPixels: 300,
      mask: maskLocators(page, [".endedChoiceCard"]),
    });
  });
});

test.describe("visual regression — mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("10 — mobile homepage shell", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/m`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("homepage-mobile.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });
});

test.describe("visual regression — tablet", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("tablet — homepage", async ({ page }) => {
    await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("homepage-tablet.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("tablet — artists overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/artists`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("artists-overlay-tablet.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("tablet — categories overlay", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/categories`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot("categories-overlay-tablet.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });

  test("tablet — mobile shell", async ({ page }) => {
    await page.goto(`${DEV_SERVER_URL}/m`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("homepage-mobile-tablet.png", {
      fullPage: false, maxDiffPixels: 200,
      mask: maskLocators(page),
    });
  });
});
