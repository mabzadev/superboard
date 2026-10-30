import type { PluginDiagnosticData } from "@superboard/contracts/plugin-diagnostic";
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

import { nativeFrontPluginCatalog } from "../../../../../apps/site/src/lib/native-front-plugins.js";
import {
	resolvePluginDiagnostic,
	pluginDiagnosticEtag,
} from "../../../../../apps/site/src/lib/plugin-diagnostic.js";

const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};

test("configuration discovers changed View declarations on the next request", async () => {
	const plugin = nativeFrontPluginCatalog().find(
		(entry) => entry.plugin_id === "superboard-flows",
	)!;
	const original = plugin.surfaces;
	const surface = {
		...original[0]!,
		route_id: "superboard.new_declared_view",
		path_pattern: "/acquisition/new-declared-view",
	};
	try {
		plugin.surfaces = [...original, surface];
		const withView = await resolvePluginDiagnostic(
			env,
			"superboard-acquisition",
			{ id: "operator-1", role: 50 },
			{ includeDisabled: true },
		);
		expect(withView.routes.views).toContainEqual({
			routeId: surface.route_id,
			path: surface.path_pattern,
			method: "GET",
		});
		plugin.surfaces = original;
		const withoutView = await resolvePluginDiagnostic(
			env,
			"superboard-acquisition",
			{ id: "operator-1", role: 50 },
			{ includeDisabled: true },
		);
		expect(withoutView.routes.views.some((entry) => entry.path === surface.path_pattern)).toBe(
			false,
		);
	} finally {
		plugin.surfaces = original;
	}
});

test("canonical configuration exposes current setting names and the plugin's executable API names", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-acquisition/diagnostic?include_disabled=1",
		{ headers },
	);
	expect(response.status).toBe(200);
	const data = await response.json<PluginDiagnosticData>();
	expect(data.configuration.pluginId).toBe("superboard-acquisition");
	expect(JSON.stringify(data.configuration.settingsSchema)).not.toContain("supbrd-");
	expect(
		data.routes.api
			.filter((route) => route.surface === "plugin")
			.every((route) =>
				route.path.startsWith("/_emdash/api/superboard/plugins/superboard-acquisition/"),
			),
	).toBe(true);
	expect(data.routes.views).toContainEqual(
		expect.objectContaining({ path: "/acquisition/settings" }),
	);
	expect(data.routes.views.some((route) => route.path.startsWith("/flows"))).toBe(false);
});

test("diagnostic requires operator session and returns 401 when unauthenticated", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-authentification/diagnostic",
		{
			headers: { Origin: "https://site.example" },
		},
	);
	expect(response.status).toBe(401);
});

test("diagnostic requires plugins:manage permission and returns 403 for unauthorized operator", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-authentification/diagnostic",
		{
			headers: {
				...headers,
				"X-Parity-Operator": "0",
			},
		},
	);
	expect([401, 403]).toContain(response.status);
});

test("diagnostic returns 404 for disabled plugin", async () => {
	await env.DB.prepare(
		"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT 'reference-production', 'local', 'superboard-paywalls', artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = 'superboard-paywalls' LIMIT 1",
	).run();

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-paywalls/diagnostic",
		{
			headers,
		},
	);
	expect(response.status).toBe(404);
});

test("diagnostic returns authoritative data for the requested plugin", async () => {
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state = 'active' WHERE plugin_id = 'superboard-authentification'",
	)
		.run()
		.catch(() => null);

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-authentification/diagnostic",
		{
			headers,
		},
	);
	expect(response.status).toBe(200);

	const data = (await response.json()) as Record<string, any>;
	expect(data.pluginId).toBe("superboard-authentification");
	expect(data.label).toBe("Authentification");
	expect(data.lifecycle).toBeDefined();
	expect(data.configuration).toBeDefined();
	expect(data.configuration.version).toBeDefined();
	expect(data.workers).toBeInstanceOf(Array);
	expect(data.workers.some((w: any) => w.service === "identity")).toBe(true);

	// Verifies returned routes belong to the requested plugin
	expect(data.routes).toBeDefined();
	expect(data.routes.views).toBeInstanceOf(Array);
	expect(data.routes.views.length).toBeGreaterThan(0);
	for (const view of data.routes.views) {
		expect(view.path.startsWith("/")).toBe(true);
	}
});

