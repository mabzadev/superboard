import { test, expect } from "../../fixtures/base-fixtures";

test.describe("Sidebar Navigation", () => {
  test("sidebar shows navigation items", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/dashboard");

    // Key navigation items should be visible in sidebar
    await expect(page.getByText(/dashboard/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("navigates to links page", async ({ authenticatedPage: page }) => {
    await page.goto("/dashboard");

    // Click on Links navigation
    const linksNav = page.getByRole("link", { name: /links/i }).first();
    await expect(linksNav).toBeVisible({ timeout: 10_000 });
    await linksNav.click();

    await page.waitForURL("**/dynamic_links/links**", { timeout: 10_000 });
  });

  test("navigates to settings page", async ({ authenticatedPage: page }) => {
    await page.goto("/dashboard");

    const settingsNav = page.getByRole("link", { name: /settings/i }).first();
    await expect(settingsNav).toBeVisible({ timeout: 10_000 });
    await settingsNav.click();

    await page.waitForURL("**/settings**", { timeout: 10_000 });
  });

  test("project switcher shows project name", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/dashboard");

    await expect(page.getByText(/test project/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
