import { test, expect } from "../../fixtures/emdash-browser";

const CONTENT_EDIT_URL_PATTERN = /\/content\/posts\/[A-Z0-9]+(?:\?.*)?$/;

test.describe("i18n", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Content List", () => {
		test("shows locale column when i18n is configured", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			const localeHeader = admin.page.locator("th", { hasText: "Locale" });
			await expect(localeHeader).toBeVisible();
		});

		test("displays locale badges for each content item", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			const locales = await admin.getLocaleColumnValues();
			expect(locales.length).toBeGreaterThan(0);
			for (const locale of locales) {
				expect(locale.trim().toLowerCase()).toBe("en");
			}
		});

		test("has a locale filter switcher", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			const select = admin.page.locator("select").first();
			await expect(select).toBeVisible();

			const options = select.locator("option");
			const optionTexts = await options.allTextContents();
			expect(optionTexts.some((t) => t.includes("EN"))).toBe(true);
			expect(optionTexts.some((t) => t.includes("FR"))).toBe(true);
			expect(optionTexts.some((t) => t.includes("ES"))).toBe(true);
		});
	});

	test.describe("Content Editor", () => {
		test("shows translations sidebar for existing content", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			await admin.page.locator("table tbody tr a").first().click();
			await admin.waitForLoading();

			const translationsHeading = admin.page.locator("h3", {
				hasText: "Translations",
			});
			await expect(translationsHeading).toBeVisible();
		});

		test("shows all configured locales in translations sidebar", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			await admin.page.locator("table tbody tr a").first().click();
			await admin.waitForLoading();

			const locales = await admin.getTranslationSidebarLocales();
			const normalized = locales.map((l) => l.trim().toLowerCase());
			expect(normalized).toContain("en");
			expect(normalized).toContain("fr");
			expect(normalized).toContain("es");
		});

		test("marks current locale in translations sidebar", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			await admin.page.locator("table tbody tr a").first().click();
			await admin.waitForLoading();

			const currentMarker = admin.page.locator("span.text-kumo-link", {
				hasText: "current",
			});
			await expect(currentMarker).toBeVisible();
		});

		test("shows Translate buttons for missing locales", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			await admin.page.locator("table tbody tr a").first().click();
			await admin.waitForLoading();

			expect(await admin.hasTranslateButton("fr")).toBe(true);
			expect(await admin.hasTranslateButton("es")).toBe(true);
		});

		test("does not show translations sidebar for new content", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const translationsHeading = admin.page.locator("h3", {
				hasText: "Translations",
			});
			await expect(translationsHeading).not.toBeVisible();
		});
	});

	test.describe("Translation Flow", () => {
		test("creates a translation and navigates to it", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const postTitle = `i18n Test Post ${Date.now()}`;
			await admin.fillField("title", postTitle);
			await admin.clickSave();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});
			await admin.waitForLoading();

			const originalUrl = admin.page.url();

			expect(await admin.hasTranslateButton("fr")).toBe(true);

			await admin.clickTranslate("fr");
			await admin.page.waitForURL(
				(url) => CONTENT_EDIT_URL_PATTERN.test(url.pathname) && url.href !== originalUrl,
				{ timeout: 15000 },
			);
			await admin.waitForLoading();

			await expect(admin.page.locator("#field-title")).toHaveValue(postTitle);

			const slug = await admin.page.getByLabel("Slug").inputValue();
			expect(slug).not.toContain("-fr");
			expect(slug).not.toContain("-en");
		});

		test("shows Edit link for existing translations", async ({ admin }) => {
			test.skip(
				process.env.EMDASH_E2E_TARGET === "cloudflare",
				"CF: translations sidebar Edit link renders too slowly (front-end timing; backend verified OK)",
			);
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const postTitle = `Translation Edit Test ${Date.now()}`;
			await admin.fillField("title", postTitle);
			await admin.clickSave();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});
			await admin.waitForLoading();

			const originalUrl = admin.page.url();

			await admin.clickTranslate("fr");
			await admin.page.waitForURL(
				(url) => CONTENT_EDIT_URL_PATTERN.test(url.pathname) && url.href !== originalUrl,
				{ timeout: 15000 },
			);
			await admin.waitForLoading();

			expect(await admin.hasEditTranslationLink("en")).toBe(true);
			expect(await admin.hasTranslateButton("es")).toBe(true);
		});

		test("can navigate between translations via Edit links", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const postTitle = `Navigation Test ${Date.now()}`;
			await admin.fillField("title", postTitle);
			await admin.clickSave();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});
			await admin.waitForLoading();

			const originalUrl = admin.page.url();

			await admin.clickTranslate("fr");
			await admin.page.waitForURL(
				(url) => CONTENT_EDIT_URL_PATTERN.test(url.pathname) && url.href !== originalUrl,
				{ timeout: 15000 },
			);
			await admin.waitForLoading();

			const frUrl = admin.page.url();

			await admin.clickEditTranslation("en");
			await admin.page.waitForURL(
				(url) => CONTENT_EDIT_URL_PATTERN.test(url.pathname) && url.href !== frUrl,
				{ timeout: 15000 },
			);
			await admin.waitForLoading();

			await expect(admin.page).toHaveURL(originalUrl);
			await expect(admin.page.locator("#field-title")).toHaveValue(postTitle);
		});

		test("creating multiple translations does not accumulate locale suffixes in slugs", async ({
			admin,
		}) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			const postTitle = `Slug Accumulation Test ${Date.now()}`;
			await admin.fillField("title", postTitle);
			await admin.clickSave();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});
			await admin.waitForLoading();

			const originalUrl = admin.page.url();
			const originalSlug = await admin.page.getByLabel("Slug").inputValue();
			expect(originalSlug).toBeTruthy();

			await admin.clickTranslate("fr");
			await admin.page.waitForURL(
				(url) => CONTENT_EDIT_URL_PATTERN.test(url.pathname) && url.href !== originalUrl,
				{ timeout: 15000 },
			);
			await admin.waitForLoading();

			const frSlug = await admin.page.getByLabel("Slug").inputValue();
			expect(frSlug).toBe(originalSlug);

			const frUrl = admin.page.url();

			await admin.clickEditTranslation("en");
			await admin.page.waitForURL(
				(url) => CONTENT_EDIT_URL_PATTERN.test(url.pathname) && url.href !== frUrl,
				{ timeout: 15000 },
			);
			await admin.waitForLoading();

			const enUrl = admin.page.url();

			await admin.clickTranslate("es");
			await admin.page.waitForURL(
				(url) => CONTENT_EDIT_URL_PATTERN.test(url.pathname) && url.href !== enUrl,
				{ timeout: 15000 },
			);
			await admin.waitForLoading();

			const esSlug = await admin.page.getByLabel("Slug").inputValue();
			expect(esSlug).toBe(originalSlug);
		});
	});
});
