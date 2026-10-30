import assert from "node:assert/strict";
import { createServer } from "node:http";

import { chromium } from "@playwright/test";

import { createRouteInventoryCollector } from "../../../packages/contracts/src/route-inventory.ts";
import { withRouteManifest } from "../../../packages/contracts/src/route-manifest.ts";
import {
	createFetchRouter,
	routeManifest,
} from "../../../packages/contracts/src/route-registry.ts";
import { deploymentRoutes } from "../../../packages/plugins/superboard-core/api/src/lib/deployment-routes.ts";

const origin = process.env.SUPERBOARD_TEST_ORIGIN ?? "http://127.0.0.1:4321";
const pluginId = "superboard-analytics";
const endpoint = "/v1/analytics/registry-proof";
const env = {
	SUPERBOARD_INSTANCE_ID: "browser-fixture",
	ENVIRONMENT: "test",
	SUPERBOARD_RELEASE: "browser-fixture",
	SUPERBOARD_WORKER_VERSION: { id: "fixture-service" },
	INTERNAL_API_TOKEN: "browser-inventory-secret",
};
function service(enabled) {
	const router = createFetchRouter({
		service: "analytics",
		module: "browser-proof",
		pluginId: "superboard-analytics",
		surface: "sdk",
		access: "public",
	});
	if (enabled) router.get(endpoint, () => new Response("executed-from-declaration"));
	return withRouteManifest(router, [router], {
		service: "analytics",
		pluginId: "superboard-analytics",
	});
}
let active = service(false);
let diagnostic;
let configuration;
let conditionals = 0;
const ownRouter = createFetchRouter({
	service: "api",
	module: "browser-proof",
	pluginId: "supbrd-core",
	surface: "internal",
	access: "internal",
});
const collect = createRouteInventoryCollector();
let fixtureOrigin;
const server = createServer(async (incoming, outgoing) => {
	try {
		const url = new URL(incoming.url, fixtureOrigin);
		let response;
		if (url.pathname === "/diagnostic") {
			const inventory = await collect({
				instanceId: env.SUPERBOARD_INSTANCE_ID,
				environment: env.ENVIRONMENT,
				own: await routeManifest(ownRouter, {
					instanceId: env.SUPERBOARD_INSTANCE_ID,
					environment: env.ENVIRONMENT,
					service: "api",
					buildId: "fixture-api",
					releaseId: "browser-fixture",
				}),
				sources: [
					{
						service: "analytics",
						workerName: "browser-worker",
						enabled: true,
						secret: env.INTERNAL_API_TOKEN,
						binding: {
							fetch: (request) =>
								fetch(new Request(`${fixtureOrigin}${new URL(request.url).pathname}`, request)),
						},
					},
				],
			});
			const etag = `W/"${inventory.revision}"`;
			if (incoming.headers["if-none-match"] === etag) {
				conditionals++;
				response = new Response(null, { status: 304, headers: { etag } });
			} else {
				const { routes, ...summary } = inventory;
				response = Response.json(
					{
						...diagnostic,
						routes: {
							views: [],
							inventory: summary,
							api: deploymentRoutes(ownRouter, configuration, routes).filter(
								(route) => route.pluginId === "superboard-analytics",
							),
						},
					},
					{ headers: { etag } },
				);
			}
		} else
			response = await active.fetch(
				new Request(`https://analytics.internal${url.pathname}`, { headers: incoming.headers }),
				env,
			);
		outgoing.writeHead(response.status, Object.fromEntries(response.headers));
		outgoing.end(Buffer.from(await response.arrayBuffer()));
	} catch (error) {
		outgoing.writeHead(500);
		outgoing.end(String(error));
	}
});
await new Promise((resolve) => {
	server.listen(0, "127.0.0.1", resolve);
});
fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(`${origin}/_emdash/api/auth/dev-bypass?redirect=/analytics/settings?lang=en`);
	await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
	const seed = await context.request.get(
		`${origin}/_emdash/api/superboard/plugins/${pluginId}/diagnostic`,
	);
	assert.equal(seed.status(), 200);
	diagnostic = await seed.json();
	const deployment = await context.request.get(
		`${origin}/_emdash/api/superboard/deployment-configuration`,
	);
	configuration = (await deployment.json()).configuration;
	await page.route("**/_emdash/api/superboard/plugins/*/diagnostic", async (route) => {
		const response = await fetch(`${fixtureOrigin}/diagnostic`, {
			headers: route.request().headers(),
		});
		await route.fulfill({
			status: response.status,
			headers: Object.fromEntries(response.headers),
			body: Buffer.from(await response.arrayBuffer()),
		});
	});
	await page.clock.install();
	await page.reload();
	await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
	const configurationTab = page
		.getByRole("tab", { name: "Configuration", exact: true })
		.or(page.getByRole("button", { name: "Configuration", exact: true }))
		.first();
	await configurationTab.focus();
	await configurationTab.press("Enter");
	await page.getByRole("button", { name: /^API Routes/u }).click();
	assert.equal((await fetch(`${fixtureOrigin}${endpoint}`)).status, 404);
	assert.equal(await page.getByText(endpoint, { exact: true }).count(), 0);
	active = service(true);
	assert.equal(
		await (await fetch(`${fixtureOrigin}${endpoint}`)).text(),
		"executed-from-declaration",
	);
	await page.clock.fastForward(31000);
	await page
		.getByRole("row")
		.filter({ has: page.getByRole("cell", { name: "GET", exact: true }) })
		.getByText(endpoint, { exact: true })
		.waitFor();
	const unchanged = page.waitForResponse(
		(response) => response.url().endsWith("/diagnostic") && response.status() === 304,
	);
	await page.clock.fastForward(31000);
	await unchanged;
	assert.ok(conditionals > 0, "unchanged inventory must reuse its ETag");
	active = service(false);
	assert.equal((await fetch(`${fixtureOrigin}${endpoint}`)).status, 404);
	await page.clock.fastForward(31000);
	await page.waitForFunction(
		(path) =>
			![...document.querySelectorAll("td")].some((cell) => cell.textContent === path),
		endpoint,
	);
	console.log(
		"PASS: executable route addition/removal reaches Configuration automatically; unchanged inventory returns 304",
	);
} finally {
	await browser.close();
	await new Promise((resolve) => {
		server.close(resolve);
	});
}
