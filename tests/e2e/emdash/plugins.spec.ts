import { test, expect } from "../../fixtures/emdash-browser";

test.describe("Plugins Manager", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Page rendering", () => {
		test("displays the plugins page with at least one plugin", async ({ admin, page }) => {
			await admin.goto("/plugins-manager");
			await admin.waitForShell();
			await admin.waitForLoading();

			await admin.expectPageTitle("Plugins");

			await expect(page.locator("text=/\\d+ plugin/")).toBeVisible({ timeout: 10000 });

			const pluginCards = page.locator(".rounded-lg.border.bg-kumo-base");
			await expect(pluginCards.first()).toBeVisible({ timeout: 10000 });
		});

		test("does not show a crash or error state", async ({ admin, page }) => {
			await admin.goto("/plugins-manager");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("text=/\\d+ plugin/")).toBeVisible({ timeout: 10000 });
			await expect(page.locator("text=Failed to load plugins")).not.toBeVisible();
		});
	});

	test.describe("Plugin card info", () => {
		test("shows plugin name, version, and toggle", async ({ admin, page }) => {
			await admin.goto("/plugins-manager");
			await admin.waitForShell();
			await admin.waitForLoading();

			const colorCard = page
				.locator(".rounded-lg.border.bg-kumo-base", { hasText: "color" })
				.first();
			await expect(colorCard).toBeVisible({ timeout: 10000 });

			await expect(colorCard.locator("h3")).toContainText("color");

			await expect(colorCard.locator("text=v0.0.1")).toBeVisible();

			const toggle = colorCard.locator("button[role='switch']");
			await expect(toggle).toBeVisible();
		});
	});

	test.describe("Expand details", () => {
		test("expand button reveals details section", async ({ admin, page }) => {
			await admin.goto("/plugins-manager");
			await admin.waitForShell();
			await admin.waitForLoading();

			const colorCard = page
				.locator(".rounded-lg.border.bg-kumo-base", { hasText: "color" })
				.first();
			await expect(colorCard).toBeVisible({ timeout: 10000 });

			const expandBtn = colorCard.locator("button[aria-label='Expand details']");
			await expect(expandBtn).toBeVisible();
			await expandBtn.click();

			const detailsSection = colorCard.locator(".border-t.px-4");
			await expect(detailsSection).toBeVisible({ timeout: 5000 });

			await expect(colorCard.locator("button[aria-label='Collapse details']")).toBeVisible();
		});

		test("collapse button hides the details section", async ({ admin, page }) => {
			await admin.goto("/plugins-manager");
			await admin.waitForShell();
			await admin.waitForLoading();

			const colorCard = page
				.locator(".rounded-lg.border.bg-kumo-base", { hasText: "color" })
				.first();
			await expect(colorCard).toBeVisible({ timeout: 10000 });

			await colorCard.locator("button[aria-label='Expand details']").click();
			const detailsSection = colorCard.locator(".border-t.px-4");
			await expect(detailsSection).toBeVisible({ timeout: 5000 });

			await colorCard.locator("button[aria-label='Collapse details']").click();

			await expect(detailsSection).not.toBeVisible({ timeout: 5000 });

			await expect(colorCard.locator("button[aria-label='Expand details']")).toBeVisible();
		});
	});

	test.describe("API integration", () => {
		test("plugins API returns the correct envelope shape", async ({ page, serverInfo }) => {
			const res = await page.request.get("/_emdash/api/admin/plugins", {
				headers: {
					"X-EmDash-Request": "1",
					Authorization: `Bearer ${serverInfo.token}`,
				},
			});

			expect(res.ok()).toBe(true);
			const body = await res.json();

			expect(body.data).toBeDefined();
			expect(body.data.items).toBeDefined();
			expect(Array.isArray(body.data.items)).toBe(true);
			expect(body.data.items.length).toBeGreaterThan(0);

			const plugin = body.data.items[0];
			expect(plugin.id).toBeDefined();
			expect(plugin.name).toBeDefined();
			expect(plugin.version).toBeDefined();
			expect(typeof plugin.enabled).toBe("boolean");
			expect(Array.isArray(plugin.capabilities)).toBe(true);
		});
	});
});
