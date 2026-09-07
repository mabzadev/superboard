import { test, expect } from "../../fixtures/base-fixtures.js";
import { dialogField, linkFixture } from "../../fixtures/dynamic-links.js";
import { ready, siteApi } from "../../fixtures/site-api.js";

test.describe("Links table", () => {
	test("loads real persisted links", async ({ authenticatedPage: page }) => {
		const link = await linkFixture(page);
		await ready(page, "/dynamic-links/links");
		await page.getByPlaceholder("Search link", { exact: true }).fill(link.slug);
		await expect(page.getByText(link.name, { exact: true })).toBeVisible();
	});
	test("search removes unrelated links and restores the matching record", async ({
		authenticatedPage: page,
	}) => {
		const link = await linkFixture(page);
		await ready(page, "/dynamic-links/links");
		const search = page.getByPlaceholder("Search link", { exact: true });
		await search.fill("no-match-" + link.slug);
		await expect(page.getByText(link.name, { exact: true })).toHaveCount(0);
		await search.fill(link.slug);
		await expect(page.getByText(link.name, { exact: true })).toBeVisible();
	});
	test("edits a selected row and preserves the new name after reload", async ({
		authenticatedPage: page,
	}) => {
		const link = await linkFixture(page);
		await ready(page, "/dynamic-links/links");
		await page.getByPlaceholder("Search link", { exact: true }).fill(link.slug);
		await page.getByText(link.name, { exact: true }).click();
		await dialogField(page, "Name", link.name + " edited");
		await page.getByRole("dialog").getByRole("button", { name: "Save link", exact: true }).click();
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await page.reload();
		await expect(page.getByText(link.name + " edited", { exact: true })).toBeVisible();
	});
	test("archived filtering finds inactive records and excludes them from active results", async ({
		authenticatedPage: page,
	}) => {
		const link = await linkFixture(page, false);
		await ready(page, "/dynamic-links/links");
		await page.getByPlaceholder("Search link", { exact: true }).fill(link.slug);
		await expect(page.getByText(link.name, { exact: true })).toHaveCount(0);
		await page.locator("main").getByRole("combobox").first().click();
		await page.getByRole("option", { name: "Archived", exact: true }).click();
		await expect(page.getByText(link.name, { exact: true })).toBeVisible();
		const rows = await siteApi(
			page.request,
			"supbrd-plugmod-dynamic-links",
			"GET",
			`/api/v1/dynamic-links/projects/${link.project}/links?search=${link.slug}&active=false`,
		);
		expect(rows.some((row: { id: string }) => row.id === link.id)).toBe(true);
	});
});