test("diagnostic handles multiple services sharing a Worker and multiple Workers for a plugin", async () => {
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state = 'active' WHERE plugin_id = 'superboard-monetization'",
	)
		.run()
		.catch(() => null);

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-monetization/diagnostic",
		{
			headers,
		},
	);
	expect(response.status).toBe(200);

	const data = (await response.json()) as Record<string, any>;
	expect(data.pluginId).toBe("superboard-monetization");
	expect(data.label).toBe("Monetization");

	// Monetization has multiple services: billing and products
	const serviceNames = data.workers.map((w: any) => w.service);
	expect(serviceNames).toContain("billing");
	expect(serviceNames).toContain("products");

	// products is in the API deployment group, which is shared
	const productsWorker = data.workers.find((w: any) => w.service === "products");
	expect(productsWorker).toBeDefined();
	expect(productsWorker.isShared).toBe(true);
	expect(productsWorker.sharedWith).toContain("api");
});

test("diagnostic detects expired health proof and does not treat it as implicit success", async () => {
	await env.DB.prepare(
		`INSERT OR REPLACE INTO superboard_dependency_health
		 (instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
		 VALUES (?, ?, 'ready', 'sha256:dummy', '2020-01-01T00:00:00.000Z', '2020-01-01T01:00:00.000Z')`,
	)
		.bind("reference-production", "dependency.superboard_analytics")
		.run();

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-analytics/diagnostic",
		{
			headers,
		},
	);
	expect(response.status).toBe(200);

	const data = (await response.json()) as Record<string, any>;
	expect(data.health.status).toBe("expired");
	expect(data.health.status).not.toBe("ready");
});

test("health re-check endpoint can be triggered and updates health timestamp", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-authentification/health",
		{
			method: "POST",
			headers,
		},
	);
	expect([200, 503]).toContain(response.status);

	const data = (await response.json()) as Record<string, any>;
	expect(data.status).toBeDefined();
	expect(data.checkedAt).toBeDefined();
});

test("a recheck returns the separate observations for every authentication Worker", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-authentification/health",
		{ method: "POST", headers },
	);
	expect(response.status).toBe(200);
	const data = await response.json<{
		diagnostic: PluginDiagnosticData & {
			workers: Array<{ service: string; health: { status: string; checkedAt: string } }>;
		};
	}>();
	expect(data.diagnostic.workers).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				service: "app",
				health: expect.objectContaining({ status: "ready", checkedAt: expect.any(String) }),
			}),
			expect.objectContaining({
				service: "identity",
				health: expect.objectContaining({ status: "ready", checkedAt: expect.any(String) }),
			}),
		]),
	);
});

