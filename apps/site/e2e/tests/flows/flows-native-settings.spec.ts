import { test, expect } from "../../fixtures/base-fixtures.js";
import { flowFixture } from "../../fixtures/flows.js";
import {
	evidence,
	field,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
} from "../../fixtures/site-api.js";

const plugin = "supbrd-plugmod-flows";

test("new workflow dialog persists a draft and the list filters it", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const name = unique("Native workflow");
	const identifier = unique("native-workflow");
	await ready(page, "/flows/workflows");
	await page.getByRole("button", { name: "New workflow", exact: true }).click();
	await field(page, "Name").fill(name);
	await field(page, "Identifier").fill(identifier);
	const id = await savedByClick(page, "Create", plugin);
	await page.getByPlaceholder("Search workflows").fill(identifier);
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await page.reload();
	await page.getByPlaceholder("Search workflows").fill(identifier);
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	const saved = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/flows/projects/${project}/workflows/${id}`,
	);
	expect(saved).toMatchObject({ name, identifier, status: "draft" });
	expect(saved.draft.graph.blocks.map((block: { type: string }) => block.type)).toEqual([
		"start",
		"component",
	]);
	await evidence(
		plugin,
		"superboard.flows_workflows",
		[id],
		"Created a workflow through its dialog, filtered and reloaded the list, and verified the stored start/component draft graph.",
	);
});

test("environment form creates a real isolated development environment", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const name = unique("Browser environment");
	const key = unique("browser-env");
	await ready(page, "/flows/settings/environments");
	await page.getByRole("button", { name: "New environment", exact: true }).click();
	await field(page, "Name").fill(name);
	await field(page, "Identifier").fill(key);
	const id = await savedByClick(page, "Create", plugin);
	await page.reload();
	const environments = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/flows/projects/${project}/environments`,
	);
	expect(environments.items.find((item: { id: string }) => item.id === id)).toMatchObject({
		name,
		key,
		kind: "development",
		allow_draft: 1,
	});
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.flows_settings_environments",
		[id],
		"Created a development environment with its own generated SDK key, reloaded after the one-time secret display and verified draft permission and identifier.",
	);
});

test("localization saves language fallback rules and reloads the selected group", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const name = unique("Locales");
	await ready(page, "/flows/settings/localization");
	await page.getByRole("button", { name: "New group", exact: true }).click();
	await field(page, "Name").fill(name);
	await page.getByPlaceholder("en, fr, de").fill("en, fr, fr-CH");
	await page.getByPlaceholder("fr-CH:fr, fr:en").fill("fr-CH:fr, fr:en");
	const id = await savedByClick(page, "Save changes", plugin);
	await page.reload();
	await page.getByRole("button", { name, exact: true }).click();
	await expect(page.getByPlaceholder("fr-CH:fr, fr:en")).toHaveValue("fr-CH:fr, fr:en");
	const saved = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/flows/projects/${project}/localization`,
	);
	expect(saved.items.find((item: { id: string }) => item.id === id)).toMatchObject({
		name,
		locales: ["en", "fr", "fr-CH"],
		fallbacks: { "fr-CH": "fr", fr: "en" },
	});
	await evidence(
		plugin,
		"superboard.flows_settings_localization",
		[id],
		"Created a language group, saved fr-CH→fr→en fallbacks, selected the group after reload and verified the persisted locales.",
	);
});

test("SDK examples use and copy the selected real project environment", async ({
	authenticatedPage: page,
}) => {
	const f = await flowFixture(page);
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await ready(page, "/flows/settings/sdk");
	await page.locator("main").getByRole("combobox").click();
	await page.getByRole("option", { name: f.environment.name, exact: true }).click();
	await page.getByRole("tab", { name: "React", exact: true }).click();
	const panel = page.getByRole("tabpanel");
	await panel.getByRole("button", { name: "Copy code", exact: true }).last().click();
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toContain(f.project);
	expect(copied).toContain(f.environment.key);
	expect(copied).toContain("https://api.autonomy-qa.example.test");
	await evidence(
		plugin,
		"superboard.flows_settings_sdk",
		[f.project, f.environment.id],
		"Selected a real environment and copied the React initialization code; the clipboard contains its project, environment and explicitly configured public API origin.",
	);
});

test("launchpad group persists its environment and pause state", async ({
	authenticatedPage: page,
}) => {
	const f = await flowFixture(page);
	const name = unique("Launchpad");
	await ready(page, "/flows/launchpad");
	await page.getByRole("button", { name: "New group", exact: true }).first().click();
	await field(page, "Name").fill(name);
	await page.getByRole("dialog").getByRole("combobox").click();
	await page.getByRole("option", { name: f.environment.name, exact: true }).click();
	const id = await savedByClick(page, "Create", plugin);
	const card = page
		.getByText(name, { exact: true })
		.locator('xpath=ancestor::*[@data-slot="card"][1]');
	await card.getByRole("button", { name: "Pause", exact: true }).click();
	await expect
		.poll(
			async () =>
				(await f.request("GET", "/launchpad")).groups.find(
					(group: { id: string }) => group.id === id,
				)?.paused,
		)
		.toBe(1);
	await page.reload();
	await expect(card.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.flows_launchpad",
		[id, f.environment.id],
		"Created an environment-scoped launchpad group, paused it through the browser and verified the saved state after reload.",
	);
});
