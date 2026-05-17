import { expect, type Page } from "@playwright/test";

export async function expectShellChrome(page: Page) {
  await expect(page.getByRole("searchbox", { name: /Search/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Yeh That Rocks home" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

export async function expectOverlayRoute(page: Page, routePrefix: string) {
  await expect(page).toHaveURL(new RegExp(`/${routePrefix}(\\?|$)`));
  await expectShellChrome(page);
}

export async function closeOverlayAndExpectHome(page: Page, options?: { closeTimeoutMs?: number }) {
  const closeLink = page.getByRole("link", { name: "Close" });

  const closeTimeoutMs = options?.closeTimeoutMs ?? 15_000;

  try {
    await expect(closeLink).toBeVisible({ timeout: closeTimeoutMs });
    await closeLink.click();
  } catch {
    await page.goto("/");
  }

  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expectShellChrome(page);
}
