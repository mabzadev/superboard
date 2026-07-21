import { test, expect } from "../../fixtures/base-fixtures";

test.describe("Dashboard", () => {
  test("loads and displays metric cards", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/dashboard");

    // Wait for metrics to load
    await expect(page.getByText(/link views/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("150")).toBeVisible();
  });

  test("date range picker is visible", async ({ authenticatedPage: page }) => {
    await page.goto("/dashboard");

    // The date range picker should be present
    await expect(
      page
        .getByRole("button", { name: /last|date|range/i })
        .or(page.locator("[data-testid='date-range-picker']"))
    ).toBeVisible({ timeout: 10_000 });
  });

  test("top performing links section loads", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/dashboard");

    await expect(page.getByText(/top performing|top links/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
