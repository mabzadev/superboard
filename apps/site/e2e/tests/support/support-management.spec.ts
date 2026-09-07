import type { Page } from "@playwright/test";

import { test, expect } from "../../fixtures/base-fixtures.js";
import { evidence, field, projectRef, ready, siteApi, unique } from "../../fixtures/site-api.js";

const plugin = "supbrd-plugmod-support";
const labelArea = /^Label\s*\d+$/;
const productionSuffix = /-prod$/;
async function testProject(page: Page, path: string) {
	const ref = (await projectRef(page)).replace(productionSuffix, "-test");
	await ready(page, path);
	await page.getByRole("combobox", { name: "Environment", exact: true }).selectOption("test");
	await page.waitForLoadState("networkidle");
	return ref;
}

test("Support settings persist the selected Test profile and restore its business name", async ({
	authenticatedPage: page,
}) => {
	const ref = await testProject(page, "/support/settings");
	const path = `/api/v1/support/projects/${ref}/settings`;
	const original = (await siteApi(page.request, plugin, "GET", path)).settings;
	const name = unique("Support QA");
	try {
		await field(page, "Business name").fill(name);
		await page.getByRole("button", { name: "Save settings", exact: true }).click();
		await expect
			.poll(async () => (await siteApi(page.request, plugin, "GET", path)).settings.business_name)
			.toBe(name);
		await page.reload();
		await expect(field(page, "Business name")).toHaveValue(name);
		await evidence(
			plugin,
			"superboard.support_settings",
			[ref],
			"Changed the Test Support business profile through its form and verified the owning API and reloaded field before restoring the previous name.",
		);
	} finally {
		await siteApi(page.request, plugin, "PATCH", path, { business_name: original.business_name });
	}
});

test("Support configuration creates and edits a validated label", async ({
	authenticatedPage: page,
}) => {
	const ref = await testProject(page, "/support/configuration");
	const path = `/api/v1/support/projects/${ref}/settings`;
	const name = unique("configuration-label");
	await page.getByRole("button", { name: labelArea }).click();
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill(name);
	await page.getByLabel("Color *", { exact: true }).fill("#223344");
	await page.getByRole("button", { name: "Save label", exact: true }).click();
	await expect
		.poll(async () =>
			(await siteApi(page.request, plugin, "GET", path)).entities.some(
				(item: { name: string }) => item.name === name,
			),
		)
		.toBe(true);
	const item = (await siteApi(page.request, plugin, "GET", path)).entities.find(
		(entry: { name: string }) => entry.name === name,
	);
	await page.getByRole("button", { name, exact: false }).click();
	await page.getByLabel("Name", { exact: true }).fill(`${name} edited`);
	await page.getByRole("button", { name: "Save label", exact: true }).click();
	await expect
		.poll(
			async () =>
				(await siteApi(page.request, plugin, "GET", path)).entities.find(
					(entry: { id: string }) => entry.id === item.id,
				)?.name,
		)
		.toBe(`${name} edited`);
	await page.reload();
	await page.getByRole("button", { name: labelArea }).click();
	await page.getByRole("button", { name: `${name} edited`, exact: false }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`${name} edited`);
	await evidence(
		plugin,
		"superboard.support_configuration",
		[item.id],
		"Created and edited a Worker-validated configuration label, compared its persisted ID and name, and reopened it after reload.",
	);
});

test("Support channels attach a connection to a native inbox and restore it after reload", async ({
	authenticatedPage: page,
}) => {
	const ref = await testProject(page, "/support/channels");
	const name = unique("support-connection");
	const base = `/api/v1/support/projects/${ref}`;
	const inbox = await siteApi(page.request, plugin, "POST", `${base}/workforce/inboxes`, {
		name,
		identifier: name,
		channel_type: "widget",
		status: "active",
		auto_assignment: false,
		allow_reopen: true,
		csat_enabled: false,
	});
	expect(inbox.id).toBeTruthy();
	await page.reload();
	await page.getByRole("tab", { name: "Connections", exact: true }).click();
	await page.getByPlaceholder("Customer care", { exact: true }).fill(name);
	await page.getByRole("combobox", { name: "Inbox", exact: true }).selectOption(inbox.id);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await expect
		.poll(async () =>
			(await siteApi(page.request, plugin, "GET", `${base}/providers`)).some(
				(item: { display_name: string }) => item.display_name === name,
			),
		)
		.toBe(true);
	const provider = (await siteApi(page.request, plugin, "GET", `${base}/providers`)).find(
		(item: { display_name: string }) => item.display_name === name,
	);
	expect(provider.inbox_id).toBe(inbox.id);
	await page.reload();
	await expect(page.locator("main")).toContainText(name);
	await page.getByRole("tab", { name: "Connections", exact: true }).click();
	await expect(page.locator("main")).toContainText(name);
	await evidence(
		plugin,
		"superboard.support_channels",
		[inbox.id, provider.id],
		"Attached a widget connection through its form to a real native inbox, verified the stored relationship, and reloaded both Channels and Connections views.",
	);
});

test("Support integrations save and reopen a dashboard app without external delivery", async ({
	authenticatedPage: page,
}) => {
	const ref = await testProject(page, "/support/integrations");
	const name = unique("support-app");
	const path = `/api/v1/support/projects/${ref}/integrations`;
	const appUrl = "https://support-panel.example.test/operator";
	await page.getByLabel("Integration", { exact: true }).selectOption("api");
	await page.getByLabel("Display name", { exact: true }).fill(name);
	await page.getByLabel("App URL", { exact: true }).fill(appUrl);
	await page.getByRole("button", { name: "Add and configure", exact: true }).click();
	await expect
		.poll(async () =>
			(await siteApi(page.request, plugin, "GET", path)).some(
				(item: { display_name: string }) => item.display_name === name,
			),
		)
		.toBe(true);
	const integration = (await siteApi(page.request, plugin, "GET", path)).find(
		(item: { display_name: string }) => item.display_name === name,
	);
	expect(integration.settings.app_url).toBe(appUrl);
	await page.reload();
	await page.getByPlaceholder("Search", { exact: true }).fill(name);
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page.locator("main")).toContainText(name);
	await page
		.getByText(name, { exact: true })
		.locator('xpath=ancestor::*[@data-slot="card"][1]')
		.getByRole("button", { name: "Configure", exact: true })
		.click();
	await expect(page.locator("#configured-integration-target")).toHaveValue(appUrl);
	const updatedUrl = `${appUrl}/updated`;
	await page.locator("#configured-integration-target").fill(updatedUrl);
	await page.getByRole("button", { name: "Save securely", exact: true }).click();
	await expect
		.poll(
			async () =>
				(await siteApi(page.request, plugin, "GET", path)).find(
					(item: { id: string }) => item.id === integration.id,
				)?.settings.app_url,
		)
		.toBe(updatedUrl);
	await expect(page.locator("#configured-integration-target")).toHaveCount(0);
	await evidence(
		plugin,
		"superboard.support_integrations",
		[integration.id],
		"Configured a dashboard app using the integration form, verified its stored target URL, searched it after reload and saved an updated target through its configuration form; no external delivery was initiated.",
	);
});
