import { test, expect } from "../../fixtures/base-fixtures";
import { TEST_PROJECT } from "../../fixtures/test-data";

/**
 * Repro for: custom-domain popup closed while the domain is pending; the
 * backend later flips the row to active; the card's "Pending" bubble must
 * update without a page reload (list poll is 45s for primary purpose).
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

test.describe("stale pending bubble repro", () => {
  test("bubble updates after popup closed and backend flips to active", async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(180_000);

    const state = { status: "pending" as "pending" | "active" };
    let listCalls = 0;

    await page.route(
      `**/api/v1/projects/${TEST_PROJECT.id}/custom_domains`,
      async (route) => {
        listCalls += 1;
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
            cname_actual: null,
            cname_matches: false,
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

    // Open the popup, then close it while the domain is still pending.
    await page.getByRole("button", { name: /view setup/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();

    // Backend verifies the hostname while the user stays on the screen.
    state.status = "active";
    const callsBefore = listCalls;

    // The primary list poll is 45s — give it one full interval plus slack.
    await expect(page.getByText("Pending", { exact: true })).toBeHidden({
      timeout: 75_000,
    });
    expect(listCalls).toBeGreaterThan(callsBefore);
  });
});
