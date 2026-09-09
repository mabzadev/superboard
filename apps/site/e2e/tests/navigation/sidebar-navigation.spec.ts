import { test, expect } from "../../fixtures/base-fixtures.js";
import { operatorHeaders, ready, unwrap } from "../../fixtures/site-api.js";

const ACCOUNT_MENU = /Open (?:.* )?account menu/i;

test.describe("Native plugin shell", () => {
	test("keeps nested support destinations reachable through the local navigation", async ({
		authenticatedPage: page,
	}) => {
		await ready(page, "/support/inbox");
		const navigation = page.getByRole("navigation", { name: "SuperBoard navigation", exact: true });
		await expect(navigation.locator('a[href="/support/inbox"]')).toHaveCount(1);
		await expect(navigation.locator('a[href="/support/contacts"]')).toHaveCount(0);
		const local = page.getByRole("navigation", { name: "Section pages", exact: true });
		await local.getByRole("link", { name: "Contacts", exact: true }).click();
		await expect.poll(() => new URL(page.url()).pathname).toBe("/support/contacts");
		await expect(
			page
				.getByRole("navigation", { name: "Section pages", exact: true })
				.getByRole("link", { name: "Contacts", exact: true }),
		).toHaveAttribute("aria-current", "page");
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
			page.getByRole("navigation", { name: "Section pages", exact: true }),
		).toBeVisible();
		await page
			.getByRole("combobox", { name: "Project data", exact: true })
			.selectOption({ label: "Test" });
		await expect.poll(() => testRead).toBe(true);
		await page.reload();
		await expect(
			page.getByRole("combobox", { name: "Project data", exact: true }).locator("option:checked"),
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
	test("keeps account actions and restores navigation after collapsing", async ({
		authenticatedPage: page,
	}) => {
		await ready(page, "/dynamic-links/campaigns");
		const sidebar = page.locator('[data-slot="sidebar-container"]');
		const width = (await sidebar.boundingBox())!.width;
		await page.getByRole("button", { name: ACCOUNT_MENU }).click();
		await expect(page.getByRole("menu")).toBeVisible();
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
		await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(width);
		await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
		await expect(sidebar.locator('a[href="/dynamic-links/links"]')).toBeVisible();
	});
});
