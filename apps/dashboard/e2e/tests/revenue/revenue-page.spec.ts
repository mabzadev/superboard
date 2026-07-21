import { test, expect } from "../../fixtures/base-fixtures";

test.describe("Revenue Page", () => {
  test("loads revenue page", async ({ authenticatedPage: page }) => {
    await page.goto("/revenue");

    // Should show revenue page content
    await expect(page.getByText(/revenue/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
