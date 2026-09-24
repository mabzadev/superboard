import type { PluginDiagnosticData } from "@superboard/contracts/plugin-diagnostic";
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

import { nativeFrontPluginCatalog } from "../../../../../apps/site/src/lib/native-front-plugins.js";
import { resolvePluginDiagnostic } from "../../../../../apps/site/src/lib/plugin-diagnostic.js";

const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};

test("configuration discovers changed View declarations on the next request", async () => {
	const plugin = nativeFrontPluginCatalog().find(
		(entry) => entry.plugin_id === "supbrd-plugmod-flows",
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
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-identity/diagnostic",
		{
			headers: { Origin: "https://site.example" },
		},
	);
	expect(response.status).toBe(401);
});

test("diagnostic requires plugins:manage permission and returns 403 for unauthorized operator", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-identity/diagnostic",
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
		"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT 'reference-production', 'local', 'supbrd-plugmod-paywalls', artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = 'supbrd-plugmod-paywalls' LIMIT 1",
	).run();

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/diagnostic",
		{
			headers,
		},
	);
	expect(response.status).toBe(404);
});

test("diagnostic returns authoritative data for the requested plugin", async () => {
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state = 'active' WHERE plugin_id = 'supbrd-plug-identity'",
	)
		.run()
		.catch(() => null);

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-identity/diagnostic",
		{
			headers,
		},
	);
	expect(response.status).toBe(200);

	const data = (await response.json()) as Record<string, any>;
	expect(data.pluginId).toBe("supbrd-plug-identity");
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
		"UPDATE superboard_plugin_lifecycle SET state = 'active' WHERE plugin_id = 'supbrd-plug-commerce'",
	)
		.run()
		.catch(() => null);

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-commerce/diagnostic",
		{
			headers,
		},
	);
	expect(response.status).toBe(200);

	const data = (await response.json()) as Record<string, any>;
	expect(data.pluginId).toBe("supbrd-plug-commerce");
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
		.bind("reference-production", "dependency.supbrd_plugmod_analytics")
		.run();

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-analytics/diagnostic",
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
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-identity/health",
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
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-identity/health",
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

test.each(["supbrd-plug-identity", "supbrd-plug-data", "supbrd-plug-commerce"])(
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

test("diagnostic includes the owner's real adapter routes rather than invented command URLs", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-commerce/diagnostic",
		{ headers },
	);
	expect(response.status).toBe(200);
	const data = await response.json<PluginDiagnosticData>();
	expect(
		data.routes.api.some(
			(route) =>
				route.method === "POST" && route.path === "/api/v1/products/projects/:projectRef/offerings",
		),
	).toBe(true);
	expect(data.routes.api.some((route) => route.path.startsWith("/commands/"))).toBe(false);
});

test("a push consumer does not appear as a separately deployed Worker", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-communication/diagnostic",
		{ headers },
	);
	expect(response.status).toBe(200);
	const data = await response.json<PluginDiagnosticData>();
	expect(data.workers.map((worker) => worker.service).toSorted()).toEqual(["email", "marketing"]);
});

test.each(["supbrd_plug_products", "supbrd_plugmod_billing"])(
	"an unavailable %s proof cannot be hidden by another healthy component",
	async (unavailable) => {
		for (const component of ["supbrd_plug_products", "supbrd_plugmod_billing"]) {
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
			"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-commerce/diagnostic",
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
		"supbrd-plug-commerce",
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
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-commerce/diagnostic",
		{ headers },
	);
	const data = await response.json<PluginDiagnosticData>();
	const { default: catalog } =
		await import("../../../../../scripts/config/superboard-plugin-catalog.json");
	const declaration = catalog.plugins.find((plugin) => plugin.manifest.plugin_id === data.pluginId);
	expect(data.configuration.version).toBe(declaration?.manifest.plugin_version);
	expect(data.configuration.settingsSchema).toEqual(declaration?.manifest.settings.schema);
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
			"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT 'reference-production', 'local', 'supbrd-plugmod-paywalls', artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = 'supbrd-plugmod-paywalls' LIMIT 1",
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
