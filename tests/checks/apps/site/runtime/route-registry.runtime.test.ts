import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { parseRouteManifest } from "@superboard/contracts/route-manifest";
import { expect, test } from "vitest";

import customWorker from "../../../../../apps/reference/worker/src/index.js";
import worker4 from "../../../../../packages/plugins/superboard-acquisition/dynamic-links/src/index.js";
import worker5 from "../../../../../packages/plugins/superboard-acquisition/flows/src/index.js";
import worker7 from "../../../../../packages/plugins/superboard-acquisition/onboardings/src/index.js";
import worker6 from "../../../../../packages/plugins/superboard-acquisition/paywalls/src/index.js";
import worker2 from "../../../../../packages/plugins/superboard-analytics/worker/src/index.js";
import worker12 from "../../../../../packages/plugins/superboard-authentification/worker/src/index.js";
import emailWorker from "../../../../../packages/plugins/superboard-communication/email/src/index.js";
import worker3 from "../../../../../packages/plugins/superboard-communication/marketing/src/index.js";
import worker0 from "../../../../../packages/plugins/superboard-core/api/src/index.js";
import worker1 from "../../../../../packages/plugins/superboard-core/app/src/index.js";
import mcpWorker from "../../../../../packages/plugins/superboard-core/mcp/src/index.js";
import observabilityWorker from "../../../../../packages/plugins/superboard-core/observability/src/index.js";
import worker10 from "../../../../../packages/plugins/superboard-data/worker/src/index.js";
import worker8 from "../../../../../packages/plugins/superboard-monetization/billing/src/index.js";
import worker9 from "../../../../../packages/plugins/superboard-monetization/products/src/index.js";
import worker11 from "../../../../../packages/plugins/superboard-support/worker/src/index.js";
import { ALL_SERVICES } from "../../../../../scripts/cloudflare/services.mjs";
import { pluginDatabase } from "./retirement-api-helpers.js";

const services = [
	["email", emailWorker],
	["observability", observabilityWorker],
	["mcp", mcpWorker],
	["custom", customWorker],
	["api", worker0],
	["app", worker1],
	["analytics", worker2],
	["marketing", worker3],
	["dynamic-links", worker4],
	["flows", worker5],
	["paywalls", worker6],
	["onboardings", worker7],
	["billing", worker8],
	["products", worker9],
	["files", worker10],
	["support", worker11],
	["identity", worker12],
] as const;

for (const [service, worker] of services)
	test(`${service} publishes the routes mounted by its real runtime`, async () => {
		const token = "route-manifest-runtime-test";
		const bindings = {
			DB: pluginDatabase("api"),
			EMAIL_INTERNAL_TOKEN: token,
			OBSERVABILITY_INTERNAL_TOKEN: token,
			CUSTOM_WORKER_TOKEN: token,
			SUPERBOARD_INSTANCE_ID: "route-tests",
			ENVIRONMENT: "test",
			MODULE_INTERNAL_TOKEN: token,
			INTERNAL_API_TOKEN: token,
			FILES_INTERNAL_TOKEN: token,
			FLOWS_INTERNAL_TOKEN: token,
			SUPERBOARD_WORKER_VERSION: { id: "executing-test-version" },
		};
		const runtimeBindings = {
			...bindings,
			API_SERVICE: {
				fetch: (request: Request) =>
					worker0.fetch(request, bindings as never, {} as ExecutionContext),
			},
		};
		const request = new Request(`https://${service}.internal/internal/route-manifest/v1`);
		const response = await worker.fetch(
			new Request(request, { headers: await signPluginTaskRequest(request, token) }),
			runtimeBindings as never,
			{} as ExecutionContext,
		);
		const body: unknown = await response.json();
		expect({ status: response.status, error: response.status === 200 ? undefined : body }).toEqual({
			status: 200,
			error: undefined,
		});
		const manifest = parseRouteManifest(body);
		expect(manifest.service).toBe(service);
		expect(manifest.buildId).toBe("executing-test-version");
		expect(manifest.routes.length).toBeGreaterThan(1);
		expect(manifest.routes.every((route) => route.pluginId && route.access)).toBe(true);
	});

test("every maintained Worker in the deployment catalog has an executable inventory check", () => {
	expect(services.map(([service]) => service).toSorted()).toEqual(
		ALL_SERVICES.filter((service: string) => service !== "site").toSorted(),
	);
});

