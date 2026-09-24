import { expect, test } from "@playwright/test";
import { closeOverlayAndExpectHome, expectOverlayRoute, expectShellChrome, seedWelcomeModalDismissed } from "./helpers";

const publicNavLinks = [
  { label: "New", routePrefix: "new" },
  { label: "Categories", routePrefix: "categories" },
  { label: "Artists", routePrefix: "artists" },
  { label: "Top 100", routePrefix: "top100" },
] as const;

// These routes require an authenticated session. For anonymous visitors the
// shell intercepts the click and opens the sign-in modal instead of navigating.
const protectedNavLinks = [
  { label: "Favourites", routePrefix: "favourites" },
  { label: "Playlists", routePrefix: "playlists" },
  { label: "History", routePrefix: "history" },
  { label: "Account", routePrefix: "account" },
] as const;

test.describe("primary navigation coverage", () => {
  test.beforeEach(async ({ page }) => {
    await seedWelcomeModalDismissed(page);
  });

  for (const nav of publicNavLinks) {
    test(`primary nav link ${nav.label} opens overlay and keeps shell`, async ({ page }) => {
      await page.goto("/");
      await expectShellChrome(page);

      await page.getByRole("link", { name: nav.label, exact: true }).click();

      await expectOverlayRoute(page, nav.routePrefix);
      await closeOverlayAndExpectHome(page);
    });
  }

  for (const nav of protectedNavLinks) {
    test(`primary nav link ${nav.label} opens the sign-in modal for anonymous visitors`, async ({ page }) => {
      await page.goto("/");
      await expectShellChrome(page);

      await page.getByRole("link", { name: nav.label, exact: true }).click();

      // Anonymous visitors are intercepted: no navigation, sign-in modal opens.
      await expect(page.getByRole("dialog", { name: "Sign in to Yeh That Rocks" })).toBeVisible();
      await expect(page).toHaveURL(/\/(\?.*)?$/);
    });
  }

  test("search controls accept input and navigate to results", async ({ page }) => {
    await page.goto("/");
    await expectShellChrome(page);

    const searchInput = page.getByRole("searchbox", { name: /Search/i });
    await searchInput.fill("black metal");
    await expect(searchInput).toHaveValue("black metal");

    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?q=black/);
  });
});
