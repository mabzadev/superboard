import { test, expect } from "../../fixtures/base-fixtures.js";
import { evidence, ready, siteApi, unique, unwrap } from "../../fixtures/site-api.js";

test("audit synchronizes its ledger, searches persisted receipts and creates an immutable archive", async ({
	authenticatedPage: page,
}) => {
	const plugin = "supbrd-plug-audit";
	const base = "/_emdash/api/superboard/audit";
	await ready(page, "/system/audit");
	await page.getByRole("button", { name: "Synchronize and verify", exact: true }).click();
	await expect(page.getByRole("status")).toContainText("Ledger chain verified");
	const ledger = await siteApi(page.request, plugin, "GET", `${base}/ledger`);
	expect(ledger.items.length).toBeGreaterThan(0);
	const entry = ledger.items[0];
	await page.getByLabel("Search receipts", { exact: true }).fill(entry.operation_id);
	await expect(page.locator("main tbody tr").first()).toContainText(entry.operation_id);
	await page.getByLabel("First sequence", { exact: true }).fill(String(entry.sequence));
	await page.getByLabel("Last sequence", { exact: true }).fill(String(entry.sequence));
	const response = page.waitForResponse((item) => item.url().includes("command.archive_ledger"));
	await page.getByRole("button", { name: "Create immutable archive", exact: true }).click();
	const saved = await response;
	expect(saved.ok()).toBe(true);
	const archive = unwrap(await saved.json());
	expect(archive.archive_id).toBeTruthy();
	const archived = await siteApi(page.request, plugin, "GET", `${base}/archives`);
	expect(archived.items).toContainEqual(
		expect.objectContaining({ archive_id: archive.archive_id, checksum: archive.checksum }),
	);
	await page.reload();
	await expect(page.locator("main")).toContainText(archive.checksum);
	await evidence(
		plugin,
		"superboard.system_audit",
		[entry.operation_id, archive.archive_id],
		"Synchronized and verified the real ledger, searched its persisted operation, archived that sequence and reloaded the immutable checksum.",
	);
});

test("content creates, edits, publishes and reopens a document with its revision history", async ({
	authenticatedPage: page,
}) => {
	const plugin = "supbrd-plug-content";
	await ready(page, "/system/content");
	const setup = page.getByRole("button", { name: "Create document collection", exact: true });
	if (await setup.isVisible()) await setup.click();
	await expect(page.getByRole("combobox", { name: "Collection", exact: true })).not.toHaveValue("");
	const collection = await page
		.getByRole("combobox", { name: "Collection", exact: true })
		.inputValue();
	const slug = unique("retirement-document");
	const title = `Document ${slug}`;
	await page.getByRole("button", { name: "New document", exact: true }).click();
	await page.getByLabel("Slug", { exact: true }).fill(slug);
	await page
		.getByRole("textbox", { name: "Document fields (JSON)", exact: true })
		.fill(JSON.stringify({ title }));
	const created = page.waitForResponse((response) =>
		response.url().includes("command.create_document"),
	);
	await page.getByRole("button", { name: "Create document", exact: true }).click();
	const createdResponse = await created;
	expect(createdResponse.ok(), await createdResponse.text()).toBe(true);
	const createdDocument = unwrap(await createdResponse.json()).item;
	expect(createdDocument.id).toBeTruthy();
	await page
		.getByRole("textbox", { name: "Document fields (JSON)", exact: true })
		.fill(JSON.stringify({ title: `${title} edited` }));
	const updated = page.waitForResponse((response) =>
		response.url().includes("command.update_document"),
	);
	await page.getByRole("button", { name: "Save document", exact: true }).click();
	expect((await updated).ok()).toBe(true);
	const published = page.waitForResponse((response) =>
		response.url().includes("command.publish_document"),
	);
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	expect((await published).ok()).toBe(true);
	const data = await siteApi(
		page.request,
		plugin,
		"GET",
		`/_emdash/api/content/${collection}?locale=en&limit=100`,
	);
	const stored = data.items.find((item: { id: string }) => item.id === createdDocument.id);
	expect(stored).toMatchObject({ status: "published", slug, data: { title: `${title} edited` } });
	await page.reload();
	await page.getByRole("button", { name: `${title} edited · published`, exact: true }).click();
	await expect
		.poll(
			async () =>
				JSON.parse(
					await page
						.getByRole("textbox", { name: "Document fields (JSON)", exact: true })
						.inputValue(),
				).title,
		)
		.toBe(`${title} edited`);
	await page.getByRole("button", { name: "Revision history", exact: true }).click();
	await expect(page.locator("main pre")).toContainText(`${title} edited`);
	await evidence(
		plugin,
		"superboard.system_content",
		[createdDocument.id],
		"Created and edited a real CMS document, published it, compared its stored locale and content, then reloaded and opened revision history.",
	);
});

test("gateway saves a route, publishes the manifest and invokes the real API target", async ({
	authenticatedPage: page,
}) => {
	const plugin = "supbrd-plugmod-gateway";
	const id = unique("retirement-route");
	await ready(page, "/system/gateway");
	await page.getByRole("button", { name: "New route", exact: true }).click();
	await page.getByLabel("Route identifier", { exact: true }).fill(id);
	await page.getByLabel("Gateway path", { exact: true }).fill(`/${id}`);
	await page.getByLabel("Target API path", { exact: true }).fill("/health");
	const saved = page.waitForResponse((response) =>
		response.url().includes("command.update_gateway_route"),
	);
	await page.getByRole("button", { name: "Save draft route", exact: true }).click();
	expect((await saved).ok()).toBe(true);
	const routes = await siteApi(page.request, plugin, "GET", "/api/v1/gateway/routes");
	expect(routes).toContainEqual(
		expect.objectContaining({ route_id: id, target_path: "/health", path_pattern: `/${id}` }),
	);
	const published = page.waitForResponse((response) =>
		response.url().includes("command.publish_gateway_manifest"),
	);
	await page.getByRole("button", { name: "Publish gateway manifest", exact: true }).click();
	expect((await published).ok()).toBe(true);
	const manifest = await siteApi(page.request, plugin, "GET", "/api/v1/gateway/active-manifest");
	expect(manifest.routes).toContainEqual(expect.objectContaining({ route_id: id }));
	await page.getByRole("button", { name: `Test route: ${id}`, exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Result", exact: true }).locator("..").locator("pre"),
	).toContainText('"status": "ok"');
	await page.reload();
	await page.getByRole("button", { name: `GET /${id}`, exact: true }).click();
	await expect(page.getByLabel("Route identifier", { exact: true })).toHaveValue(id);
	await expect(page.locator("main")).toContainText(manifest.manifest_id);
	await evidence(
		plugin,
		"superboard.system_gateway",
		[id, manifest.manifest_id],
		"Saved a draft gateway route, published and re-read its manifest, invoked the real health target through the UI and reopened the persisted route after reload.",
	);
});
