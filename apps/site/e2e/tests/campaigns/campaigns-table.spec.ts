import { test, expect } from "../../fixtures/base-fixtures.js";
import { evidence, ready, unique } from "../../fixtures/site-api.js";

test("creates a campaign and reopens its real named detail from the list", async ({
	authenticatedPage: page,
}) => {
	const name = unique("Campaign");
	await ready(page, "/dynamic-links/campaigns");
	await page.getByRole("button", { name: "Create campaign", exact: true }).first().click();
	await page.getByRole("dialog").getByPlaceholder("Summer launch").fill(name);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Create campaign", exact: true })
		.click();
	await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
	const id = new URL(page.url()).pathname.split("/").at(-1)!;
	await page.reload();
	await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
	await ready(page, "/dynamic-links/campaigns");
	await page.getByRole("button", { name: new RegExp(name) }).click();
	await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
	await evidence(
		"supbrd-plugmod-dynamic-links",
		"superboard.dynamic_links_campaigns",
		[id],
		"Created campaign, reloaded its named detail, and reopened it from the persisted list.",
	);
	await evidence(
		"supbrd-plugmod-dynamic-links",
		"superboard.dynamic_links_campaigns_by_id",
		[id],
		"Resolved persisted campaign identity and its links view after navigation and reload.",
	);
});
