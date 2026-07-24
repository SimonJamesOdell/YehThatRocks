import { expect, test } from "@playwright/test";
import { expectShellChrome } from "./helpers";

test.describe("onboarding flow", () => {
  test.beforeEach(async ({ page }) => {
    // Clear onboarding state so the welcome modal always appears.
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("ytr:welcome-dismissed");
      localStorage.removeItem("ytr:genre-preferences");
    });
  });

  test("welcome modal Phase 1 renders genre cards and transitions to Phase 2", async ({ page }) => {
    await page.goto("/");
    await expectShellChrome(page);

    // Phase 1: welcome modal is visible with genre cards.
    const modal = page.locator(".welcomeModal");
    await expect(modal).toBeVisible();

    // Genre grid should have at least one card.
    const cards = page.locator(".welcomeModalCard");
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Toggle a genre off (deselect it).
    const firstCard = cards.first();
    await firstCard.click();
    await expect(firstCard).toHaveClass(/welcomeModalCard--deselected/);

    // Click Continue to go to Phase 2.
    await page.locator(".welcomeModalGetStarted").click();

    // Phase 2: account options should be visible.
    await expect(page.locator(".welcomeModalAccountOptions")).toBeVisible();
    await expect(page.locator(".welcomeModalAccountButton--primary")).toContainText("Create Anonymous Account");
    await expect(page.locator(".welcomeModalAccountButton--secondary")).toContainText("Register with Email");
    await expect(page.locator(".welcomeModalAccountButton--ghost")).toContainText("Skip");
  });

  test("Create Anonymous Account opens AnonymousSignupModal, NOT AuthModal", async ({ page }) => {
    await page.goto("/");

    // Navigate to Phase 2.
    await page.locator(".welcomeModalGetStarted").click();
    await expect(page.locator(".welcomeModalAccountOptions")).toBeVisible();

    // Click "Create Anonymous Account".
    await page.locator(".welcomeModalAccountButton--primary").click();

    // AnonymousSignupModal should appear.
    await expect(page.locator(".anonymousSignupOverlay")).toBeVisible();

    // AuthModal should NOT be visible.
    await expect(page.locator(".authModal")).not.toBeVisible();

    // Screen name input should have a suggested value.
    const input = page.locator('input[name="anonymousScreenName"]');
    await expect(input).toBeVisible();
    const value = await input.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test("welcome modal can be permanently dismissed", async ({ page }) => {
    await page.goto("/");

    // Check "Don't show again" and close via × button.
    await page.locator(".welcomeModalDontShow input").check();
    await page.locator(".welcomeModalClose").click();

    await expect(page.locator(".welcomeModal")).not.toBeVisible();

    // Reload — modal should not reappear.
    await page.reload();
    await expectShellChrome(page);
    await expect(page.locator(".welcomeModal")).not.toBeVisible();
  });

  test("Skip button dismisses welcome modal without opening auth", async ({ page }) => {
    await page.goto("/");

    // Navigate to Phase 2.
    await page.locator(".welcomeModalGetStarted").click();
    await expect(page.locator(".welcomeModalAccountOptions")).toBeVisible();

    // Click Skip.
    await page.locator(".welcomeModalAccountButton--ghost").click();

    // Welcome modal should be gone, no auth modal should appear.
    await expect(page.locator(".welcomeModal")).not.toBeVisible();
    await expect(page.locator(".authModal")).not.toBeVisible();
    await expect(page.locator(".anonymousSignupOverlay")).not.toBeVisible();
  });
});
