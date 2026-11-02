import { test, expect } from "../../fixtures/emdash-browser";

test.describe("Form Data Loss Prevention", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test("settings edits survive window blur/focus", async ({ admin, page }) => {
		await admin.goto("/settings/general");
		await admin.waitForShell();
		await admin.waitForLoading();

		const taglineInput = page.getByLabel("Tagline");
		await taglineInput.fill("My edited tagline");

		await page.evaluate(() => {
			window.dispatchEvent(new Event("blur"));
			window.dispatchEvent(new Event("focus"));
		});

		await page.waitForTimeout(1000);

		await expect(taglineInput).toHaveValue("My edited tagline");
	});

	test("section editor edits survive window blur/focus", async ({ admin, page }) => {
		await admin.goto("/sections/hero");
		await admin.waitForShell();
		await admin.waitForLoading();

		const titleInput = page.getByLabel("Title");
		const originalTitle = await titleInput.inputValue();
		const editedTitle = `Edited ${Date.now()}`;
		await titleInput.fill(editedTitle);

		await page.evaluate(() => {
			window.dispatchEvent(new Event("blur"));
			window.dispatchEvent(new Event("focus"));
		});

		await page.waitForTimeout(1000);

		await expect(titleInput).toHaveValue(editedTitle);

		await expect(page.getByRole("button", { name: "Save" }).first()).toBeEnabled();

		await titleInput.fill(originalTitle);
	});

	test("section editor save failure keeps form dirty", async ({ admin, page }) => {
		await admin.goto("/sections/hero");
		await admin.waitForShell();
		await admin.waitForLoading();

		const titleInput = page.getByLabel("Title");
		const originalTitle = await titleInput.inputValue();
		await titleInput.fill(`Error test ${Date.now()}`);

		await page.route("**/api/sections/hero", (route) => {
			if (route.request().method() === "PUT" || route.request().method() === "PATCH") {
				return route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: { code: "SERVER_ERROR", message: "Simulated failure" } }),
				});
			}
			return route.continue();
		});

		const saveButton = page.getByRole("button", { name: "Save" }).first();
		await saveButton.click();

		await page.waitForTimeout(1000);

		await expect(page.getByRole("button", { name: "Save" }).first()).toBeEnabled();

		await page.unroute("**/api/sections/hero");
		await titleInput.fill(originalTitle);
	});

	test("taxonomy checkboxes clear when all terms are removed", async ({
		admin,
		page,
		serverInfo,
	}) => {
		const postId = serverInfo.contentIds["posts"]?.[0];
		if (!postId) {
			test.skip();
			return;
		}

		await admin.goToEditContent("posts", postId);
		await admin.waitForLoading();

		const taxonomyHeading = page.locator("h3", { hasText: "Taxonomies" });
		await expect(taxonomyHeading).toBeVisible({ timeout: 10000 });

		const newsCheckbox = page.getByRole("checkbox", { name: "News" });
		const tutorialsCheckbox = page.getByRole("checkbox", { name: "Tutorials" });

		await newsCheckbox.check();
		await page.waitForTimeout(500);
		await tutorialsCheckbox.check();
		await page.waitForTimeout(500);

		await expect(newsCheckbox).toBeChecked();
		await expect(tutorialsCheckbox).toBeChecked();

		await newsCheckbox.uncheck();
		await page.waitForTimeout(500);
		await tutorialsCheckbox.uncheck();
		await page.waitForTimeout(500);

		await expect(newsCheckbox).not.toBeChecked();
		await expect(tutorialsCheckbox).not.toBeChecked();
		await expect(page.getByRole("checkbox", { name: "Opinion" })).not.toBeChecked();

		await page.reload();
		await admin.waitForShell();
		await admin.waitForLoading();

		await expect(taxonomyHeading).toBeVisible({ timeout: 10000 });
		await expect(page.getByRole("checkbox", { name: "News" })).not.toBeChecked();
		await expect(page.getByRole("checkbox", { name: "Tutorials" })).not.toBeChecked();
		await expect(page.getByRole("checkbox", { name: "Opinion" })).not.toBeChecked();
	});
});
