import { test, expect } from "../../fixtures/base-fixtures";
import { TEST_PROJECT } from "../../fixtures/test-data";

test.describe("Identity administration", () => {
  test("loads the project configuration without triggering the route error boundary", async ({
    authenticatedPage: page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.route(
      `**/api/v1/identity-admin/projects/${TEST_PROJECT.id}/api/v1/**`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            users: [],
            userAttributes: [],
            roles: [],
            apps: [],
            appBanners: [],
            scopes: [],
            orgs: [],
            emailLogs: [],
            smsLogs: [],
            signInLogs: [],
            idps: [],
            count: 0,
          }),
        });
      }
    );
    await page.route(
      `**/api/v1/identity-admin/projects/${TEST_PROJECT.id}`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            configs: {
              AUTH_SERVER_URL: "https://auth.example.test",
              SUPPORTED_LOCALES: ["en", "fr"],
              ENABLE_LOCALE_SELECTOR: true,
              ENABLE_NAMES: true,
              ENABLE_SIGN_UP: true,
              ENABLE_PASSWORD_SIGN_IN: true,
              ENABLE_PASSWORD_RESET: true,
              ENABLE_USER_APP_CONSENT: true,
              ENABLE_EMAIL_VERIFICATION: true,
              ENABLE_ORG: true,
              ENABLE_USER_ATTRIBUTE: true,
              ENABLE_SAML_SSO_AS_SP: true,
              ENABLE_APP_BANNER: true,
              ENABLE_EMAIL_LOG: true,
              ENABLE_SMS_LOG: true,
              ENABLE_SIGN_IN_LOG: true,
              OIDC_AUTH_PROVIDERS: [],
            },
          }),
        });
      }
    );
    await page.route(
      `**/api/v1/identity-admin/projects/${TEST_PROJECT.id}/api/v1/apps`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ apps: [] }),
        });
      }
    );

    await page.goto("/identity/en/dashboard");

    await expect(page.getByRole("heading", { name: "Identity" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("OPENID CONFIGURATION")).toBeVisible();
    await expect(page.getByText("Something went wrong!")).toHaveCount(0);

    for (const path of [
      "/identity/en/users",
      "/identity/en/user-attributes",
      "/identity/en/roles",
      "/identity/en/apps",
      "/identity/en/scopes",
      "/identity/en/orgs",
      "/identity/en/logs",
      "/identity/en/saml",
      "/identity/en/account",
    ]) {
      await test.step(`renders ${path}`, async () => {
        await page.goto(path);
        await expect(
          page.getByRole("heading", { name: "Identity" })
        ).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText("Something went wrong!")).toHaveCount(0);
      });
    }

    expect(pageErrors).toEqual([]);
  });
});
