import { test, expect } from "../../fixtures/emdash-browser";

test.describe("WordPress Import", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Page rendering", () => {
		test("displays the import page with heading and step indicator", async ({ admin, page }) => {
			await admin.goto("/import/wordpress");
			await admin.waitForShell();
			await admin.waitForLoading();

			await admin.expectPageTitle("Import from WordPress");

			await expect(
				page.getByText("Import posts, pages, and custom post types from WordPress"),
			).toBeVisible({ timeout: 10000 });
		});

		test("does not crash or show error state", async ({ admin, page }) => {
			await admin.goto("/import/wordpress");
			await admin.waitForShell();
			await admin.waitForLoading();

			await admin.expectPageTitle("Import from WordPress");
			await expect(page.locator("text=Failed to load")).not.toBeVisible();
			await expect(page.locator("text=Something went wrong")).not.toBeVisible();
		});
	});

	test.describe("URL input path", () => {
		test("shows URL input field and Check Site button", async ({ admin, page }) => {
			await admin.goto("/import/wordpress");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("text=Enter your WordPress site URL")).toBeVisible({
				timeout: 10000,
			});

			const urlInput = page.locator('input[placeholder*="yoursite.com"]');
			await expect(urlInput).toBeVisible();

			const checkButton = page.getByRole("button", { name: "Check Site" });
			await expect(checkButton).toBeVisible();
			await expect(checkButton).toBeDisabled();
		});

		test("Check Site button enables when URL is entered", async ({ admin, page }) => {
			await admin.goto("/import/wordpress");
			await admin.waitForShell();
			await admin.waitForLoading();

			const urlInput = page.locator('input[placeholder*="yoursite.com"]');
			await urlInput.fill("https://example.com");

			const checkButton = page.getByRole("button", { name: "Check Site" });
			await expect(checkButton).toBeEnabled();
		});
	});

	test.describe("File upload path", () => {
		test("shows file upload drop zone with Browse button", async ({ admin, page }) => {
			await admin.goto("/import/wordpress");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("text=or upload directly")).toBeVisible({ timeout: 10000 });

			await expect(page.locator("text=Upload WordPress export file")).toBeVisible();
			await expect(page.locator("text=Drag and drop or click to browse")).toBeVisible();

			await expect(page.locator("text=Browse Files")).toBeVisible();

			const fileInput = page.locator('input[type="file"][accept=".xml"]');
			await expect(fileInput).toBeAttached();
		});
	});
});
