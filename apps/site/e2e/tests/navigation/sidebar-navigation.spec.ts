import { readFileSync } from "node:fs";

import { test, expect } from "../../fixtures/base-fixtures.js";
import { operatorHeaders, ready, unwrap } from "../../fixtures/site-api.js";

const baseline = JSON.parse(
	readFileSync(
		new URL("../../../../../config/superboard-plugin-independence-baseline.json", import.meta.url),
		"utf8",
	),
) as { plugins: { navigation: { href: string }[] }[] };
const ACCOUNT_MENU = /Open (?:.* )?account menu/i;

test.describe("Native plugin shell", () => {
	test("retains every historical menu destination from active plugins", async ({
		authenticatedPage: page,
	}) => {
		await ready(page, "/app/customers");
		const navigation = page.getByRole("navigation", { name: "SuperBoard navigation", exact: true });
		await expect(navigation).toBeVisible();
		for (const entry of baseline.plugins.flatMap((plugin) => plugin.navigation))
			await expect(
				navigation.locator(`a[href="${entry.href.replace(":lang", "en")}"]`),
			).toHaveCount(1);
	});
	test("opens the links view from its plugin menu", async ({ authenticatedPage: page }) => {
		await ready(page, "/app/customers");
		const link = page
			.getByRole("navigation", { name: "SuperBoard navigation", exact: true })
			.locator('a[href="/dynamic-links/links"]');
		const group = link.locator("xpath=ancestor::details");
		if ((await group.getAttribute("open")) === null) await group.locator("summary").click();
		await link.click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/dynamic-links/links");
		await expect(page.getByRole("heading", { name: "Links", exact: true })).toBeVisible();
	});
	test("opens project settings from the account menu", async ({ authenticatedPage: page }) => {
		await ready(page, "/app/customers");
		await page.getByRole("button", { name: ACCOUNT_MENU }).click();
		await page.getByRole("menuitem", { name: "Project Settings", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/project-settings");
		await expect(page.getByText("Active Users", { exact: true })).toBeVisible();
	});
	test("switches the real module project and preserves its environment after reload", async ({
		authenticatedPage: page,
	}) => {
		const scope = unwrap(
			await (
				await page.request.post("/_emdash/api/superboard/operator-context", {
					headers: operatorHeaders(),
					data: {},
				})
			).json(),
		);
		let testRead = false;
		page.on("request", (request) => {
			if (decodeURIComponent(request.url()).includes(`/projects/${scope.test_project_ref}/`))
				testRead = true;
		});
		await ready(page, "/dynamic-links/campaigns");
		await expect(
			page.getByRole("navigation", { name: "Dynamic Links pages", exact: true }),
		).toBeVisible();
		await page
			.getByRole("combobox", { name: "Environment", exact: true })
			.selectOption({ label: "Test" });
		await expect.poll(() => testRead).toBe(true);
		await page.reload();
		await expect(
			page.getByRole("combobox", { name: "Environment", exact: true }).locator("option:checked"),
		).toHaveText("Test");
	});
	test("keeps account actions inside the menu and signs out through the core session", async ({
		authenticatedPage: page,
	}) => {
		await ready(page, "/app/customers");
		await expect(page.getByRole("menuitem", { name: "Account", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: ACCOUNT_MENU }).click();
		await expect(page.getByRole("menuitem", { name: "Account", exact: true })).toBeVisible();
		await expect(
			page.getByRole("menuitem", { name: "Project Settings", exact: true }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: /(?:Dark|Light) mode/i })).toBeVisible();
		await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/_emdash/admin/login");
		expect((await page.request.get("/_emdash/api/auth/me")).status()).toBe(401);
	});
	test("opens and closes mobile navigation from the top bar", async ({
		authenticatedPage: page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await ready(page, "/dynamic-links/campaigns");
		const trigger = page
			.getByRole("banner")
			.getByRole("button", { name: "Open navigation", exact: true });
		await expect(trigger).toBeVisible();
		await trigger.click();
		await expect(
			page.getByRole("navigation", { name: "SuperBoard navigation", exact: true }),
		).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(trigger).toBeFocused();
	});
	test("displays the configured instance name", async ({ authenticatedPage: page }) => {
		const scope = unwrap(
			await (
				await page.request.post("/_emdash/api/superboard/operator-context", {
					headers: operatorHeaders(),
					data: {},
				})
			).json(),
		);
		await ready(page, "/app/customers");
		await expect(page.getByText(scope.instance.name, { exact: true }).first()).toBeVisible();
	});
	test("preserves shell dimensions, flat account menu and collapse behaviour", async ({
		authenticatedPage: page,
	}) => {
		await ready(page, "/dynamic-links/campaigns");
		const sidebar = page.locator('[data-slot="sidebar-container"]');
		await expect(sidebar).toHaveCSS("width", "224px");
		await expect(page.getByRole("banner")).toHaveCSS("height", "48px");
		const action = page.getByRole("button", { name: "Create campaign", exact: true }).first();
		await expect(action).toHaveCSS("background-color", "rgb(15, 23, 42)");
		await expect(action).toHaveCSS("color", "rgb(248, 250, 252)");
		await page.getByRole("button", { name: ACCOUNT_MENU }).click();
		const menu = page.getByRole("menu");
		await expect(menu).toHaveCSS("width", "240px");
		await expect(menu).toHaveCSS("box-shadow", "none");
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
		await expect(sidebar).toHaveCSS("width", "64px");
	});
});
