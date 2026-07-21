import { test, expect } from "@playwright/test";
import { setupApiMocks } from "../../fixtures/api-mocks";

test.describe("Password Reset", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);

    await page.route("**/api/v1/users/reset_password", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Reset link sent" }),
      });
    });
  });

  test("shows reset password form", async ({ page }) => {
    await page.goto("/reset_password");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /send|reset/i })
    ).toBeVisible();
  });

  test("shows success message after valid email submission", async ({
    page,
  }) => {
    await page.goto("/reset_password");
    await page.getByLabel(/email/i).fill("test@example.com");
    await page.getByRole("button", { name: /send|reset/i }).click();

    await expect(page.getByText(/link.*sent|check.*email/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("send button is disabled with invalid email", async ({ page }) => {
    await page.goto("/reset_password");
    await page.getByLabel(/email/i).fill("not-an-email");

    const button = page.getByRole("button", { name: /send|reset/i });
    await expect(button).toBeDisabled();
  });
});
