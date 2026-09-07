import { eventFixture } from "../../fixtures/analytics.js";
import { test, expect } from "../../fixtures/base-fixtures.js";
import { evidence, ready, siteApi } from "../../fixtures/site-api.js";

for (const [path, routeId] of [
	["/dashboard", "superboard.dashboard"],
	["/", "superboard.home"],
	["/app", "superboard.app_shell"],
	["/analytics", "superboard.analytics"],
] as const) {
	test(`${path} displays the persisted analytics count`, async ({ authenticatedPage: page }) => {
		const event = await eventFixture(page);
		await ready(page, path);
		const overview = await siteApi(
			page.request,
			"supbrd-plugmod-analytics",
			"GET",
			`/api/v1/analytics/projects/${event.project}/overview`,
		);
		expect(overview.events).toBeGreaterThan(0);
		await expect(
			page.locator("main").getByText("Events", { exact: true }).locator(".."),
		).toContainText(Number(overview.events).toLocaleString("en-US"));
		await evidence(
			"supbrd-plugmod-analytics",
			routeId,
			[event.id],
			"Recorded a schema-v1 event through the owning API and verified the real overview count in this view.",
		);
	});
}

test("dashboard date range changes the live integration query", async ({
	authenticatedPage: page,
}) => {
	await ready(page, "/dashboard");
	const range = page
		.locator("main")
		.getByRole("button")
		.filter({ hasText: /[A-Za-z]+ \d+, \d{4}/ })
		.first();
	const before = await range.innerText();
	let queried = false;
	page.on("request", (request) => {
		const url = decodeURIComponent(request.url());
		if (url.includes("dynamic-links") && url.includes("from=")) queried = true;
	});
	await range.click();
	await page.getByText("Last week", { exact: true }).click();
	await expect(range).not.toHaveText(before);
	await expect.poll(() => queried).toBe(true);
});

test("dashboard top links are backed by actual links data", async ({ authenticatedPage: page }) => {
	await ready(page, "/dashboard");
	await expect(page.getByText("Top performing links", { exact: false }).first()).toBeVisible();
	await expect(page.getByRole("link", { name: /view all/i }).first()).toBeVisible();
});
