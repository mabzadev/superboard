import { test, expect } from "../../fixtures/base-fixtures";
import { TEST_PROJECT } from "../../fixtures/test-data";

/**
 * Variant: the user closes the popup while pending, switches to another tab
 * (document hidden -> interval ticks are skipped), the backend verifies the
 * domain meanwhile, then the user returns to the tab. The card must refetch
 * on visibility regain (refetchOnWindowFocus) and clear the Pending bubble.
 */

const pendingRow = {
  hostname: "links.acme.com",
  purpose: "primary",
  status: "pending",
  ssl_status: "pending_validation",
  ssl_validation_txt_records: [
    { name: "_acme-challenge.links.acme.com", value: "tok" },
  ],
  ownership_verification_txt_name: "_cf-custom-hostname.links.acme.com",
  ownership_verification_txt_value: "uuid",
  verification_errors: null,
  source: "saas",
  cname_target: "x.cdn.example",
};

const activeRow = {
  ...pendingRow,
  status: "active",
  ssl_status: "active",
  ssl_validation_txt_records: [],
  ownership_verification_txt_name: null,
  ownership_verification_txt_value: null,
};

test.describe("stale pending bubble — hidden tab variant", () => {
  test("bubble updates after returning to a hidden tab", async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(240_000);

    const state = { status: "pending" as "pending" | "active" };

    await page.route(
      `**/api/v1/projects/${TEST_PROJECT.id}/custom_domains`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            custom_domains: [
              state.status === "pending" ? pendingRow : activeRow,
            ],
          }),
        });
      }
    );
    await page.route(
      `**/api/v1/projects/${TEST_PROJECT.id}/custom_domain`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            custom_domain: state.status === "pending" ? pendingRow : activeRow,
          }),
        });
      }
    );
    await page.route(
      `**/api/v1/projects/${TEST_PROJECT.id}/custom_domains/preflight*`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            hostname: "links.acme.com",
            cname_expected: "x.cdn.example",
            cname_actual: "x.cdn.example",
            cname_matches: true,
            checked_at: "2026-06-12T00:00:00Z",
          }),
        });
      }
    );
    await page.route(
      `**/api/v1/projects/${TEST_PROJECT.id}/migration_source`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ migration_source: null }),
        });
      }
    );

    await page.goto("/link_behaviour/domain");
    await expect(page.getByText("Pending", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Open + close the popup while pending.
    await page.getByRole("button", { name: /view setup/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // User switches to another tab: emulate document becoming hidden.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Backend verifies while the tab is hidden; wait past two poll intervals
    // so any skipped ticks are observable.
    state.status = "active";
    await page.waitForTimeout(100_000);

    // Bubble must still be Pending (ticks skipped while hidden is fine).
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();

    // User returns to the tab.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      Object.defineProperty(document, "hidden", {
        value: false,
        configurable: true,
      });
      // Real visibilitychange events bubble from document to window.
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });

    // refetchOnWindowFocus should reconcile quickly.
    await expect(page.getByText("Pending", { exact: true })).toBeHidden({
      timeout: 10_000,
    });
  });
});
