import { test, expect } from "../../fixtures/emdash-browser";

const CONTENT_EDIT_URL_PATTERN = /\/content\/posts\/[A-Z0-9]+(?:\?.*)?$/;

test.describe("Field Widgets", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Color Picker Widget Rendering", () => {
		test("renders color picker widget on new post form", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const widget = admin.page.locator('[data-testid="color-picker-widget"]');
			await expect(widget).toBeVisible({ timeout: 10000 });

			const colorInput = admin.page.locator('[data-testid="color-input"]');
			await expect(colorInput).toBeVisible();
			await expect(colorInput).toHaveAttribute("type", "color");

			const hexInput = admin.page.locator('[data-testid="color-hex-input"]');
			await expect(hexInput).toBeVisible();

			const preview = admin.page.locator('[data-testid="color-preview"]');
			await expect(preview).toBeVisible();

			const presets = admin.page.locator('[data-testid="color-presets"]');
			await expect(presets).toBeVisible();
			const presetButtons = presets.locator("button");
			await expect(presetButtons).toHaveCount(10);
		});

		test("shows field label for color widget", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const widget = admin.page.locator('[data-testid="color-picker-widget"]');
			await expect(widget).toBeVisible({ timeout: 10000 });
			await expect(widget.locator("label")).toContainText("Theme Color");
		});

		test("other fields render with default editors", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const titleInput = admin.page.locator("#field-title");
			await expect(titleInput).toBeVisible();
			await expect(admin.page.locator('[data-testid="color-picker-widget"]')).toHaveCount(1);
			await expect(
				titleInput.locator("..").locator('[data-testid="color-picker-widget"]'),
			).toHaveCount(0);
		});
	});

	test.describe("Color Picker Interaction", () => {
		test("can type a hex value", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const hexInput = admin.page.locator('[data-testid="color-hex-input"]');
			await expect(hexInput).toBeVisible({ timeout: 10000 });
			await hexInput.fill("#ff6600");
			await expect(hexInput).toHaveValue("#ff6600");
		});

		test("clicking a preset updates the value", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const widget = admin.page.locator('[data-testid="color-picker-widget"]');
			await expect(widget).toBeVisible({ timeout: 10000 });

			const redPreset = admin.page.locator('[data-testid="color-preset-ef4444"]');
			await expect(redPreset).toBeVisible();
			await redPreset.click();

			const hexInput = admin.page.locator('[data-testid="color-hex-input"]');
			await expect(hexInput).toHaveValue("#ef4444");
		});

		test("clicking different presets changes the value", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const widget = admin.page.locator('[data-testid="color-picker-widget"]');
			await expect(widget).toBeVisible({ timeout: 10000 });
			const hexInput = admin.page.locator('[data-testid="color-hex-input"]');

			await admin.page.locator('[data-testid="color-preset-3b82f6"]').click();
			await expect(hexInput).toHaveValue("#3b82f6");

			await admin.page.locator('[data-testid="color-preset-22c55e"]').click();
			await expect(hexInput).toHaveValue("#22c55e");
		});
	});

	test.describe("Save and Load Widget Values", () => {
		test("saves content with color value and loads it back", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const widget = admin.page.locator('[data-testid="color-picker-widget"]');
			await expect(widget).toBeVisible({ timeout: 10000 });

			await admin.fillField("title", "Color Widget Test Post");

			const hexInput = admin.page.locator('[data-testid="color-hex-input"]');
			await hexInput.fill("#ff6600");

			await admin.clickSave();
			await admin.waitForSaveComplete();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});

			await admin.page.reload();
			await admin.waitForLoading();

			await expect(widget).toBeVisible({ timeout: 10000 });
			const reloadedHex = admin.page.locator('[data-testid="color-hex-input"]');
			await expect(reloadedHex).toHaveValue("#ff6600");
		});

		test("saves content with preset color value", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const widget = admin.page.locator('[data-testid="color-picker-widget"]');
			await expect(widget).toBeVisible({ timeout: 10000 });

			await admin.fillField("title", "Preset Color Post");

			await admin.page.locator('[data-testid="color-preset-8b5cf6"]').click();

			await admin.clickSave();
			await admin.waitForSaveComplete();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});

			await admin.page.reload();
			await admin.waitForLoading();
			await expect(widget).toBeVisible({ timeout: 10000 });
			await expect(admin.page.locator('[data-testid="color-hex-input"]')).toHaveValue("#8b5cf6");
		});

		test("saves content without color value", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const widget = admin.page.locator('[data-testid="color-picker-widget"]');
			await expect(widget).toBeVisible({ timeout: 10000 });

			await admin.fillField("title", "No Color Post");

			await admin.clickSave();
			await admin.waitForSaveComplete();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});
		});
	});

	test.describe("Manifest API", () => {
		test("manifest includes widget property on theme_color field", async ({ page }) => {
			const res = await page.request.get("/_emdash/api/manifest", {
				headers: { "X-EmDash-Request": "1" },
			});
			expect(res.ok()).toBe(true);
			const body = await res.json();
			const manifest = body.data;

			const postFields = manifest.collections.posts.fields;
			expect(postFields.theme_color).toBeDefined();
			expect(postFields.theme_color.widget).toBe("color:picker");
			expect(postFields.theme_color.kind).toBe("string");

			expect(postFields.title.widget).toBeUndefined();
		});

		test("manifest includes color plugin with fieldWidgets", async ({ page }) => {
			const res = await page.request.get("/_emdash/api/manifest", {
				headers: { "X-EmDash-Request": "1" },
			});
			const body = await res.json();
			const manifest = body.data;

			expect(manifest.plugins.color).toBeDefined();
			expect(manifest.plugins.color.enabled).toBe(true);
			expect(manifest.plugins.color.fieldWidgets).toBeDefined();
			expect(manifest.plugins.color.fieldWidgets).toHaveLength(1);
			expect(manifest.plugins.color.fieldWidgets[0].name).toBe("picker");
			expect(manifest.plugins.color.fieldWidgets[0].label).toBe("Color Picker");
			expect(manifest.plugins.color.fieldWidgets[0].fieldTypes).toEqual(["string"]);
		});
	});
});
