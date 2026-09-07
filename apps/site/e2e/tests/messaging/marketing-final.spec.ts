import { test, expect } from "../../fixtures/base-fixtures.js";
import {
	evidence,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
	unwrap,
} from "../../fixtures/site-api.js";
const plugin = "supbrd-plugmod-marketing";

test("provider webhook settings persist an encrypted inbound credential", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const provider = unique("qa-provider");
	const secret = crypto.randomUUID();
	await ready(page, "/marketing/settings");
	await page.getByPlaceholder("Provider identifier").fill(provider);
	await page.getByPlaceholder("Shared secret (minimum 16 characters)").fill(secret);
	const id = await savedByClick(page, "Create endpoint", plugin);
	await page.reload();
	await expect(page.getByText(provider, { exact: true })).toBeVisible();
	const result = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/marketing/projects/${project}/settings/provider-webhooks`,
	);
	expect(result.find((item: { id: string }) => item.id === id)).toMatchObject({ provider });
	expect(JSON.stringify(result).includes(secret)).toBe(false);
	await evidence(
		plugin,
		"superboard.marketing_settings",
		[id],
		"Created an inbound provider webhook credential through the form, reloaded its provider metadata and confirmed the read API does not disclose the secret.",
	);
});

test("statistics refresh reflects the real subscriber count and selected interval", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const base = `/api/v1/marketing/projects/${project}`;
	const before = await siteApi(page.request, plugin, "GET", `${base}/statistics`);
	const subscriber = await siteApi(page.request, plugin, "POST", `${base}/email/subscribers`, {
		email: `${unique("stat-subscriber")}@example.test`,
		name: "Statistics QA",
		double_opt_in: false,
	});
	await ready(page, "/marketing/statistics");
	const metric = page
		.getByText("subscribers", { exact: true })
		.locator('xpath=ancestor::*[@data-slot="card"][1]')
		.locator('[data-slot="card-title"]');
	await expect(metric).toHaveText(String(before.totals.subscribers + 1));
	await page
		.getByRole("combobox", { name: "Statistics interval", exact: true })
		.selectOption("week");
	const response = page.waitForResponse(
		(item) =>
			item.request().method() === "GET" &&
			decodeURIComponent(item.url()).includes("/statistics") &&
			decodeURIComponent(item.url()).includes("interval=week"),
	);
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	const result = unwrap(await (await response).json());
	expect(result.totals.subscribers).toBe(before.totals.subscribers + 1);
	await expect(metric).toHaveText(String(result.totals.subscribers));
	await evidence(
		plugin,
		"superboard.marketing_statistics",
		[subscriber.id],
		"Created a subscriber without sending mail, observed the count increase in statistics and refreshed with the selected weekly interval.",
	);
});
