import { test, expect } from "../../fixtures/emdash-browser";

const SETTINGS_API_PATTERN = /\/api\/settings$/;

test.describe("Social Settings", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test("page renders with heading and form", async ({ admin, page }) => {
		await admin.goto("/settings/social");
		await admin.waitForShell();
		await admin.waitForLoading();

		await expect(page.locator("h1")).toContainText("Social Links");

		await expect(page.locator("text=Social Profiles")).toBeVisible({ timeout: 10000 });
	});

	test("displays all social input fields", async ({ admin, page }) => {
		await admin.goto("/settings/social");
		await admin.waitForShell();
		await admin.waitForLoading();

		for (const label of ["Twitter", "GitHub", "Facebook", "Instagram", "LinkedIn", "YouTube"]) {
			await expect(page.locator(`label:has-text("${label}")`)).toBeVisible({ timeout: 5000 });
		}

		await expect(page.getByRole("button", { name: "Saved", exact: true }).first()).toBeVisible();
	});

	test("saves a social link and persists across reload", async ({ admin, page }) => {
		await admin.goto("/settings/social");
		await admin.waitForShell();
		await admin.waitForLoading();

		const testHandle = `@e2e-test-${Date.now()}`;

		const firstInput = page.locator("form input").first();
		await firstInput.fill(testHandle);

		const saveResponse = page.waitForResponse(
			(res) =>
				SETTINGS_API_PATTERN.test(res.url()) &&
				res.request().method() === "POST" &&
				res.status() === 200,
			{ timeout: 15000 },
		);

		await page.getByRole("button", { name: "Save", exact: true }).first().click();
		await saveResponse;

		await expect(page.locator("text=Social links saved")).toBeVisible({ timeout: 5000 });

		await admin.goto("/settings/social");
		await admin.waitForShell();
		await admin.waitForLoading();

		const firstInputAfterReload = page.locator("form input").first();
		await expect(firstInputAfterReload).toHaveValue(testHandle, { timeout: 10000 });
	});
});

test.describe("SEO Settings", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test("page renders with heading and form", async ({ admin, page }) => {
		await admin.goto("/settings/seo");
		await admin.waitForShell();
		await admin.waitForLoading();

		await expect(page.locator("h1")).toContainText("SEO Settings");

		await expect(
			page.getByRole("heading", { name: "Search Engine Optimization", exact: true }),
		).toBeVisible({ timeout: 10000 });
	});

	test("displays expected SEO fields", async ({ admin, page }) => {
		await admin.goto("/settings/seo");
		await admin.waitForShell();
		await admin.waitForLoading();

		for (const label of [
			"Title Separator",
			"Google Verification",
			"Bing Verification",
			"robots.txt",
		]) {
			await expect(page.getByRole("textbox", { name: label, exact: true })).toBeVisible({
				timeout: 5000,
			});
		}

		await expect(page.getByRole("button", { name: "Saved", exact: true }).first()).toBeVisible();
	});

	test("saves SEO settings and persists across reload", async ({ admin, page }) => {
		await admin.goto("/settings/seo");
		await admin.waitForShell();
		await admin.waitForLoading();

		const testVerification = `e2e-verify-${Date.now()}`;

		const googleInput = page.getByRole("textbox", {
			name: "Google Verification",
			exact: true,
		});
		await googleInput.fill(testVerification);

		const saveResponse = page.waitForResponse(
			(res) =>
				SETTINGS_API_PATTERN.test(res.url()) &&
				res.request().method() === "POST" &&
				res.status() === 200,
			{ timeout: 15000 },
		);

		await page.getByRole("button", { name: "Save", exact: true }).first().click();
		await saveResponse;

		await expect(page.locator("text=SEO settings saved")).toBeVisible({ timeout: 5000 });

		await admin.goto("/settings/seo");
		await admin.waitForShell();
		await admin.waitForLoading();

		const googleInputAfterReload = page.getByRole("textbox", {
			name: "Google Verification",
			exact: true,
		});
		await expect(googleInputAfterReload).toHaveValue(testVerification, { timeout: 10000 });
	});
});

test.describe("Language Switcher", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test("settings page shows language select", async ({ admin, page }) => {
		await admin.goto("/settings");
		await admin.waitForShell();

		const languageSelect = page.getByRole("combobox", { name: "Language", exact: true });
		await expect(languageSelect).toBeVisible();
	});

	test("switching language updates the UI", async ({ admin, page }) => {
		await admin.goto("/settings");
		await admin.waitForShell();

		await page.getByRole("combobox", { name: "Language", exact: true }).click();
		await page.getByRole("option", { name: "Deutsch", exact: true }).click();

		await expect(page.locator("h1")).toContainText("Einstellungen", { timeout: 5000 });

		await page.getByRole("combobox").filter({ hasText: "Deutsch" }).click();
		await page.getByRole("option", { name: "English", exact: true }).click();

		await expect(page.locator("h1")).toContainText("Settings", { timeout: 5000 });
	});
});

test.describe("Email Settings", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test("page renders with heading and pipeline status", async ({ admin, page }) => {
		await admin.goto("/settings/email");
		await admin.waitForShell();
		await admin.waitForLoading();

		await expect(page.locator("h1")).toContainText("Email Settings");

		await expect(page.getByRole("heading", { name: "Email Pipeline" })).toBeVisible({
			timeout: 10000,
		});
	});
});