test.each(["superboard-authentification", "superboard-data", "superboard-monetization"])(
	"%s rechecks its real Workers through the site's API binding",
	async (pluginId) => {
		const response = await SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/${pluginId}/health`,
			{ method: "POST", headers },
		);
		expect(response.status).toBe(200);
		const data = await response.json<{ status: string; checkedAt: string }>();
		expect(data.status).toBe("ready");
		expect(Number.isFinite(Date.parse(data.checkedAt))).toBe(true);
	},
);

test("an unavailable inventory never substitutes the repository adapter list", async () => {
	const data = await resolvePluginDiagnostic(
		{
			...env,
			API_SERVICE: {
				async fetch() {
					return new Response(null, { status: 503 });
				},
			},
		},
		"superboard-monetization",
		{ id: "operator-1", role: 50 },
		{ includeDisabled: true },
	);
	expect(data.routes.api).toEqual([]);
	expect(data.routes.inventory).toBeUndefined();
});

test("a push consumer does not appear as a separately deployed Worker", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-communication/diagnostic",
		{ headers },
	);
	expect(response.status).toBe(200);
	const data = await response.json<PluginDiagnosticData>();
	expect(data.workers.map((worker) => worker.service).toSorted()).toEqual(["email", "marketing"]);
});

test.each(["superboard_products", "superboard_billing"])(
	"an unavailable %s proof cannot be hidden by another healthy component",
	async (unavailable) => {
		for (const component of ["superboard_products", "superboard_billing"]) {
			await env.DB.prepare(`INSERT OR REPLACE INTO superboard_dependency_health
			(instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
			VALUES (?, ?, ?, 'sha256:fixture', ?, ?)`)
				.bind(
					"reference-production",
					`dependency.${component}`,
					component === unavailable ? "unavailable" : "ready",
					new Date().toISOString(),
					new Date(Date.now() + 3600000).toISOString(),
				)
				.run();
		}
		const response = await SELF.fetch(
			"https://site.example/_emdash/api/superboard/plugins/superboard-monetization/diagnostic",
			{ headers },
		);
		expect(response.status).toBe(200);
		const data = await response.json<PluginDiagnosticData>();
		expect(data.health.status).toBe("unavailable");
	},
);

test("service sharing follows the configured deployment instead of a default topology", async () => {
	const configuration = {
		schemaVersion: 1,
		target: "reference-production",
		environment: "local",
		profile: "dedicated",
		source: "test",
		checksum: "test",
		publicRouting: "direct",
		authIssuer: "https://auth.example.test",
		endpoints: [],
		aliases: [],
		webOrigins: [],
		customCapabilities: [],
		workers: [
			{ id: "dedicated-products", name: "instance-products-worker", modules: ["products"] },
		],
	};
	const data = await resolvePluginDiagnostic(
		{ ...env, SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON: JSON.stringify(configuration) },
		"superboard-monetization",
		{ id: "operator-1", role: 50 },
	);
	expect(data.workers.find((worker) => worker.service === "products")).toMatchObject({
		physicalName: "instance-products-worker",
		deploymentGroup: "dedicated-products",
		modules: ["products"],
		isShared: false,
		sharedWith: [],
	});
	const billing = data.workers.find((worker) => worker.service === "billing");
	expect(billing?.physicalName).toBeNull();
	expect(billing?.sharedWith).toEqual([]);
});

test("configuration describes the installed package and all its component capabilities", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-monetization/diagnostic",
		{ headers },
	);
	const data = await response.json<PluginDiagnosticData>();
	const { default: catalog } =
		await import("../../../../../scripts/config/superboard-plugin-catalog.json");
	const declaration = catalog.plugins.find(
		(plugin) =>
			plugin.manifest.plugin_id === data.pluginId ||
			plugin.canonical_manifest.plugin_id === data.pluginId ||
			plugin.directory === data.pluginId,
	);
	expect(data.configuration.version).toBe(declaration?.canonical_manifest.plugin_version);
	expect(data.configuration.settingsSchema).toEqual(
		declaration?.canonical_manifest.settings.schema,
	);
});

test.each(["diagnostic", "health"])("an unknown plugin has no %s endpoint", async (action) => {
	const response = await SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/not-installed/${action}`,
		{
			headers,
			method: action === "health" ? "POST" : "GET",
		},
	);
	expect(response.status).toBe(404);
	expect(await response.json()).toMatchObject({ error: { code: "PLUGIN_NOT_FOUND" } });
});

