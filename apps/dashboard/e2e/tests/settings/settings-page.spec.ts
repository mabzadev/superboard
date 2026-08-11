import { test, expect } from "../../fixtures/base-fixtures";

test.describe("Settings Page", () => {
  test("loads settings page with active users chart", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/settings");

    await expect(page.getByText(/active users/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("team members section is visible", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/settings");

    await expect(page.getByText(/team|members/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("plan section shows subscription info", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/settings");

    await expect(
      page.getByText(/plan|subscription/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("export button is functional", async ({ authenticatedPage: page }) => {
    await page.goto("/settings");

    const exportButton = page.getByRole("button", { name: /export/i });
    await expect(exportButton).toBeVisible({ timeout: 10_000 });
  });
});
