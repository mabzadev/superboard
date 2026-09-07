import { test, expect } from "../../fixtures/base-fixtures.js";
import {
	evidence,
	field,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
} from "../../fixtures/site-api.js";

const plugin = "supbrd-plugmod-dynamic-links";

test("a branded domain remains pending until its DNS is verified", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const hostname = `${unique("links")}.example.test`;
	await ready(page, "/dynamic-links/domain");
	await page.getByPlaceholder("links.example.com").fill(hostname);
	const id = await savedByClick(page, "Add domain", plugin);
	await page.reload();
	await expect(page.getByText(hostname, { exact: true }).first()).toBeVisible();
	const domains = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/dynamic-links/projects/${project}/domains`,
	);
	const saved = domains.find((item: { id: string }) => item.id === id);
	expect(saved).toBeDefined();
	expect(saved).toMatchObject({ status: "pending", verified_at: null });
	await evidence(
		plugin,
		"superboard.dynamic_links_domain",
		[id],
		"Created a branded domain in the browser, read its stored unverified state and reloaded it; no DNS verification was simulated.",
	);
});

test("platform routing rules persist their destination and priority", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const name = unique("routing");
	await ready(page, "/dynamic-links/redirect-rules");
	await page.getByRole("button", { name: "Add rule", exact: true }).click();
	await field(page, "Rule name").fill(name);
	await field(page, "Destination URL").fill("https://example.test/ios-qa");
	await field(page, "Priority").fill("987");
	await page.getByRole("switch").uncheck();
	const id = await savedByClick(page, "Save rule", plugin);
	await page.reload();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	const items = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/dynamic-links/projects/${project}/redirect-rules`,
	);
	expect(items.find((item: { id: string }) => item.id === id)).toMatchObject({
		name,
		priority: 987,
		active: false,
		rule: { platform: "ios", destination_url: "https://example.test/ios-qa" },
	});
	await evidence(
		plugin,
		"superboard.dynamic_links_redirect_rules",
		[id],
		"Created an inactive platform rule with an explicit destination and priority, then verified both fields and its inactive state after reload.",
	);
});

test("social preview saves metadata and renders the selected network preview", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const base = `/api/v1/dynamic-links/projects/${project}/social-preview`;
	const previous = await siteApi(page.request, plugin, "GET", base);
	const title = unique("Social preview");
	try {
		await ready(page, "/dynamic-links/social-media-preview");
		await field(page, "Title").fill(title);
		await field(page, "Description").fill("Native preview description");
		await field(page, "Site name or domain").fill("example.test");
		await page.getByRole("button", { name: "Save preview", exact: true }).click();
		await expect
			.poll(async () => (await siteApi(page.request, plugin, "GET", base))?.title)
			.toBe(title);
		await page.reload();
		await expect(field(page, "Title")).toHaveValue(title);
		await page.getByRole("tab", { name: "LinkedIn", exact: true }).click();
		await expect(page.getByText(title, { exact: true })).toBeVisible();
		await evidence(
			plugin,
			"superboard.dynamic_links_social_media_preview",
			[project],
			"Saved preview metadata, verified persistence after reload and switched to its live LinkedIn preview.",
		);
	} finally {
		if (previous) await siteApi(page.request, plugin, "PUT", base, previous);
	}
});

test("tracking preferences survive reload and are restored after the check", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const base = `/api/v1/dynamic-links/projects/${project}/tracking`;
	const previous = await siteApi(page.request, plugin, "GET", base);
	try {
		await ready(page, "/dynamic-links/tracking");
		const toggle = page.getByRole("switch");
		const checked = (await toggle.getAttribute("aria-checked")) === "true";
		await toggle.click();
		await page.getByRole("button", { name: "Save tracking settings", exact: true }).click();
		await expect
			.poll(async () => (await siteApi(page.request, plugin, "GET", base)).enabled)
			.toBe(!checked);
		await page.reload();
		await expect(toggle).toHaveAttribute("aria-checked", String(!checked));
		await evidence(
			plugin,
			"superboard.dynamic_links_tracking",
			[project],
			"Changed collection consent preference in the browser, read the owner setting and confirmed it after reload, then restored the original preference.",
		);
	} finally {
		await siteApi(page.request, plugin, "PUT", base, previous);
	}
});
