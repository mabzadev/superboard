import { test, expect } from "../../fixtures/base-fixtures.js";
import { dialogField } from "../../fixtures/dynamic-links.js";
import { evidence, projectRef, ready, siteApi, unique } from "../../fixtures/site-api.js";

test("creates a link with platform routing and reads its saved values after reload", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const slug = unique("created-link");
	const name = unique("Site created link");
	await ready(page, "/dynamic-links/links");
	await page.getByRole("button", { name: "Create Link", exact: true }).first().click();
	await dialogField(page, "Name", name);
	await dialogField(page, "Slug", slug);
	await dialogField(page, "Default destination", "https://example.test/default");
	await dialogField(page, "iOS destination", "https://example.test/ios");
	await dialogField(page, "Android destination", "https://example.test/android");
	await page.getByRole("dialog").getByRole("button", { name: "Save link", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.reload();
	await page.getByPlaceholder("Search link", { exact: true }).fill(slug);
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	const rows = await siteApi(
		page.request,
		"supbrd-plugmod-dynamic-links",
		"GET",
		`/api/v1/dynamic-links/projects/${project}/links?search=${slug}`,
	);
	const saved = rows.find((row: { slug: string }) => row.slug === slug);
	expect(saved).toMatchObject({
		destination_url: "https://example.test/default",
		destinations: { ios: "https://example.test/ios", android: "https://example.test/android" },
	});
	await evidence(
		"supbrd-plugmod-dynamic-links",
		"superboard.dynamic_links_links",
		[saved.id],
		"Created a link through its form, then reloaded and verified platform destinations through its owning API.",
	);
});
