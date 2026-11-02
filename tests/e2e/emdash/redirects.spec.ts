import { test, expect } from "../../fixtures/emdash-browser";

test.describe("Redirects", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Empty state", () => {
		test("displays redirects page with empty state", async ({ admin, page }) => {
			await admin.goto("/redirects");
			await admin.waitForShell();
			await admin.waitForLoading();

			await admin.expectPageTitle("Redirects");

			await expect(page.getByRole("button", { name: "New Redirect" })).toBeVisible();

			await expect(page.locator("text=No redirects yet")).toBeVisible();
		});
	});

	test.describe("CRUD", () => {
		test("creates a redirect", async ({ admin, page }) => {
			await admin.goto("/redirects");
			await admin.waitForShell();
			await admin.waitForLoading();

			await page.getByRole("button", { name: "New Redirect" }).click();
			await expect(page.locator('[role="dialog"]')).toBeVisible();

			const dialog = page.locator('[role="dialog"]');
			await dialog.locator('input[placeholder*="old-page"]').fill("/old-page");
			await dialog.locator('input[placeholder*="new-page"]').fill("/new-page");

			await dialog.getByRole("button", { name: "Create" }).click();

			await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

			await expect(page.locator("text=/old-page").first()).toBeVisible();
			await expect(page.locator("text=/new-page").first()).toBeVisible();
		});

		test("edits a redirect", async ({ admin, page }) => {
			await admin.goto("/redirects");
			await admin.waitForShell();
			await admin.waitForLoading();

			await page.getByRole("button", { name: "New Redirect" }).click();
			const createDialog = page.locator('[role="dialog"]');
			await createDialog.locator('input[placeholder*="old-page"]').fill("/edit-source");
			await createDialog.locator('input[placeholder*="new-page"]').fill("/edit-dest-original");
			await createDialog.getByRole("button", { name: "Create" }).click();
			await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

			await expect(page.locator("text=/edit-source").first()).toBeVisible();

			await page.locator('button[aria-label^="Edit redirect"]').first().click();

			await expect(page.locator('[role="dialog"]')).toBeVisible();

			const editDialog = page.locator('[role="dialog"]');
			const destInput = editDialog.locator('input[placeholder*="new-page"]');
			await destInput.clear();
			await destInput.fill("/edit-dest-updated");

			await editDialog.getByRole("button", { name: "Save" }).click();
			await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

			await expect(page.locator("text=/edit-dest-updated").first()).toBeVisible();
			await expect(page.locator("text=/edit-dest-original")).not.toBeVisible();
		});

		test("deletes a redirect", async ({ admin, page }) => {
			await admin.goto("/redirects");
			await admin.waitForShell();
			await admin.waitForLoading();

			await page.getByRole("button", { name: "New Redirect" }).click();
			const dialog = page.locator('[role="dialog"]');
			await dialog.locator('input[placeholder*="old-page"]').fill("/to-delete");
			await dialog.locator('input[placeholder*="new-page"]').fill("/deleted-dest");
			await dialog.getByRole("button", { name: "Create" }).click();
			await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

			await expect(page.locator("text=/to-delete").first()).toBeVisible();

			await page.locator('button[aria-label^="Delete redirect"]').first().click();

			await expect(page.locator('[role="dialog"]')).toBeVisible();
			await page.getByRole("button", { name: "Delete" }).click();

			await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

			await expect(page.locator("text=/to-delete")).not.toBeVisible();
		});
	});

	test.describe("404 Tracking", () => {
		test("renders the 404 errors tab", async ({ admin, page }) => {
			await admin.goto("/redirects");
			await admin.waitForShell();
			await admin.waitForLoading();

			await page.locator("button", { hasText: "404 Errors" }).click();

			await expect(page.locator("text=No 404 errors recorded yet")).toBeVisible({
				timeout: 10000,
			});
		});
	});
});
