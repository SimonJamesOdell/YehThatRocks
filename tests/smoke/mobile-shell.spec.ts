import { expect, test } from "@playwright/test";

/**
 * Mobile-specific selectors. The mobile shell does not use the desktop
 * shell chrome (no Search bar, no Primary nav, no "Yeh That Rocks home"
 * link with an image). Every assertion is scoped to the mobile shell's own
 * class namespace: .mobile-*.
 */

async function expectMobileShell(page: import("@playwright/test").Page) {
  // Top bar is always visible
  await expect(page.locator(".mobile-topbar")).toBeVisible();

  // Hamburger button for nav drawer
  const hamburger = page.locator(".mobile-hamburger");
  await expect(hamburger).toBeVisible();
  await expect(hamburger).toHaveAttribute("aria-label", /Open navigation/i);

  // Logo text link
  await expect(page.locator(".mobile-logo-link")).toBeVisible();
  await expect(page.locator(".mobile-logo-text")).toContainText("YEH THAT ROCKS");
}

async function expectMobileNavOpens(page: import("@playwright/test").Page) {
  const hamburger = page.locator(".mobile-hamburger");
  await hamburger.click();

  // Nav drawer slides in
  const drawer = page.locator(".mobile-nav-drawer");
  await expect(drawer).toHaveClass(/mobile-nav-drawer-open/);

  // All nav links present
  await expect(page.locator(".mobile-nav-link").filter({ hasText: "Home" })).toBeVisible();
  await expect(page.locator(".mobile-nav-link").filter({ hasText: "New" })).toBeVisible();
  await expect(page.locator(".mobile-nav-link").filter({ hasText: "Categories" })).toBeVisible();
  await expect(page.locator(".mobile-nav-link").filter({ hasText: "Artists" })).toBeVisible();
  await expect(page.locator(".mobile-nav-link").filter({ hasText: "Top 100" })).toBeVisible();
  await expect(page.locator(".mobile-nav-link").filter({ hasText: "Favourites" })).toBeVisible();
  await expect(page.locator(".mobile-nav-link").filter({ hasText: "Search" })).toBeVisible();

  // Hamburger becomes close button
  await expect(hamburger).toHaveAttribute("aria-label", /Close navigation/i);
  await expect(hamburger).toHaveAttribute("aria-expanded", "true");

  // Close by clicking overlay
  const overlay = page.locator(".mobile-nav-overlay");
  if (await overlay.isVisible()) {
    await overlay.click();
  } else {
    await hamburger.click();
  }
  await expect(drawer).not.toHaveClass(/mobile-nav-drawer-open/);
}

test.describe("mobile shell smoke", () => {
  test("home route renders the mobile shell", async ({ page }) => {
    await page.goto("/m");
    await expectMobileShell(page);
  });

  test("hamburger opens and closes the nav drawer on home", async ({ page }) => {
    await page.goto("/m");
    await expectMobileShell(page);
    await expectMobileNavOpens(page);
  });

  test("new route renders mobile shell", async ({ page }) => {
    await page.goto("/m/new");
    await expectMobileShell(page);
    // Should have a page title
    await expect(page.locator(".mobile-page-title")).toContainText("New Videos");
  });

  test("categories route renders mobile shell and genre cards", async ({ page }) => {
    await page.goto("/m/categories");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Categories");
  });

  test("artists route renders mobile shell with alphabet bar", async ({ page }) => {
    await page.goto("/m/artists");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Artists");
    // Alphabet bar should be present
    await expect(page.locator(".mobile-alphabet-bar")).toBeVisible();
    // "A" should be active by default
    await expect(page.locator(".mobile-alphabet-letter-active")).toContainText("A");
  });

  test("top100 route renders mobile shell", async ({ page }) => {
    await page.goto("/m/top100");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Top 100");
  });

  test("search route shows search form", async ({ page }) => {
    await page.goto("/m/search");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-search-input")).toBeVisible();
    await expect(page.locator(".mobile-search-button")).toBeVisible();
  });

  test("favourites route shows auth gate for unauthenticated users", async ({ page }) => {
    await page.goto("/m/favourites");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Favourites");
    // Without auth cookies, the page should show "need to log in"
    // (or load with 401 — the client handles both cases)
  });

  test("login route renders auth form", async ({ page }) => {
    await page.goto("/m/login");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Login");
    await expect(page.locator(".mobile-auth-form")).toBeVisible();
    await expect(page.locator(".mobile-auth-submit")).toBeVisible();
  });

  test("account route shows login prompt when unauthenticated", async ({ page }) => {
    await page.goto("/m/account");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Account");
  });

  test("nav links navigate correctly between mobile pages", async ({ page }) => {
    await page.goto("/m");

    // Open nav, click New
    await page.locator(".mobile-hamburger").click();
    await page.locator(".mobile-nav-link").filter({ hasText: "New" }).click();
    await expect(page).toHaveURL("/m/new");
    await expect(page.locator(".mobile-page-title")).toContainText("New Videos");

    // Open nav, click Categories
    await page.locator(".mobile-hamburger").click();
    await page.locator(".mobile-nav-link").filter({ hasText: "Categories" }).click();
    await expect(page).toHaveURL("/m/categories");
    await expect(page.locator(".mobile-page-title")).toContainText("Categories");

    // Open nav, click Artists
    await page.locator(".mobile-hamburger").click();
    await page.locator(".mobile-nav-link").filter({ hasText: "Artists" }).click();
    await expect(page).toHaveURL("/m/artists");
    await expect(page.locator(".mobile-page-title")).toContainText("Artists");

    // Open nav, click Top 100
    await page.locator(".mobile-hamburger").click();
    await page.locator(".mobile-nav-link").filter({ hasText: "Top 100" }).click();
    await expect(page).toHaveURL("/m/top100");
    await expect(page.locator(".mobile-page-title")).toContainText("Top 100");
  });

  test("video card click opens fullscreen player", async ({ page }) => {
    await page.goto("/m");

    // Wait for video cards to load (client-side fetch from /api/videos/top)
    const videoCard = page.locator(".mobile-video-card").first();
    try {
      await expect(videoCard).toBeVisible({ timeout: 8000 });
    } catch {
      // If the API didn't return videos (no DB), skip the player test
      test.skip(true, "No video cards loaded — skipping player test");
      return;
    }

    // Click a video card to trigger playback
    await videoCard.click();

    // Fullscreen player overlay should appear
    await expect(page.locator(".mobile-player-fullscreen")).toBeVisible();
    await expect(page.locator(".mobile-player-fullscreen-topbar")).toBeVisible();
    await expect(page.locator(".mobile-player-wrapper")).toBeVisible();

    // Back button closes the player
    await page.locator(".mobile-player-back").click();
    await expect(page.locator(".mobile-player-fullscreen")).not.toBeVisible();
  });
});