test("App inventory separates SDK credential infrastructure and Settings from User endpoints", async () => {
	const token = "app-route-owner-test";
	const request = new Request("https://app.internal/internal/route-manifest/v1");
	const response = await worker1.fetch(
		new Request(request, { headers: await signPluginTaskRequest(request, token) }),
		{
			INTERNAL_API_TOKEN: token,
			SUPERBOARD_INSTANCE_ID: "route-tests",
			ENVIRONMENT: "test",
		},
		{} as ExecutionContext,
	);
	const manifest = parseRouteManifest(await response.json());
	const owner = (method: string, path: string) =>
		manifest.routes.find((route) => route.method === method && route.path === path)?.pluginId;
	expect(owner("POST", "/internal/v1/customer-events")).toBe("superboard-user");
	expect(owner("POST", "/internal/v1/sdk-credentials/resolve")).toBe("supbrd-core");
	expect(owner("POST", "/internal/v1/runtime-policy/resolve")).toBe("superboard-settings");
	expect(owner("PUT", "/internal/v1/setup/:platform")).toBe("superboard-settings");
	expect(owner("GET", "/internal/v1/customers/:id")).toBe("superboard-user");
});

test("Files publishes its operator endpoints from the mounted routing table", async () => {
	const token = "files-route-inventory-test";
	const request = new Request("https://files.internal/internal/route-manifest/v1");
	const bindings = {
		FILES_INTERNAL_TOKEN: token,
		MAX_FILE_BYTES: "1048576",
		SUPERBOARD_INSTANCE_ID: "route-tests",
		ENVIRONMENT: "test",
	};
	const response = await worker10.fetch(
		new Request(request, { headers: await signPluginTaskRequest(request, token) }),
		bindings,
		{},
	);
	const manifest = parseRouteManifest(await response.json());
	for (const [method, path] of [
		["POST", "/internal/v1/operator/upload-tickets"],
		["PUT", "/internal/v1/operator/upload-tickets/:ticketId/content"],
		["POST", "/internal/v1/operator/upload-tickets/:ticketId/complete"],
		["GET", "/internal/v1/operator/objects"],
		["GET", "/internal/v1/operator/usage"],
		["GET", "/internal/v1/operator/objects/:id"],
		["DELETE", "/internal/v1/operator/objects/:id"],
		["POST", "/internal/v1/operator/objects/:id/restore"],
		["GET", "/internal/v1/operator/objects/:id/download-ticket"],
		["GET", "/internal/v1/operator/objects/:id/content"],
		["POST", "/internal/v1/operator/collect-garbage"],
	] as const) {
		expect(manifest.routes).toContainEqual(
			expect.objectContaining({
				method,
				path,
				pluginId: "superboard-files",
				access: "internal",
			}),
		);
		const denied = await worker10.fetch(
			new Request(
				`https://files.internal${path.replace(":id", "fixture").replace(":ticketId", "fixture")}`,
				{ method },
			),
			bindings,
			{},
		);
		expect(denied.status).toBe(401);
	}
});

test("Flows executes legacy aliases while their manifests retain the owning plugin", async () => {
	const { createProjectContextHeaders } = await import("@superboard/contracts/project-context");
	const { resolveManifestRoute } = await import("@superboard/contracts/route-registry");
	const token = "legacy-route-inventory-test";
	const bindings = {
		DB: pluginDatabase("flows"),
		INTERNAL_API_TOKEN: token,
		SUPERBOARD_INSTANCE_ID: "route-tests",
		ENVIRONMENT: "test",
	};
	const manifestRequest = new Request("https://flows.internal/internal/route-manifest/v1");
	const manifestResponse = await worker5.fetch(
		new Request(manifestRequest, { headers: await signPluginTaskRequest(manifestRequest, token) }),
		bindings as never,
		{} as ExecutionContext,
	);
	expect(manifestResponse.status).toBe(200);
	const manifest = parseRouteManifest(await manifestResponse.json());
	for (const source of ["paywalls", "onboardings"] as const) {
		for (const suffix of ["/health", "/paywalls"]) {
			const path = `/internal/v1/legacy/${source}${suffix}`;
			const headers = await createProjectContextHeaders(
				{
					module: "flows",
					method: "GET",
					pathname: path,
					projectId: 778,
					projectRef: "778-test",
					instanceId: 778,
					environment: "test",
					actorId: 1,
					role: "owner",
					requestId: crypto.randomUUID(),
					issuedAt: Math.floor(Date.now() / 1000),
				},
				token,
			);
			const response = await worker5.fetch(
				new Request(`https://flows.internal${path}`, { headers }),
				bindings as never,
				{} as ExecutionContext,
			);
			expect({
				status: response.status,
				error: response.ok ? undefined : await response.clone().text(),
			}).toEqual({ status: 200, error: undefined });
			const resolved = resolveManifestRoute(manifest.routes, "GET", "internal", path);
			expect(resolved?.route).toMatchObject({
				service: "flows",
				pluginId: `superboard-${source}`,
				method: "GET",
				kind: suffix === "/paywalls" ? "alias" : "canonical",
			});
			expect(await response.json()).toMatchObject(
				suffix === "/health" ? { service: source, runtime: "flows" } : { data: [] },
			);
		}
	}
});

