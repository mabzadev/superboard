import { test, expect } from "../../fixtures/base-fixtures";

test.describe("Messaging Table", () => {
  test("loads messaging page", async ({ authenticatedPage: page }) => {
    await page.goto("/messaging");

    // Should show the messaging page (with table or empty state)
    await expect(
      page
        .getByText(/messages|messaging/i)
        .or(page.getByText(/no.*messages|create.*first/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test("create message button is visible", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/messaging");

    await expect(page.getByRole("button", { name: /create|new/i })).toBeVisible(
      { timeout: 10_000 }
    );
  });
});
