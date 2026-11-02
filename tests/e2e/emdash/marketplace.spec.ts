import { test, expect } from "../../fixtures/emdash-browser";

const PLUGIN_DETAIL_URL_PATTERN = /\/plugins\/marketplace\/seo-toolkit/;
const MARKETPLACE_BROWSE_URL_PATTERN = /\/plugins\/marketplace\/?$/;

test.describe("Plugin Marketplace", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Browse page", () => {
		test("renders marketplace page with plugin cards", async ({ admin, page }) => {
			await admin.goto("/plugins/marketplace");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.getByText("SEO Toolkit")).toBeVisible({ timeout: 15000 });
		});

		test("plugin card shows name, author, version", async ({ admin, page }) => {
			await admin.goto("/plugins/marketplace");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.getByText("SEO Toolkit")).toBeVisible({ timeout: 15000 });

			const seoCard = page.locator("a", { hasText: "SEO Toolkit" }).first();

			await expect(seoCard.getByText("Labs")).toBeVisible();

			await expect(seoCard.getByText("v2.1.0")).toBeVisible();
		});

		test("search filters plugins by name", async ({ admin, page }) => {
			await admin.goto("/plugins/marketplace");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.getByText("SEO Toolkit")).toBeVisible({ timeout: 15000 });

			const searchInput = page.getByPlaceholder("Search plugins...");
			await searchInput.fill("nonexistent-plugin-xyz");

			await page.waitForTimeout(1000);

			await expect(page.getByText("SEO Toolkit")).not.toBeVisible({ timeout: 5000 });
		});
	});

	test.describe("Plugin detail page", () => {
		test("navigates to detail page on card click", async ({ admin, page }) => {
			await admin.goto("/plugins/marketplace");
			await admin.waitForShell();
			await admin.waitForLoading();

			const seoCard = page.locator("a", { hasText: "SEO Toolkit" }).first();
			await expect(seoCard).toBeVisible({ timeout: 15000 });

			await seoCard.click();

			await expect(page).toHaveURL(PLUGIN_DETAIL_URL_PATTERN, { timeout: 10000 });
		});

		test("detail page shows plugin info", async ({ admin, page }) => {
			await admin.goto("/plugins/marketplace/seo-toolkit");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("h1").first()).toContainText("SEO Toolkit", { timeout: 15000 });

			await expect(page.getByText("EmDash Labs").first()).toBeVisible();
		});

		test("back link navigates to browse page", async ({ admin, page }) => {
			await admin.goto("/plugins/marketplace/seo-toolkit");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("h1").first()).toContainText("SEO Toolkit", { timeout: 15000 });

			const backLink = page.locator("a", { hasText: "Marketplace" }).first();
			await backLink.click();

			await expect(page).toHaveURL(MARKETPLACE_BROWSE_URL_PATTERN, { timeout: 10000 });
		});
	});
});
