import { expect, test } from "@playwright/test";

/**
 * Interaction state coverage — hover, focus, scroll, and modal states
 * that aren't captured by static page snapshots.
 */

const BASE = "http://127.0.0.1:3000";

test.describe("visual regression — interaction states", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("homepage — primary nav link hover", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Hover over a primary nav link to trigger :hover styles
    const newLink = page.getByRole("link", { name: "New", exact: true });
    if (await newLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newLink.hover({ force: true });
      await page.waitForTimeout(300);
    }

    await expect(page).toHaveScreenshot("interactions/nav-hover-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("homepage — search input focus", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const searchBox = page.getByRole("searchbox", { name: /Search/i });
    if (await searchBox.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchBox.focus();
      await page.waitForTimeout(300);
    }

    await expect(page).toHaveScreenshot("interactions/search-focus-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("homepage — scrolled (sticky header)", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    // Scroll down to trigger sticky header/fixed elements
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot("interactions/scrolled-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("homepage — video card hover", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // Hover a hero grid card to trigger :hover effects
    const card = page.locator(".heroGridItemCard").first();
    if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
      await card.hover();
      await page.waitForTimeout(300);
    }

    await expect(page).toHaveScreenshot("interactions/card-hover-desktop.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

});

test.describe("visual regression — mobile interactions", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile — hamburger menu open", async ({ page }) => {
    await page.goto(`${BASE}/m`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    const hamburger = page.getByRole("button", { name: /menu|open|nav/i }).first();
    if (await hamburger.isVisible({ timeout: 3000 }).catch(() => false)) {
      await hamburger.click();
      await page.waitForTimeout(500);
    }

    await expect(page).toHaveScreenshot("interactions/mobile-menu-open.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });

  test("mobile — scrolled", async ({ page }) => {
    await page.goto(`${BASE}/m`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot("interactions/mobile-scrolled.png", {
      fullPage: false,
      maxDiffPixels: 200,
    });
  });
});
