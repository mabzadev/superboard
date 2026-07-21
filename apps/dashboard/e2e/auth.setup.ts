import { test as setup } from "@playwright/test";
import { setupApiMocks } from "./fixtures/api-mocks";
import { MOCK_TOKENS, TEST_USER } from "./fixtures/test-data";

const authFile = "e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  await setupApiMocks(page);

  // Inject auth tokens into localStorage
  await page.addInitScript(
    ({ tokens, user }) => {
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      localStorage.setItem(
        "user",
        JSON.stringify({
          id: user.id,
          email: user.email,
          name: user.name,
          roles: [{ instance_id: "inst-test-001", role: "admin" }],
          otp_required_for_login: false,
        })
      );
    },
    { tokens: MOCK_TOKENS, user: TEST_USER }
  );

  // Navigate to trigger the auth state
  await page.goto("/");

  // Save storage state
  await page.context().storageState({ path: authFile });
});