test.each(["", "&envelope=1"])(
	"the manager can inspect disabled configuration without enabling the plugin (%s)",
	async (format) => {
		await env.DB.prepare(
			"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT 'reference-production', 'local', 'superboard-paywalls', artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = 'superboard-paywalls' LIMIT 1",
		).run();
		const response = await SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/superboard-acquisition/diagnostic?include_disabled=1${format}`,
			{ headers },
		);
		expect(response.status).toBe(200);
		const body = await response.json<PluginDiagnosticData | { data: PluginDiagnosticData }>();
		const data = "data" in body ? body.data : body;
		expect(data.pluginId).toBe("superboard-acquisition");
		expect(data.lifecycle.state).toBe("disabled");
		expect(data.configuration.settingsSchema).not.toBeNull();
		expect(data.routes.views.length).toBeGreaterThan(0);
	},
);

test("plugin configuration reads live SDK routes by owner and observes changes on the next request", async () => {
	let currentPath = "/v1/analytics/remote-config/resolve";
	let requests = 0;
	const configuration = {
		schemaVersion: 1,
		target: env.SUPERBOARD_INSTANCE_ID,
		environment: env.SUPERBOARD_ENVIRONMENT,
		profile: "consolidated",
		source: "test",
		checksum: "test",
		publicRouting: "staged",
		authIssuer: "https://sdk.example.test/v1/auth",
		endpoints: [],
		aliases: [],
		webOrigins: [],
		customCapabilities: [],
		workers: [],
	};
	const diagnosticEnv = {
		...env,
		SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON: JSON.stringify({
			...configuration,
			routes: [
				{
					method: "GET",
					path: "/stale-route",
					surface: "sdk",
					url: "https://sdk.example.test/stale-route",
					worker: "analytics",
					clients: ["web"],
				},
			],
		}),
		API_SERVICE: {
			async fetch(request: Request) {
				expect(new URL(request.url).pathname).toBe("/internal/site/deployment-configuration");
				requests++;
				const route = { method: "POST", surface: "sdk", worker: "api", clients: ["web"] };
				return Response.json({
					configuration,
					routes: [
						{
							...route,
							path: currentPath,
							url: `https://sdk.example.test${currentPath}`,
							pluginId: "superboard-analytics",
						},
						{
							...route,
							path: "/v1/monetization/purchases/restore",
							url: "https://sdk.example.test/v1/monetization/purchases/restore",
							pluginId: "superboard-billing",
						},
					],
				});
			},
		},
	};
	for (const path of ["/v1/analytics/remote-config/resolve", "/v1/analytics/new-runtime-route"]) {
		currentPath = path;
		const diagnostic = await resolvePluginDiagnostic(
			diagnosticEnv,
			"superboard-analytics",
			{ id: "operator-1", role: 50 },
			{ includeDisabled: true },
		);
		expect(diagnostic.routes.api.filter((route) => route.surface === "sdk")).toEqual([
			{
				method: "POST",
				path,
				url: `https://sdk.example.test${path}`,
				surface: "sdk",
				worker: "api",
			},
		]);
	}
	expect(requests).toBe(2);
});

test("authentication configuration only lists its canonical auth SDK routes", async () => {
	const configuration = {
		schemaVersion: 1,
		target: env.SUPERBOARD_INSTANCE_ID,
		environment: env.SUPERBOARD_ENVIRONMENT,
		profile: "consolidated",
		source: "test",
		checksum: "test",
		publicRouting: "staged",
		authIssuer: "https://sdk.example.test/v1/auth",
		endpoints: [],
		aliases: [],
		webOrigins: [],
		customCapabilities: [],
		workers: [],
	};
	const declarations = [
		["/v1/auth", "superboard-user"],
		["/v1/auth/signin/password", "superboard-authentification"],
		["/v1/auth/oauth2/v1/token", "superboard-user"],
		["/v1/auth/*", "superboard-user"],
		["/auth/signin/password", "superboard-user"],
		["/oauth2/v1/token", "superboard-user"],
		["/.well-known/jwks.json", "superboard-user"],
		["/v1/auth-extra", "superboard-user"],
		["/v1/auth/not-owned", "superboard-analytics"],
	];
	const diagnostic = await resolvePluginDiagnostic(
		{
			...env,
			API_SERVICE: {
				async fetch() {
					return Response.json({
						configuration,
						routeInventory: {
							schemaVersion: 1,
							instanceId: env.SUPERBOARD_INSTANCE_ID,
							environment: env.SUPERBOARD_ENVIRONMENT,
							revision: "fixture",
							checkedAt: new Date().toISOString(),
							status: "complete",
							versions: "consistent",
							sources: ["api", "identity", "app", "analytics", "billing"].map((service) => ({
								service,
								workerName: service,
								status: "current",
								observedAt: null,
								buildId: "fixture",
								releaseId: "fixture",
								reason: null,
							})),
						},
						routes: declarations.map(([path, pluginId]) => ({
							method: "ALL",
							path,
							pluginId,
							surface: "sdk",
							worker: "api",
							clients: ["web"],
							url: `https://sdk.example.test${path}`,
						})),
					});
				},
			},
		},
		"superboard-authentification",
		{ id: "operator-1", role: 50 },
		{ includeDisabled: true },
	);
	expect(diagnostic.routes.inventory?.sources.map((source) => source.service)).toEqual([
		"api",
		"identity",
		"app",
	]);
	expect(diagnostic.routes.api.map((route) => route.path).toSorted()).toEqual([
		"/v1/auth",
		"/v1/auth/*",
		"/v1/auth/oauth2/v1/token",
		"/v1/auth/signin/password",
	]);
	const inventory = diagnostic.routes.inventory;
	if (!inventory) throw new Error("Missing fixture inventory");
	const scopedTag = await pluginDiagnosticEtag(diagnostic, null);
	const unscopedTag = await pluginDiagnosticEtag(
		{
			...diagnostic,
			routes: {
				...diagnostic.routes,
				inventory: {
					...inventory,
					sources: [
						...inventory.sources,
						{
							service: "analytics",
							workerName: "analytics",
							status: "current",
							observedAt: null,
							buildId: "fixture",
							releaseId: "fixture",
							reason: null,
						},
					],
				},
			},
		},
		null,
	);
	expect(scopedTag).not.toBe(unscopedTag);
	const observedTag = await pluginDiagnosticEtag(
		{
			...diagnostic,
			routes: {
				...diagnostic.routes,
				inventory: {
					...inventory,
					checkedAt: "2026-10-02T12:00:00Z",
					sources: inventory.sources.map((source) => ({
						...source,
						observedAt: "2026-10-02T12:00:00Z",
					})),
				},
			},
		},
		null,
	);
	expect(observedTag).toBe(scopedTag);
});

