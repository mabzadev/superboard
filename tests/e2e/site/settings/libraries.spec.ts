import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import { evidence, ready, siteApi } from "../../../fixtures/site-browser/site-api.js";

test("the library catalogue refreshes and copies the published release and installation", async ({
	authenticatedPage: page,
}) => {
	const plugin = "supbrd-plug-settings";
	await ready(page, "/app/libraries");
	const catalog = await siteApi(page.request, plugin, "GET", "/api/v1/platform/libraries");
	const library = catalog.libraries.find(
		(entry: { lifecycle: string; releaseRef?: string; install?: string }) =>
			entry.lifecycle === "active" && entry.releaseRef && entry.install,
	);
	expect(library).toBeTruthy();
	await expect(page.locator('[data-testid^="library-"]')).toHaveCount(catalog.libraries.length);
	const card = page.getByTestId(`library-${library.id}`);
	await expect(card).toContainText(library.displayName);
	await expect(card).toContainText(library.releaseRef);
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await card
		.getByRole("button", { name: `Copy ${library.displayName} release ref`, exact: true })
		.click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe(library.releaseRef);
	await card.locator("summary").click();
	await expect(card.locator("pre")).toHaveText(library.install);
	await card
		.getByRole("button", { name: `Copy ${library.displayName} installation`, exact: true })
		.click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe(library.install);
	const reload = page.waitForResponse(
		(response) => response.url().includes("/api/") && response.url().includes("libraries"),
	);
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	expect((await reload).ok()).toBe(true);
	await expect(card).toContainText(library.releaseRef);
	await page.reload();
	await expect(card).toContainText(library.releaseRef);
	await evidence(
		plugin,
		"superboard.app_libraries",
		[library.id, library.releaseRef],
		"Compared the complete catalogue to the owning API, refreshed it, expanded installation instructions and verified both clipboard actions against the persisted release metadata.",
	);
});
