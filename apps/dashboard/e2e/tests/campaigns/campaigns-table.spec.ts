import { test, expect } from "../../fixtures/base-fixtures";
import { TEST_CAMPAIGN } from "../../fixtures/test-data";

test.describe("Campaigns Table", () => {
  test("loads and displays campaigns", async ({ authenticatedPage: page }) => {
    await page.goto("/dynamic_links/campaigns");

    await expect(page.getByText(TEST_CAMPAIGN.name)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("create campaign button opens dialog", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/dynamic_links/campaigns");

    const createButton = page.getByRole("button", {
      name: /create.*campaign|new.*campaign/i,
    });
    await expect(createButton).toBeVisible({ timeout: 10_000 });
    await createButton.click();

    // Dialog should appear with name input
    await expect(
      page.getByPlaceholder(/name/i).or(page.getByLabel(/name/i))
    ).toBeVisible({ timeout: 5000 });
  });
});