test("data configuration only lists SDK routes in its namespace owned by Data", async () => {
	const configuration = {
		schemaVersion: 1,
		target: env.SUPERBOARD_INSTANCE_ID,
		environment: env.SUPERBOARD_ENVIRONMENT,
		profile: "consolidated",
		source: "test",
		checksum: "test",
		publicRouting: "staged",
		authIssuer: "https://sdk.example.test/v1/auth",
		endpoints: [],
		aliases: [],
		webOrigins: [],
		customCapabilities: [],
		workers: [],
	};
	const declarations = [
		["/v1/data/content/:id", "superboard-content"],
		["/v1/data/files", "superboard-data"],
		["/v1/data/downloads/:ticket", "superboard-files"],
		["/v1/data/*", "superboard-files"],
		["/v1/files", "superboard-files"],
		["/downloads/:ticket", "superboard-files"],
		["/v1/data", "superboard-files"],
		["/v1/data-extra", "superboard-files"],
		["/v1/data/not-owned", "superboard-analytics"],
	];
	const diagnostic = await resolvePluginDiagnostic(
		{
			...env,
			API_SERVICE: {
				async fetch() {
					return Response.json({
						configuration,
						routeInventory: {
							schemaVersion: 1,
							instanceId: env.SUPERBOARD_INSTANCE_ID,
							environment: env.SUPERBOARD_ENVIRONMENT,
							revision: "fixture",
							checkedAt: new Date().toISOString(),
							status: "complete",
							versions: "consistent",
							sources: ["api", "files", "analytics"].map((service) => ({
								service,
								workerName: service,
								status: "current",
								observedAt: null,
								buildId: "fixture",
								releaseId: "fixture",
								reason: null,
							})),
						},
						routes: declarations.map(([path, pluginId]) => ({
							method: "ALL",
							path,
							pluginId,
							surface: "sdk",
							worker: "api",
							clients: ["web"],
							url: `https://sdk.example.test${path}`,
						})),
					});
				},
			},
		},
		"superboard-data",
		{ id: "operator-1", role: 50 },
		{ includeDisabled: true },
	);
	expect(diagnostic.routes.inventory?.sources.map((source) => source.service)).toEqual([
		"api",
		"files",
	]);
	expect(diagnostic.routes.api.map((route) => route.path).toSorted()).toEqual(
		[
			"/v1/data/content/:id",
			"/v1/data/*",
			"/v1/data/downloads/:ticket",
			"/v1/data/files",
		].toSorted(),
	);
});