test("managed extensions authenticate discovery through the private Core binding", async () => {
	const { createFetchRouter } = await import("@superboard/contracts/route-registry");
	const { withRouteManifest } = await import("@superboard/contracts/route-manifest");
	const service = "managed-fixture";
	const routes = createFetchRouter<void>({
		service,
		module: "managed",
		pluginId: "supbrd-plugmod-fixture",
		surface: "internal",
		access: "internal",
	});
	routes.get("/items", () => Response.json({ items: [] }));
	const worker = withRouteManifest(
		{ fetch: (request: Request, _env: object) => routes.fetch(request, undefined) },
		[routes],
		{ service, pluginId: "supbrd-plugmod-fixture" },
	);
	const token = "managed-discovery-token";
	const bindings = {
		SUPERBOARD_INSTANCE_ID: "managed-instance",
		ENVIRONMENT: "test",
		SUPERBOARD_WORKER_VERSION: { id: "managed-version" },
		API_SERVICE: {
			fetch: (request: Request) =>
				worker0.fetch(request, { MODULE_INTERNAL_TOKEN: token } as never, {} as ExecutionContext),
		},
	};
	const request = new Request("https://managed-fixture.internal/internal/route-manifest/v1");
	const response = await worker.fetch(
		new Request(request, { headers: await signPluginTaskRequest(request, token) }),
		bindings,
	);
	expect(response.status).toBe(200);
	const manifest = parseRouteManifest(await response.json());
	expect(manifest).toMatchObject({
		service,
		instanceId: "managed-instance",
		buildId: "managed-version",
	});
	expect(manifest.routes.some((route) => route.path === "/items" && route.method === "GET")).toBe(
		true,
	);
	expect((await worker.fetch(request, bindings)).status).toBe(403);
});

test("Data inventory expands the Files proxy into its executable SDK endpoints", async () => {
	const { createRouteInventoryCollector } = await import("@superboard/contracts/route-inventory");
	const token = "data-inventory-test";
	const bindings = {
		DB: pluginDatabase("api"),
		SUPERBOARD_INSTANCE_ID: "route-tests",
		ENVIRONMENT: "test",
		INTERNAL_API_TOKEN: token,
		MODULE_INTERNAL_TOKEN: token,
		FILES_INTERNAL_TOKEN: token,
	};
	const request = new Request("https://api.internal/internal/route-manifest/v1");
	const response = await worker0.fetch(
		new Request(request, { headers: await signPluginTaskRequest(request, token) }),
		bindings as never,
		{} as ExecutionContext,
	);
	expect(response.status).toBe(200);
	const own = parseRouteManifest(await response.json());
	const inventory = await createRouteInventoryCollector()({
		instanceId: "route-tests",
		environment: "test",
		own,
		sources: [
			{
				service: "files",
				workerName: "files",
				enabled: true,
				secret: token,
				binding: {
					fetch: (manifestRequest: Request) =>
						worker10.fetch(manifestRequest, bindings as never, {} as ExecutionContext),
				},
			},
		],
	});
	const routes = inventory.routes.filter(
		(route) =>
			route.surface === "sdk" && route.path.startsWith("/v1/data/") && route.kind === "canonical",
	);
	for (const [method, path] of [
		["GET", "/v1/data/files"],
		["POST", "/v1/data/files"],
		["GET", "/v1/data/files/:id"],
		["DELETE", "/v1/data/files/:id"],
		["GET", "/v1/data/files/:id/content"],
	]) {
		expect(routes).toContainEqual(
			expect.objectContaining({ method, path, pluginId: "superboard-files" }),
		);
	}
});
