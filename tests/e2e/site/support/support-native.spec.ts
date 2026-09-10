import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";

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
	for (const [path, title] of pages) {
		test(`${title} loads as a complete Support surface`, async ({ authenticatedPage: page }) => {
			await page.goto(path);
			await expect(
				page.getByRole("heading", {
					name: path === "/support/inbox" ? "Support Inbox" : title,
					level: 1,
				}),
			).toBeVisible({
				timeout: 10_000,
			});
			await expect(page.getByText(/coming soon|migration|legacy/i)).toHaveCount(0);
		});
	}

	test("the Support subnavigation exposes exactly the eleven native pages", async ({
		authenticatedPage: page,
	}) => {
		await page.goto("/support/inbox");
		const navigation = page.getByRole("navigation", { name: "Support pages" });
		await expect(navigation.getByRole("link")).toHaveCount(11);
		for (const [path, title] of pages) {
			await expect(navigation.getByRole("link", { name: title, exact: true })).toHaveAttribute(
				"href",
				path,
			);
		}
	});

	test("compatibility Support paths expose the owning quality and configuration surfaces", async ({
		authenticatedPage: page,
	}) => {
		await page.goto("/support/quality");
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("heading", { name: "Quality", level: 1 })).toBeVisible();

		await page.goto("/support/configuration");
		await page.waitForLoadState("networkidle");
		await expect(
			page.getByRole("heading", { name: "Support configuration", level: 1 }),
		).toBeVisible();
	});
});
