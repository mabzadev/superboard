import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";

const pages = [
	["/support/inbox", "Inbox"],
	["/support/help-center", "Help Center"],
	["/support/settings", "Settings"],
] as const;

test.describe("native Support navigation", () => {
	for (const [path, title] of pages) {
		test(`${title} loads as a complete Support surface`, async ({ authenticatedPage: page }) => {
			await page.goto(path);
			await expect(
				page.getByRole("heading", {
					name: title,
					level: 1,
				}),
			).toBeVisible({
				timeout: 10_000,
			});
			await expect(page.getByText(/coming soon|migration|legacy/i)).toHaveCount(0);
		});
	}

	test("the Support subnavigation exposes exactly the three main pages", async ({
		authenticatedPage: page,
	}) => {
		await page.goto("/support/inbox");
		const navigation = page.getByRole("navigation", { name: "Support pages" });
		await expect(navigation.getByRole("link")).toHaveCount(3);
		for (const [path, title] of pages) {
			await expect(navigation.getByRole("link", { name: title, exact: true })).toHaveAttribute(
				"href",
				path,
			);
		}
	});

	test("historical reports and settings URLs lead to their owning entry", async ({
		authenticatedPage: page,
	}) => {
		await page.goto("/support/reports");
		await page.waitForURL(
			(url) => url.pathname === "/support/inbox" && url.searchParams.get("section") === "reports",
		);
		await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
		await page.goto("/support/configuration");
		await page.waitForURL((url) => url.pathname === "/support/settings");
		await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
	});
});
