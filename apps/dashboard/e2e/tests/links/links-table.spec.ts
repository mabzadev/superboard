import { test, expect } from "../../fixtures/base-fixtures";
import { TEST_LINK } from "../../fixtures/test-data";

test.describe("Links Table", () => {
  test("loads and displays links", async ({ authenticatedPage: page }) => {
    await page.goto("/dynamic_links/links");

    await expect(page.getByText(TEST_LINK.name)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("search input is functional", async ({ authenticatedPage: page }) => {
    await page.goto("/dynamic_links/links");

    const searchInput = page.getByPlaceholder(/search/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill("test");
  });

  test("create link button opens dialog", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/dynamic_links/links");

    const createButton = page.getByRole("button", {
      name: /create.*link|new.*link/i,
    });
    await expect(createButton).toBeVisible({ timeout: 10_000 });
    await createButton.click();

    // Dialog should appear
    await expect(
      page.getByText(/create.*link/i).or(page.getByRole("dialog"))
    ).toBeVisible({ timeout: 5000 });
  });

  test("active/archived toggle works", async ({ authenticatedPage: page }) => {
    await page.goto("/dynamic_links/links");

    // Look for active/archived tabs or toggle
    const archivedTab = page.getByText(/archived/i);
    if (await archivedTab.isVisible()) {
      await archivedTab.click();
      // Should still show the table (possibly empty)
      await expect(
        page.getByRole("table").or(page.getByText(/no.*links/i))
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
