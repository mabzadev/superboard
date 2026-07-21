import { test, expect } from "@playwright/test";
import { setupApiMocks } from "../../fixtures/api-mocks";
import { TEST_USER } from "../../fixtures/test-data";

test.describe("Login", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test("shows login form with email and password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /login/i })).toBeVisible();
  });

  test("successful login redirects to dashboard", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email").fill(TEST_USER.email);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: /login/i }).click();

    await page.waitForURL("**/dashboard**", { timeout: 10_000 });
    await expect(page).toHaveURL(/dashboard/);
  });

  test("invalid credentials shows error notification", async ({ page }) => {
    // Override the token endpoint to return an error
    await page.route("**/oauth/token", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_grant" }),
      });
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("wrong@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: /login/i }).click();

    await expect(page.getByText(/credentials are invalid/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("respects backTo redirect parameter", async ({ page }) => {
    await page.goto("/login?backTo=%2Fsettings");
    await page.getByLabel("Email").fill(TEST_USER.email);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: /login/i }).click();

    await page.waitForURL("**/settings**", { timeout: 10_000 });
    await expect(page).toHaveURL(/settings/);
  });

  test("shows OTP field when 2FA is required after login attempt", async ({
    page,
  }) => {
    let firstAttempt = true;
    await page.route("**/api/auth/token", async (route) => {
      if (firstAttempt) {
        firstAttempt = false;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ requires_otp: true }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "test-token",
            refresh_token: "test-refresh",
            user: { id: 1, email: "test@example.com", name: "Test User" },
          }),
        });
      }
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill("test@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: /login/i }).click();

    await expect(page.getByLabel("OTP")).toBeVisible({ timeout: 5000 });
  });

  test("sign in button is disabled with empty fields", async ({ page }) => {
    await page.goto("/login");
    const signInButton = page.getByRole("button", { name: /login/i });
    await expect(signInButton).toBeDisabled();
  });

  test("SSO buttons are visible", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page
        .getByRole("button", { name: /google/i })
        .or(page.getByText(/google/i))
    ).toBeVisible();
  });
});
