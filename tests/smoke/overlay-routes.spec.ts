import { expect, test } from "@playwright/test";
import { closeOverlayAndExpectHome, expectOverlayRoute, expectShellChrome } from "./helpers";

const overlayRoutes = [
  { route: "new" },
  { route: "categories" },
  { route: "artists" },
  { route: "top100" },
  { route: "favourites" },
  { route: "playlists" },
  { route: "history" },
  { route: "account" },
  { route: "search?q=metal" },
] as const;

test.describe("overlay route coverage", () => {
  for (const routeConfig of overlayRoutes) {
    test(`direct route /${routeConfig.route} renders overlay with persistent shell`, async ({ page }) => {
      await page.goto(`/`);
      await expectShellChrome(page);

      await page.goto(`/${routeConfig.route}`);

      const prefix = routeConfig.route.split("?")[0];
      await expectOverlayRoute(page, prefix);
      await closeOverlayAndExpectHome(page);
    });
  }
  
  test("admin overlay close returns to home", async ({ page }) => {
    await page.goto("/");
    await expectShellChrome(page);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin(\?|$)/);
    await expect(page.getByRole("link", { name: "Close" })).toBeVisible();

    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expectShellChrome(page);
  });
});
