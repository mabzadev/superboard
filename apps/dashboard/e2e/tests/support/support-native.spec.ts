import { test, expect } from "../../fixtures/base-fixtures";
import { setupSupportMocks } from "../../fixtures/support-mocks";

const pages = [
  ["/support/inbox", "Inbox"],
  ["/support/contacts", "Contacts"],
  ["/support/workforce", "Workforce"],
  ["/support/channels", "Channels"],
  ["/support/automations", "Automations"],
  ["/support/proactive-support", "Proactive Support"],
  ["/support/help-center", "Help Center"],
  ["/support/captain", "Captain"],
  ["/support/integrations", "Integrations"],
  ["/support/reports", "Reports"],
  ["/support/settings", "Settings"],
] as const;

test.describe("native Support navigation", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupSupportMocks(authenticatedPage);
  });

  for (const [path, title] of pages) {
    test(`${title} loads as a complete Support surface`, async ({
      authenticatedPage: page,
    }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: title, level: 1 })
      ).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/coming soon|migration|legacy/i)).toHaveCount(
        0
      );
    });
  }

  test("the Support subnavigation exposes exactly the eleven native pages", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/support/inbox");
    const navigation = page.getByRole("navigation", { name: "Support pages" });
    await expect(navigation.getByRole("link")).toHaveCount(11);
    await expect(
      navigation.getByRole("link").allTextContents()
    ).resolves.toEqual(pages.map(([, title]) => title));
  });

  test("old Support paths redirect without an intermediate screen", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/support/quality");
    await page.waitForURL("**/support/reports");
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 })
    ).toBeVisible();

    await page.goto("/support/configuration");
    await page.waitForURL("**/support/settings");
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 })
    ).toBeVisible();
  });
});
