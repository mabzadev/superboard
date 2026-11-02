import { test, expect } from "../../fixtures/emdash-browser";

const THEME_DETAIL_URL_PATTERN = /\/themes\/marketplace\/minimal-blog/;
const THEME_BROWSE_URL_PATTERN = /\/themes\/marketplace\/?$/;

test.describe("Theme Marketplace", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Browse page", () => {
		test("renders theme cards", async ({ admin, page }) => {
			await admin.goto("/themes/marketplace");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.getByText("Minimal Blog").first()).toBeVisible({ timeout: 15000 });
			await expect(page.getByText("Portfolio Pro").first()).toBeVisible();
		});

		test("theme cards show name, author, and description", async ({ admin, page }) => {
			await admin.goto("/themes/marketplace");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.getByText("Minimal Blog").first()).toBeVisible({ timeout: 15000 });

			await expect(page.getByText("EmDash Labs").first()).toBeVisible();
			await expect(page.getByText("A clean, minimal blog theme.")).toBeVisible();
		});

		test("search filters themes by name", async ({ admin, page }) => {
			await admin.goto("/themes/marketplace");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.getByText("Minimal Blog").first()).toBeVisible({ timeout: 15000 });

			const searchInput = page.getByPlaceholder("Search themes...");
			await searchInput.fill("nonexistent-theme-xyz");

			await page.waitForTimeout(1000);

			await expect(page.getByText("Minimal Blog").first()).not.toBeVisible({ timeout: 5000 });
			await expect(page.getByText("Portfolio Pro")).not.toBeVisible();
		});
	});

	test.describe("Theme detail page", () => {
		test("navigates to detail page on click", async ({ admin, page }) => {
			await admin.goto("/themes/marketplace");
			await admin.waitForShell();
			await admin.waitForLoading();

			const themeLink = page.locator("a", { hasText: "Minimal Blog" }).first();
			await expect(themeLink).toBeVisible({ timeout: 15000 });
			await themeLink.click();

			await expect(page).toHaveURL(THEME_DETAIL_URL_PATTERN, { timeout: 10000 });
		});

		test("detail page shows theme info", async ({ admin, page }) => {
			await admin.goto("/themes/marketplace/minimal-blog");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("h1").first()).toContainText("Minimal Blog", {
				timeout: 15000,
			});

			await expect(page.getByText("EmDash Labs").first()).toBeVisible();

			await expect(page.getByText("A clean, minimal blog theme.")).toBeVisible();
		});

		test("back link navigates to browse", async ({ admin, page }) => {
			await admin.goto("/themes/marketplace/minimal-blog");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("h1").first()).toContainText("Minimal Blog", {
				timeout: 15000,
			});

			const backLink = page.locator("a", { hasText: "Themes" }).first();
			await backLink.click();

			await expect(page).toHaveURL(THEME_BROWSE_URL_PATTERN, { timeout: 10000 });
		});
	});
});