test("support configuration only lists its canonical SDK routes and related services", async () => {
	const configuration = {
		schemaVersion: 1,
		target: env.SUPERBOARD_INSTANCE_ID,
		environment: env.SUPERBOARD_ENVIRONMENT,
		profile: "consolidated",
		source: "test",
		checksum: "test",
		publicRouting: "staged",
		authIssuer: "https://sdk.example.test/v1/auth",
		endpoints: [],
		aliases: [],
		webOrigins: [],
		customCapabilities: [],
		workers: [],
	};
	const declarations = [
		["/v1/support", "superboard-support"],
		["/v1/support/client/*", "superboard-support"],
		["/v1/support/widget/*", "supbrd-plug-support"],
		["/v1/support/help-center/*", "superboard-support"],
		["/api/v1/support-client/*", "superboard-support"],
		["/v1/communication/support/client/*", "superboard-support"],
		["/v1/support-extra", "superboard-support"],
		["/v1/support/not-owned", "superboard-analytics"],
	];
	const diagnostic = await resolvePluginDiagnostic(
		{
			...env,
			API_SERVICE: {
				async fetch() {
					return Response.json({
						configuration,
						routeInventory: {
							schemaVersion: 1,
							instanceId: env.SUPERBOARD_INSTANCE_ID,
							environment: env.SUPERBOARD_ENVIRONMENT,
							revision: "fixture",
							checkedAt: new Date().toISOString(),
							status: "complete",
							versions: "consistent",
							sources: ["api", "support", "analytics"].map((service) => ({
								service,
								workerName: service,
								status: "current",
								observedAt: null,
								buildId: "fixture",
								releaseId: "fixture",
								reason: null,
							})),
						},
						routes: declarations.map(([path, pluginId]) => ({
							method: "ALL",
							path,
							pluginId,
							surface: "sdk",
							worker: "api",
							clients: ["web"],
							url: `https://sdk.example.test${path}`,
						})),
					});
				},
			},
		},
		"superboard-support",
		{ id: "operator-1", role: 50 },
		{ includeDisabled: true },
	);
	expect(diagnostic.routes.inventory?.sources.map((source) => source.service)).toEqual([
		"api",
		"support",
	]);
	expect(diagnostic.routes.api.map((route) => route.path).toSorted()).toEqual(
		[
			"/v1/support",
			"/v1/support/client/*",
			"/v1/support/widget/*",
			"/v1/support/help-center/*",
		].toSorted(),
	);
});

test("analytics configuration only lists its own analytics SDK routes and relevant services", async () => {
	const configuration = {
		schemaVersion: 1,
		target: env.SUPERBOARD_INSTANCE_ID,
		environment: env.SUPERBOARD_ENVIRONMENT,
		profile: "consolidated",
		source: "test",
		checksum: "test",
		publicRouting: "staged",
		authIssuer: "https://sdk.example.test/v1/auth",
		endpoints: [],
		aliases: [],
		webOrigins: [],
		customCapabilities: [],
		workers: [],
	};
	const declarations = [
		["/v1/analytics", "superboard-analytics"],
		["/v1/analytics/remote-config/resolve", "superboard-analytics"],
		["/v1/analytics/new-runtime-route", "superboard-analytics"],
		["/api/v1/analytics/remote-config/resolve", "superboard-analytics"],
		["/v1/data/events", "superboard-analytics"],
		["/v1/analytics-extra", "superboard-analytics"],
		["/v1/analytics/not-owned", "superboard-billing"],
	];
	const diagnostic = await resolvePluginDiagnostic(
		{
			...env,
			API_SERVICE: {
				async fetch() {
					return Response.json({
						configuration,
						routeInventory: {
							schemaVersion: 1,
							instanceId: env.SUPERBOARD_INSTANCE_ID,
							environment: env.SUPERBOARD_ENVIRONMENT,
							revision: "fixture",
							checkedAt: new Date().toISOString(),
							status: "complete",
							versions: "consistent",
							sources: ["api", "identity", "app", "analytics", "billing"].map((service) => ({
								service,
								workerName: service,
								status: "current",
								observedAt: null,
								buildId: "fixture",
								releaseId: "fixture",
								reason: null,
							})),
						},
						routes: declarations.map(([path, pluginId]) => ({
							method: "ALL",
							path,
							pluginId,
							surface: "sdk",
							worker: "api",
							clients: ["web"],
							url: `https://sdk.example.test${path}`,
						})),
					});
				},
			},
		},
		"superboard-analytics",
		{ id: "operator-1", role: 50 },
		{ includeDisabled: true },
	);
	expect(diagnostic.routes.inventory?.sources.map((source) => source.service)).toEqual([
		"api",
		"analytics",
	]);
	expect(diagnostic.routes.api.map((route) => route.path).toSorted()).toEqual([
		"/v1/analytics",
		"/v1/analytics/new-runtime-route",
		"/v1/analytics/remote-config/resolve",
	]);
});
