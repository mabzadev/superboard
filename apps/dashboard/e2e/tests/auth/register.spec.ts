import { test, expect } from "@playwright/test";
import { setupApiMocks } from "../../fixtures/api-mocks";

test.describe("Register", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);

    // Mock registration endpoint
    await page.route("**/api/v1/users", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ user: { id: "new-user-001" } }),
        });
      }
    });
  });

  test("shows register type selection page", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText(/create.*account/i)).toBeVisible();
  });

  test("email registration form has required fields", async ({ page }) => {
    await page.goto("/register/with_email");
    await expect(page.getByLabel(/name/i).first()).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(
      page
        .getByLabel(/^password$/i)
        .or(page.getByPlaceholder(/password/i).first())
    ).toBeVisible();
  });

  test("register button is disabled without valid input", async ({ page }) => {
    await page.goto("/register/with_email");
    const registerButton = page.getByRole("button", {
      name: /create|register|sign up/i,
    });
    await expect(registerButton).toBeDisabled();
  });

  test("shows password requirements checklist", async ({ page }) => {
    await page.goto("/register/with_email");

    // Focus on password field to reveal checklist
    const passwordField = page
      .getByLabel(/^password$/i)
      .or(page.getByPlaceholder(/password/i).first());
    await passwordField.click();
    await passwordField.fill("Te");

    // Check for password requirements visibility
    await expect(
      page
        .getByText(/character/i)
        .or(page.getByText(/uppercase|lowercase|special|number/i).first())
    ).toBeVisible({ timeout: 3000 });
  });
});
