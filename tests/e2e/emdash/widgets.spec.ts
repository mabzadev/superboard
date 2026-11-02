import { test, expect } from "../../fixtures/emdash-browser";

function apiHeaders(token: string, baseUrl: string) {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
		"X-EmDash-Request": "1",
		Origin: baseUrl,
	};
}

test.describe("Widgets", () => {
	let headers: Record<string, string>;
	let baseUrl: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();
		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);
	});

	test.describe("Widget Areas Page", () => {
		test("renders the widgets page", async ({ admin, page }) => {
			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("h1").first()).toContainText("Widgets");

			await expect(page.getByRole("button", { name: "Add Widget Area" })).toBeVisible();

			await expect(page.locator("h2", { hasText: "Available Widgets" })).toBeVisible({
				timeout: 10000,
			});
		});

		test("shows empty state when no widget areas exist", async ({ admin, page }) => {
			const res = await fetch(`${baseUrl}/_emdash/api/widget-areas`, { headers });
			if (res.ok) {
				const data: any = await res.json();
				const areas = data.data?.areas ?? [];
				for (const area of areas) {
					await fetch(`${baseUrl}/_emdash/api/widget-areas/${area.name}`, {
						method: "DELETE",
						headers,
					}).catch(() => {});
				}
			}

			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("text=No widget areas yet")).toBeVisible({ timeout: 10000 });
		});

		test("shows built-in widget types in the palette", async ({ admin, page }) => {
			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("text=Content Block").first()).toBeVisible({ timeout: 10000 });
			await expect(page.locator("text=Menu").first()).toBeVisible();
		});
	});

	test.describe("Create Widget Area", () => {
		test("opens and closes the create widget area dialog", async ({ admin, page }) => {
			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await page.getByRole("button", { name: "Add Widget Area" }).click();

			const dialog = page.getByRole("dialog", { name: "Create Widget Area" });
			await expect(dialog).toBeVisible({ timeout: 5000 });

			await expect(dialog.getByLabel("Name")).toBeVisible();
			await expect(dialog.getByLabel("Label")).toBeVisible();

			await dialog.getByRole("button", { name: "Cancel" }).click();
			await expect(dialog).not.toBeVisible({ timeout: 5000 });
		});

		test("creates a new widget area", async ({ admin, page }) => {
			const areaName = `e2e-area-${Date.now()}`;
			const areaLabel = "E2E Test Area";

			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await page.getByRole("button", { name: "Add Widget Area" }).click();

			const dialog = page.getByRole("dialog", { name: "Create Widget Area" });
			await expect(dialog).toBeVisible({ timeout: 5000 });

			await dialog.getByLabel("Name").fill(areaName);
			await dialog.getByLabel("Label").fill(areaLabel);
			await dialog.getByLabel("Description").fill("Area for E2E testing");

			await dialog.getByRole("button", { name: "Create" }).click();

			await expect(dialog).not.toBeVisible({ timeout: 10000 });

			await expect(page.locator("h3", { hasText: areaLabel })).toBeVisible({ timeout: 10000 });

			await fetch(`${baseUrl}/_emdash/api/widget-areas/${areaName}`, {
				method: "DELETE",
				headers,
			}).catch(() => {});
		});
	});

	test.describe("Add Widget to Area", () => {
		test("adds a content widget to an area via API and verifies in UI", async ({ admin, page }) => {
			const areaName = `e2e-widget-${Date.now()}`;
			const areaLabel = "Widget Test Area";

			await fetch(`${baseUrl}/_emdash/api/widget-areas`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: areaName, label: areaLabel }),
			});

			await fetch(`${baseUrl}/_emdash/api/widget-areas/${areaName}/widgets`, {
				method: "POST",
				headers,
				body: JSON.stringify({ type: "content", title: "Test Content Widget" }),
			});

			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("h3", { hasText: areaLabel })).toBeVisible({ timeout: 10000 });

			await expect(page.locator("text=Test Content Widget").first()).toBeVisible({
				timeout: 10000,
			});

			await fetch(`${baseUrl}/_emdash/api/widget-areas/${areaName}`, {
				method: "DELETE",
				headers,
			}).catch(() => {});
		});

		test("deletes a widget from an area", async ({ admin, page }) => {
			const areaName = `e2e-del-widget-${Date.now()}`;
			const areaLabel = "Delete Widget Area";

			await fetch(`${baseUrl}/_emdash/api/widget-areas`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: areaName, label: areaLabel }),
			});

			const widgetRes = await fetch(`${baseUrl}/_emdash/api/widget-areas/${areaName}/widgets`, {
				method: "POST",
				headers,
				body: JSON.stringify({ type: "content", title: "Widget To Delete" }),
			});
			const widgetData: any = await widgetRes.json();
			const widgetTitle = widgetData.data?.widget?.title ?? "Widget To Delete";

			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator(`text=${widgetTitle}`).first()).toBeVisible({ timeout: 10000 });

			const deleteButton = page.getByRole("button", { name: `Delete ${widgetTitle}` });
			if (await deleteButton.isVisible({ timeout: 3000 }).catch(() => false)) {
				await deleteButton.click();
				await admin.waitForLoading();

				await expect(page.locator(`text=${widgetTitle}`).first()).not.toBeVisible({
					timeout: 10000,
				});
			}

			await fetch(`${baseUrl}/_emdash/api/widget-areas/${areaName}`, {
				method: "DELETE",
				headers,
			}).catch(() => {});
		});
	});

	test.describe("Delete Widget Area", () => {
		test("deletes a widget area with confirmation", async ({ admin, page }) => {
			const areaName = `e2e-del-area-${Date.now()}`;
			const areaLabel = "Area To Delete";

			await fetch(`${baseUrl}/_emdash/api/widget-areas`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: areaName, label: areaLabel }),
			});

			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("h3", { hasText: areaLabel })).toBeVisible({ timeout: 10000 });

			const deleteAreaButton = page.getByRole("button", {
				name: `Delete ${areaLabel} widget area`,
			});
			await deleteAreaButton.click();

			const confirmDialog = page.getByRole("dialog", { name: "Delete Widget Area" });
			await expect(confirmDialog).toBeVisible({ timeout: 5000 });

			await confirmDialog.getByRole("button", { name: "Delete" }).click();

			await expect(page.locator("h3", { hasText: areaLabel })).not.toBeVisible({
				timeout: 10000,
			});
		});

		test("cancel delete keeps the widget area", async ({ admin, page }) => {
			const areaName = `e2e-keep-area-${Date.now()}`;
			const areaLabel = "Area To Keep";

			await fetch(`${baseUrl}/_emdash/api/widget-areas`, {
				method: "POST",
				headers,
				body: JSON.stringify({ name: areaName, label: areaLabel }),
			});

			await admin.goto("/widgets");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(page.locator("h3", { hasText: areaLabel })).toBeVisible({ timeout: 10000 });

			await page.getByRole("button", { name: `Delete ${areaLabel} widget area` }).click();

			const confirmDialog = page.getByRole("dialog", { name: "Delete Widget Area" });
			await expect(confirmDialog).toBeVisible({ timeout: 5000 });

			await confirmDialog.getByRole("button", { name: "Cancel" }).click();

			await expect(confirmDialog).not.toBeVisible({ timeout: 5000 });

			await expect(page.locator("h3", { hasText: areaLabel })).toBeVisible();

			await fetch(`${baseUrl}/_emdash/api/widget-areas/${areaName}`, {
				method: "DELETE",
				headers,
			}).catch(() => {});
		});
	});
});
