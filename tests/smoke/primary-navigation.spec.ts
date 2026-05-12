import { expect, test } from "@playwright/test";
import { closeOverlayAndExpectHome, expectOverlayRoute, expectShellChrome } from "./helpers";

const navLinks = [
  { label: "New", routePrefix: "new" },
  { label: "Categories", routePrefix: "categories" },
  { label: "Artists", routePrefix: "artists" },
  { label: "Top 100", routePrefix: "top100" },
  { label: "Favourites", routePrefix: "favourites" },
  { label: "Playlists", routePrefix: "playlists" },
  { label: "History", routePrefix: "history" },
  { label: "Account", routePrefix: "account" },
] as const;

test.describe("primary navigation coverage", () => {
  for (const nav of navLinks) {
    test(`primary nav link ${nav.label} opens overlay and keeps shell`, async ({ page }) => {
      await page.goto("/");
      await expectShellChrome(page);

      await page.getByRole("link", { name: nav.label, exact: true }).click();

      await expectOverlayRoute(page, nav.routePrefix);
      await closeOverlayAndExpectHome(page);
    });
  }

  test("search controls accept input and show actionable state", async ({ page }) => {
    await page.goto("/");
    await expectShellChrome(page);

    const searchInput = page.getByRole("searchbox", { name: /Search/i });
    await searchInput.fill("black metal");

    await page.getByRole("button", { name: "Search" }).click();
    await expect(searchInput).toHaveValue("black metal");
    await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  });
});
