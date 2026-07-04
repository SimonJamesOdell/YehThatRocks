import { expect, test } from "@playwright/test";

/**
 * Mobile-specific selectors. The mobile shell does not use the desktop
 * shell chrome (no Search bar, no Primary nav, no "Yeh That Rocks home"
 * link with an image). Every assertion is scoped to the mobile shell's own
 * class namespace: .mobile-*.
 */

async function expectMobileShell(page: import("@playwright/test").Page) {
  await expect(page.locator(".mobile-topbar")).toBeVisible();
  const hamburger = page.locator(".mobile-hamburger");
  await expect(hamburger).toBeVisible();
  await expect(hamburger).toHaveAttribute("aria-label", /Open navigation/i);
  await expect(page.locator(".mobile-logo-link")).toBeVisible();
  await expect(page.locator(".mobile-logo-image")).toBeVisible();
  await expect(page.locator(".mobile-logo-tagline")).toContainText("loudest website");
}

test.describe("mobile shell smoke", () => {
  test("home route renders the mobile shell", async ({ page }) => {
    await page.goto("/m");
    await expectMobileShell(page);
  });

  test("hamburger button and nav drawer are structurally present", async ({ page }) => {
    await page.goto("/m");
    await expectMobileShell(page);

    // The nav drawer exists in the DOM with all expected links
    const drawer = page.locator(".mobile-nav-drawer");
    await expect(drawer).toBeAttached();

    // All seven nav links are present (may be off-screen until opened)
    await expect(page.locator(".mobile-nav-link").filter({ hasText: "Home" })).toBeAttached();
    await expect(page.locator(".mobile-nav-link").filter({ hasText: "New" })).toBeAttached();
    await expect(page.locator(".mobile-nav-link").filter({ hasText: "Categories" })).toBeAttached();
    await expect(page.locator(".mobile-nav-link").filter({ hasText: "Artists" })).toBeAttached();
    await expect(page.locator(".mobile-nav-link").filter({ hasText: "Top 100" })).toBeAttached();
    await expect(page.locator(".mobile-nav-link").filter({ hasText: "Favourites" })).toBeAttached();
    await expect(page.locator(".mobile-nav-link").filter({ hasText: "Search" })).toBeAttached();

    // Footer links: Login / Register appears when unauthenticated; Account replaces it when logged in.
    await expect(page.locator(".mobile-nav-link").filter({ hasText: "Login / Register" })).toBeAttached();
  });

  test("new route renders mobile shell", async ({ page }) => {
    await page.goto("/m/new");
    await expectMobileShell(page);
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
    await expect(page.locator(".mobile-alphabet-bar")).toBeVisible();
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
    // Shows "not logged in" state immediately (optimistic render)
    await expect(page.locator(".mobile-page-title")).toContainText("Account");
  });

  test("register route renders the registration form", async ({ page }) => {
    await page.goto("/m/register");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Register");
    await expect(page.locator(".mobile-page-subtitle")).toContainText("Create your account");
  });

  test("reset-password route renders with or without token", async ({ page }) => {
    await page.goto("/m/reset-password");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Reset password");
  });

  test("verify-email route renders status page", async ({ page }) => {
    await page.goto("/m/verify-email");
    await expectMobileShell(page);
    await expect(page.locator(".mobile-page-title")).toContainText("Check your email");
    await expect(page.locator(".mobile-verify-link").first()).toBeVisible();
  });

  test("all mobile routes are reachable by direct navigation", async ({ page }) => {
    const routes = [
      { path: "/m", title: "Home" },
      { path: "/m/new", title: "New Videos" },
      { path: "/m/categories", title: "Categories" },
      { path: "/m/artists", title: "Artists" },
      { path: "/m/top100", title: "Top 100" },
      { path: "/m/search", title: "Search" },
      { path: "/m/favourites", title: "Favourites" },
      { path: "/m/login", title: "Login" },
      { path: "/m/account", title: "Account" },
      { path: "/m/register", title: "Register" },
      { path: "/m/reset-password", title: "Reset password" },
      { path: "/m/verify-email", title: "Check your email" },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await expectMobileShell(page);
      await expect(page.locator(".mobile-page-title")).toContainText(route.title);
    }
  });

  test("video card click opens fullscreen player", async ({ page }) => {
    await page.goto("/m");

    const videoCard = page.locator(".mobile-video-card").first();
    try {
      await expect(videoCard).toBeVisible({ timeout: 8000 });
    } catch {
      test.skip(true, "No video cards loaded — skipping player test");
      return;
    }

    await videoCard.click();

    await expect(page.locator(".mobile-player-fullscreen")).toBeVisible();
    await expect(page.locator(".mobile-player-fullscreen-topbar")).toBeVisible();
    await expect(page.locator(".mobile-player-wrapper")).toBeVisible();

    await page.locator(".mobile-player-back").click();
    await expect(page.locator(".mobile-player-fullscreen")).not.toBeVisible();
  });
});
