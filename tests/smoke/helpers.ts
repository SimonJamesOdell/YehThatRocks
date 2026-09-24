import { expect, type Page } from "@playwright/test";

export async function expectShellChrome(page: Page) {
  await expect(page.getByRole("searchbox", { name: /Search/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Yeh That Rocks home" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

export async function seedWelcomeModalDismissed(page: Page) {
  // The anonymous first-visit "Welcome to YehThatRocks" onboarding modal
  // intercepts pointer events and makes shell/navigation tests flaky. Pre-seed
  // its permanent-dismissal flag so it never opens in suites that don't test
  // onboarding. (onboarding-flow.spec.ts tests the modal and must NOT use this.)
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ytr:welcome-dismissed", "1");
    } catch {
      // localStorage can be unavailable in some contexts; ignore.
    }
  });
}

export async function expectOverlayRoute(page: Page, routePrefix: string) {
  await expect(page).toHaveURL(new RegExp(`/${routePrefix}(\\?|$)`));
  await expectShellChrome(page);
}

export async function closeOverlayAndExpectHome(page: Page, options?: { closeTimeoutMs?: number }) {
  // exact: true so a "One Step Closer" style watch-next card can't be mistaken
  // for the overlay Close control (accessible-name matching is a substring match
  // by default and would hit "Closer").
  const closeLink = page.getByRole("link", { name: "Close", exact: true });

  const closeTimeoutMs = options?.closeTimeoutMs ?? 15_000;

  const navigateHomeSafely = async () => {
    if (page.isClosed()) {
      return;
    }

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (page.isClosed()) {
        return;
      }
      throw error;
    }
  };

  try {
    await expect(closeLink).toBeVisible({ timeout: closeTimeoutMs });
    await Promise.all([
      page.waitForURL(/\/(\?.*)?$/, { timeout: closeTimeoutMs }),
      closeLink.click(),
    ]);
  } catch {
    await navigateHomeSafely();
  }

  if (page.isClosed()) {
    return;
  }

  await expect(page).toHaveURL(/\/(\?.*)?$/);
  await expectShellChrome(page);
}
