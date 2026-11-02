import { test, expect } from "../../fixtures/emdash-browser";

test.describe("Keyboard Shortcuts", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Media Detail Panel", () => {
		test("Escape closes the media detail panel", async ({ admin, page }) => {
			await admin.goToMedia();
			await admin.waitForLoading();

			const mediaItem = page.locator("[data-media-grid] button").first();
			await expect(mediaItem).toBeVisible({ timeout: 10000 });
			await mediaItem.click();

			const panel = page.locator("text=Media Details");
			await expect(panel).toBeVisible({ timeout: 5000 });

			await page.keyboard.press("Escape");

			await expect(panel).not.toBeVisible({ timeout: 3000 });
		});

		test("Cmd+S saves media detail changes", async ({ admin, page }) => {
			await admin.goToMedia();
			await admin.waitForLoading();

			const mediaItem = page.locator("[data-media-grid] button").first();
			await expect(mediaItem).toBeVisible({ timeout: 10000 });
			await mediaItem.click();

			await expect(page.locator("text=Media Details")).toBeVisible({ timeout: 5000 });

			const altInput = page.getByLabel("Alt Text");
			if (await altInput.isVisible({ timeout: 2000 }).catch(() => false)) {
				await altInput.fill(`E2E Alt ${Date.now()}`);

				const saveResponse = page.waitForResponse(
					(res) =>
						res.url().includes("/api/media/") &&
						res.request().method() === "PUT" &&
						res.status() === 200,
					{ timeout: 10000 },
				);

				const modifier = process.platform === "darwin" ? "Meta" : "Control";
				await page.keyboard.press(`${modifier}+s`);

				await saveResponse;
			}
		});
	});

	test.describe("User Detail Panel", () => {
		test("Escape closes the user detail panel", async ({ admin, page }) => {
			await admin.goto("/users");
			await admin.waitForShell();
			await admin.waitForLoading();

			const userRow = page.locator("table tbody tr").first();
			await expect(userRow).toBeVisible({ timeout: 10000 });
			await userRow.click();

			const panel = page.locator("text=User Details");
			await expect(panel).toBeVisible({ timeout: 5000 });

			await page.keyboard.press("Escape");

			await expect(panel).not.toBeVisible({ timeout: 3000 });
		});
	});

	test.describe("Shell Sidebar", () => {
		test("sidebar becomes mobile sheet when viewport shrinks below md breakpoint", async ({
			admin,
			page,
		}) => {
			await admin.goToDashboard();

			await page.setViewportSize({ width: 1280, height: 720 });
			const sidebar = page.locator('aside[aria-label="Admin navigation"]');
			await expect(sidebar).toBeVisible();

			await page.setViewportSize({ width: 600, height: 720 });

			await expect(sidebar).not.toBeInViewport({ timeout: 3000 });
		});
	});
});
