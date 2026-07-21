import { test as base } from "@playwright/test";
import { setupApiMocks } from "./api-mocks";
import { createRealAuthState, isRealBackendE2E } from "./real-auth";
import { MOCK_TOKENS, TEST_USER } from "./test-data";

type Fixtures = {
  authenticatedPage: ReturnType<(typeof base)["page"]> extends Promise<infer T>
    ? T
    : never;
};

/**
 * Extended test fixture that provides an authenticated page
 * with API mocks pre-configured.
 */
export const test = base.extend<Fixtures>({
  authenticatedPage: async ({ page, request }, use) => {
    if (isRealBackendE2E) {
      await createRealAuthState(page, request);
      await use(page);
      return;
    }

    // Inject auth tokens into localStorage before navigating
    await setupApiMocks(page);
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

    await use(page);
  },
});

export { expect } from "@playwright/test";
