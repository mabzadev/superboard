import { test, expect } from "../../fixtures/emdash-browser";

const MASKED_TOKEN_PATTERN = /^[•]+$/;
const TOKEN_PREFIX_PATTERN = /^ec_/;

test.describe("API Tokens", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test("tokens page renders with existing tokens", async ({ admin, page }) => {
		await admin.goto("/settings/api-tokens");
		await admin.waitForShell();
		await admin.waitForLoading();

		await admin.expectPageTitle("API Tokens");

		const tokenList = page.getByRole("region", { name: "API Tokens", exact: true });
		await expect(tokenList).toBeVisible({ timeout: 10000 });

		await expect(tokenList.getByText("dev-bypass-token", { exact: true })).toBeVisible();
	});

	test("create a new token with scopes", async ({ admin, page }) => {
		await admin.goto("/settings/api-tokens");
		await admin.waitForShell();
		await admin.waitForLoading();

		const tokenName = `e2e-test-token-${Date.now()}`;

		await page.getByRole("button", { name: "Create Token" }).click();

		await expect(page.locator("text=Create New Token")).toBeVisible({ timeout: 5000 });

		const nameInput = page.getByLabel("Token Name");
		await nameInput.fill(tokenName);

		await page.locator("label", { hasText: "Content Read" }).click();

		await page.locator("label", { hasText: "Media Read" }).click();

		await page.getByRole("button", { name: "Create Token" }).last().click();

		await page.waitForTimeout(2000);

		await expect(page.locator("text=Token created")).toBeVisible({ timeout: 5000 });
		await expect(page.locator(`text=${tokenName}`).first()).toBeVisible();

		await expect(page.locator("text=won't be shown again")).toBeVisible();

		const tokenDisplay = page.locator("code").filter({ hasText: MASKED_TOKEN_PATTERN });
		await expect(tokenDisplay).toBeVisible();

		await page.getByLabel("Show token").click();

		const revealedToken = page.locator("code").filter({ hasText: TOKEN_PREFIX_PATTERN }).first();
		await expect(revealedToken).toBeVisible({ timeout: 3000 });

		const tokenList = page.getByRole("region", { name: "API Tokens", exact: true });
		await expect(tokenList.getByText(tokenName, { exact: true })).toBeVisible({ timeout: 5000 });
	});

	test("token value is not visible after navigating away and back", async ({ admin, page }) => {
		await admin.goto("/settings/api-tokens");
		await admin.waitForShell();
		await admin.waitForLoading();

		const tokenName = `ephemeral-token-${Date.now()}`;

		await page.getByRole("button", { name: "Create Token" }).click();
		await expect(page.locator("text=Create New Token")).toBeVisible({ timeout: 5000 });

		await page.getByLabel("Token Name").fill(tokenName);

		await page.locator("label", { hasText: "Content Read" }).click();

		await page.getByRole("button", { name: "Create Token" }).last().click();
		await page.waitForTimeout(2000);

		await expect(page.locator("text=Token created")).toBeVisible({ timeout: 5000 });

		await admin.goto("/settings");
		await admin.waitForShell();

		await admin.goto("/settings/api-tokens");
		await admin.waitForShell();
		await admin.waitForLoading();

		await expect(page.locator("text=Token created")).not.toBeVisible({ timeout: 3000 });

		const tokenList = page.getByRole("region", { name: "API Tokens", exact: true });
		await expect(tokenList.getByText(tokenName, { exact: true })).toBeVisible({
			timeout: 5000,
		});
	});

	test("revoke a token with confirmation", async ({ admin, page }) => {
		await admin.goto("/settings/api-tokens");
		await admin.waitForShell();
		await admin.waitForLoading();

		const tokenName = `revoke-me-${Date.now()}`;

		await page.getByRole("button", { name: "Create Token" }).click();
		await expect(page.locator("text=Create New Token")).toBeVisible({ timeout: 5000 });

		await page.getByLabel("Token Name").fill(tokenName);

		await page.locator("label", { hasText: "Content Read" }).click();

		await page.getByRole("button", { name: "Create Token" }).last().click();
		await page.waitForTimeout(2000);

		await page.getByRole("button", { name: "Dismiss", exact: true }).click();
		await expect(page.locator("text=Token created")).not.toBeVisible({ timeout: 3000 });

		const tokenList = page.getByRole("region", { name: "API Tokens", exact: true });
		await expect(tokenList.getByText(tokenName, { exact: true })).toBeVisible({ timeout: 5000 });
		await page.getByRole("button", { name: `Revoke token ${tokenName}`, exact: true }).click();

		const dialog = page.getByRole("dialog");
		await expect(dialog.getByRole("heading", { name: "Revoke?", exact: true })).toBeVisible({
			timeout: 3000,
		});

		await expect(dialog.getByRole("button", { name: "Confirm" })).toBeVisible();
		await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();

		await dialog.getByRole("button", { name: "Confirm" }).click();
		await page.waitForTimeout(2000);

		await expect(tokenList.getByText(tokenName, { exact: true })).not.toBeVisible({
			timeout: 5000,
		});

		await expect(page.locator("text=dev-bypass-token")).toBeVisible();
	});

	test("cancel revoke keeps token in list", async ({ admin, page }) => {
		await admin.goto("/settings/api-tokens");
		await admin.waitForShell();
		await admin.waitForLoading();

		const tokenName = `keep-me-${Date.now()}`;

		await page.getByRole("button", { name: "Create Token" }).click();
		await expect(page.locator("text=Create New Token")).toBeVisible({ timeout: 5000 });

		await page.getByLabel("Token Name").fill(tokenName);

		await page.locator("label", { hasText: "Content Read" }).click();

		await page.getByRole("button", { name: "Create Token" }).last().click();
		await page.waitForTimeout(2000);

		await page.getByRole("button", { name: "Dismiss", exact: true }).click();

		const tokenList = page.getByRole("region", { name: "API Tokens", exact: true });
		await expect(tokenList.getByText(tokenName, { exact: true })).toBeVisible({ timeout: 5000 });
		await page.getByRole("button", { name: `Revoke token ${tokenName}`, exact: true }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog.getByRole("heading", { name: "Revoke?", exact: true })).toBeVisible({
			timeout: 3000,
		});

		await dialog.getByRole("button", { name: "Cancel" }).click();

		await expect(dialog).not.toBeVisible({ timeout: 3000 });

		await expect(tokenList.getByText(tokenName, { exact: true })).toBeVisible();

		await expect(
			page.getByRole("button", { name: `Revoke token ${tokenName}`, exact: true }),
		).toBeVisible();
	});
});
