import { test, expect } from "../../fixtures/base-fixtures";

test.describe("Create Link", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Mock random path
    await page.route(
      "**/api/v1/projects/*/links/random_path",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ path: "random-path-123" }),
        });
      }
    );

    // Mock path availability
    await page.route(
      "**/api/v1/projects/*/links/path_available*",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ available: true }),
        });
      }
    );

    // Mock link creation
    await page.route("**/api/v1/projects/*/links", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            link: {
              id: "new-link-001",
              name: "New Test Link",
              path: "random-path-123",
              url: "https://test.opengrow.io/random-path-123",
            },
          }),
        });
      }
    });

    await page.goto("/dynamic_links/links");
  });

  test("fill details and create link", async ({ authenticatedPage: page }) => {
    // Open create dialog
    const createButton = page.getByRole("button", {
      name: /create.*link|new.*link/i,
    });
    await expect(createButton).toBeVisible({ timeout: 10_000 });
    await createButton.click();

    // Fill in link name
    const nameInput = page
      .getByPlaceholder(/name/i)
      .or(page.getByLabel(/name/i));
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill("My Test Link");

    // The path should auto-populate
    await expect(
      page.getByDisplayValue(/random-path/i).or(page.getByText(/random-path/i))
    ).toBeVisible({ timeout: 5000 });
  });
});
