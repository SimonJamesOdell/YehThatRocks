import { expect, test } from "@playwright/test";
import { expectOverlayRoute, expectShellChrome } from "./helpers";

test.describe("core shell smoke", () => {
  test("home route renders the persistent player shell", async ({ page }) => {
    await page.goto("/");

    await expectShellChrome(page);
  });

  test("artists overlay can open and close without losing shell chrome", async ({ page }) => {
    await page.goto("/");
    await expectShellChrome(page);

    await page.goto("/artists");

    await expect(page.getByRole("link", { name: "Close" })).toBeVisible();
    await expectShellChrome(page);

    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expectShellChrome(page);
  });

  test("search opens an overlay route while keeping the player shell available", async ({ page }) => {
    await page.goto("/");
    await expectShellChrome(page);

    await page.goto("/search?q=black");

    await expectOverlayRoute(page, "search");
  });

  test("closing New keeps follow-up navigation functional", async ({ page }) => {
    await page.goto("/");
    await expectShellChrome(page);

    const shell = page.locator("main.shell");
    await expect(shell).not.toHaveClass(/shellDesktopIntroPreload/);

    const chatList = page.locator(".chatList");
    await expect(chatList).toBeVisible();

    await page.getByRole("link", { name: "New", exact: true }).click();
    await expectOverlayRoute(page, "new");

    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expectShellChrome(page);

    // Give dock/overlay close animation time to settle and catch delayed reload regressions.
    await page.waitForTimeout(1600);
    const navigationType = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return nav?.type ?? "";
    });
    expect(navigationType).not.toBe("reload");
    await expect(shell).not.toHaveClass(/shellDesktopIntroPreload/);
    await expect(chatList).toBeVisible();

    await page.getByRole("link", { name: "Categories", exact: true }).click();
    await expectOverlayRoute(page, "categories");
    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(shell).not.toHaveClass(/shellDesktopIntroPreload/);

    await page.getByRole("link", { name: "New", exact: true }).click();
    await expectOverlayRoute(page, "new");
    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(shell).not.toHaveClass(/shellDesktopIntroPreload/);

    await page.getByRole("link", { name: "Artists", exact: true }).click();
    await expectOverlayRoute(page, "artists");
  });

  test("closing New reveals footer promptly during close flow", async ({ page }) => {
    await page.goto("/");
    await expectShellChrome(page);

    const isDesktopUndockFlow = await page.evaluate(() => window.matchMedia("(min-width: 1181px)").matches);
    test.skip(!isDesktopUndockFlow, "Footer undock reveal contract only applies to desktop docked flow");

    await page.getByRole("link", { name: "New", exact: true }).click();
    await expectOverlayRoute(page, "new");

    const closeClickStartedAt = Date.now();
    await page.getByRole("link", { name: "Close" }).click();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await page.waitForFunction(() => {
      const actions = document.querySelector(".playerFooterReserve .primaryActions") as HTMLElement | null;
      if (!actions) {
        return false;
      }
      const style = window.getComputedStyle(actions);
      return style.visibility !== "hidden" && Number.parseFloat(style.opacity || "0") > 0.01;
    }, undefined, { timeout: 1000 });
    const revealLatencyMs = Date.now() - closeClickStartedAt;
    expect(revealLatencyMs).toBeLessThanOrEqual(1500);
    await expectShellChrome(page);
  });
});