import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import {
	evidence,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
} from "../../../fixtures/site-browser/site-api.js";

const viewMetric = /^view$/;

test("paywall editor saves and publishes a version that has measured views", async ({
	authenticatedPage: page,
}) => {
	const plugin = "supbrd-plugmod-paywalls";
	const project = await projectRef(page);
	const base = `/api/v1/paywalls/projects/${project}`;
	const identifier = unique("wall");
	const name = unique("Native paywall");
	await ready(page, "/paywalls");
	await page.getByPlaceholder("Identifier", { exact: true }).fill(identifier);
	await page.getByPlaceholder("Display name", { exact: true }).fill(name);
	const id = await savedByClick(page, "Create paywall", plugin);
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: "Spacer", exact: true }).click();
	await expect(page.getByRole("button", { name: "Delete spacer", exact: true })).toBeVisible();
	await page.getByPlaceholder("What changed?").fill("Added spacing from browser");
	const versionId = await savedByClick(page, "Save immutable draft", plugin);
	const versions = await siteApi(page.request, plugin, "GET", `${base}/paywalls/${id}/versions`);
	expect(
		versions
			.find((version: { id: string }) => version.id === versionId)
			.definition.components.some((component: { type: string }) => component.type === "spacer"),
	).toBe(true);
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect
		.poll(
			async () =>
				(await siteApi(page.request, plugin, "GET", `${base}/paywalls/${id}/versions`)).find(
					(version: { id: string }) => version.id === versionId,
				)?.status,
		)
		.toBe("published");
	await page.reload();
	await page.getByRole("button").filter({ hasText: name }).click();
	await expect(
		page.getByText("published · Added spacing from browser", { exact: true }),
	).toBeVisible();
	await evidence(
		plugin,
		"superboard.paywalls",
		[id, versionId],
		"Created a paywall in the browser, added a spacer in the visual editor, saved an immutable version, published it and reopened the persisted version.",
	);
	const key = unique("wall-placement");
	const placement = await siteApi(page.request, plugin, "POST", `${base}/placements`, {
		key,
		paywall_id: id,
		active_version_id: versionId,
		priority: 100,
		active: true,
		targeting: {},
	});
	const event = {
		id: crypto.randomUUID(),
		type: "view",
		placement: key,
		paywall_id: id,
		version_id: versionId,
		platform: "ios",
		occurred_at: new Date().toISOString(),
	};
	await siteApi(page.request, plugin, "POST", `${base}/events`, { events: [event] });
	await siteApi(page.request, plugin, "POST", `${base}/events`, { events: [event] });
	const stats = await siteApi(
		page.request,
		plugin,
		"GET",
		`${base}/statistics?version_id=${versionId}`,
	);
	expect(stats.totals.view).toBe(1);
	await ready(page, "/paywalls/statistics");
	await page.getByPlaceholder("All versions").fill(versionId);
	const metric = page
		.locator('[data-slot="card-description"]')
		.filter({ hasText: viewMetric })
		.locator('xpath=ancestor::*[@data-slot="card"][1]')
		.locator('[data-slot="card-title"]');
	await expect(metric).toHaveText("1");
	const platform = page.locator("select").filter({ has: page.locator('option[value="ios"]') });
	await platform.selectOption("android");
	await expect(metric).toHaveText("0");
	await platform.selectOption("ios");
	await expect(metric).toHaveText("1");
	await evidence(
		plugin,
		"superboard.paywalls_statistics",
		[id, versionId, placement.id, event.id],
		"Recorded and replayed the same native paywall view, verified deduplication, and filtered its browser statistics by version and platform (iOS1, Android0).",
	);
});

test("onboarding statistics reflect native completion events and the selected version", async ({
	authenticatedPage: page,
}) => {
	const plugin = "supbrd-plugmod-onboardings";
	const project = await projectRef(page);
	const base = `/api/v1/onboardings/projects/${project}`;
	const definition = {
		screens: [
			{ id: "welcome", blocks: [{ id: "heading", type: "heading", text: "Native onboarding" }] },
		],
		theme: { primary: "#635bff" },
	};
	const created = await siteApi(page.request, plugin, "POST", base, {
		identifier: unique("onboarding-stats"),
		display_name: "Native onboarding statistics",
		configuration: definition,
	});
	const version = await siteApi(page.request, plugin, "POST", `${base}/${created.id}/versions`, {
		configuration: definition,
	});
	await siteApi(page.request, plugin, "POST", `${base}/${created.id}/publish`, {
		version_id: version.id,
	});
	const key = unique("onboarding-placement");
	const placement = await siteApi(page.request, plugin, "POST", `${base}/placements`, {
		key,
		name: key,
		onboarding_id: created.id,
		active_version_id: version.id,
		priority: 100,
		active: true,
	});
	const events = ["impression", "step_view", "complete"].map((type) => ({
		id: crypto.randomUUID(),
		type,
		placement: key,
		platform: "ios",
		version_id: version.id,
		step_id: type === "step_view" ? "welcome" : undefined,
		occurred_at: new Date().toISOString(),
	}));
	await siteApi(page.request, plugin, "POST", `${base}/events`, { events });
	const stats = await siteApi(
		page.request,
		plugin,
		"GET",
		`${base}/statistics?version_id=${version.id}`,
	);
	expect(stats).toMatchObject({
		totals: { impression: 1, step_view: 1, complete: 1 },
		completion_rate: 1,
	});
	await ready(page, "/onboardings/statistics");
	await page.getByPlaceholder("All versions").fill(version.id);
	const completion = page
		.getByText("completion rate", { exact: true })
		.locator('xpath=ancestor::*[@data-slot="card"][1]')
		.locator('[data-slot="card-title"]');
	await expect(completion).toHaveText("100.0%");
	await expect(page.getByText("welcome", { exact: true }).first()).toBeVisible();
	await evidence(
		plugin,
		"superboard.onboardings_statistics",
		[created.id, version.id, placement.id, ...events.map((event) => event.id)],
		"Published an onboarding version, recorded its native impression/step/completion events and verified the filtered UI reports one complete journey and the matching step.",
	);
});

test("onboarding editor keeps a block added after creating its first draft", async ({
	authenticatedPage: page,
}) => {
	const plugin = "supbrd-plugmod-onboardings";
	const project = await projectRef(page);
	const base = `/api/v1/onboardings/projects/${project}`;
	await ready(page, "/onboardings");
	await page.getByPlaceholder("Identifier", { exact: true }).fill(unique("onboarding-editor"));
	await page
		.getByPlaceholder("Display name", { exact: true })
		.fill(unique("Native onboarding editor"));
	const id = await savedByClick(page, "Create onboarding", plugin);
	await page.getByRole("button", { name: "Spacer", exact: true }).click();
	await expect(page.getByRole("button", { name: "Delete spacer", exact: true })).toBeVisible();
	const versionId = await savedByClick(page, "Save immutable draft", plugin);
	const versions = await siteApi(page.request, plugin, "GET", `${base}/${id}/versions`);
	expect(
		versions
			.find((version: { id: string }) => version.id === versionId)
			.configuration.screens[0].blocks.some((block: { type: string }) => block.type === "spacer"),
	).toBe(true);
});
