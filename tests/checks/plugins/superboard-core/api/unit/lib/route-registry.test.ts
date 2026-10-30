import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { Hono } from "hono";
import { expect, test } from "vitest";

import { signPluginTaskRequest } from "../../../../../../../packages/contracts/src/plugin-task.js";
import {
	registerRouter,
	registeredRoutes,
	assertRouteCoverage,
	routeManifest,
	dispatchRegisteredRoute,
} from "../../../../../../../packages/contracts/src/route-registry.js";
import api from "../../../../../../../packages/plugins/superboard-core/api/src/index.js";
import { sqliteD1 } from "../../helpers/sqlite-d1.js";

const group = {
	service: "test",
	module: "items",
	pluginId: "test-plugin",
	surface: "internal" as const,
	access: "internal" as const,
};
const runtime = {
	instanceId: "test-instance",
	environment: "test",
	buildId: "build-1",
	service: "test",
};

test("one declaration mounts a handler and exposes its canonical route and alias", async () => {
	const router = registerRouter(new Hono(), group);
	router
		.defineRoute({
			exposures: [{ surface: "sdk", path: "/v1/data/items/:id", aliases: ["/items/:id"] }],
		})
		.get("/internal/items/:id", (c) => c.json({ id: c.req.param("id"), query: c.req.query("q") }));
	const invoke = (request: Request) => router.fetch(request);
	const response = await dispatchRegisteredRoute(
		router,
		new Request("https://sdk.test/v1/data/items/42?q=hello"),
		"sdk",
		invoke,
	);
	expect(response.status).toBe(200);
	await expect(response.json()).resolves.toEqual({ id: "42", query: "hello" });
	const alias = await dispatchRegisteredRoute(
		router,
		new Request("https://sdk.test/items/43"),
		"sdk",
		invoke,
	);
	await expect(alias.json()).resolves.toMatchObject({ id: "43" });
	const manifest = await routeManifest(router, runtime);
	expect(manifest.routes).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				path: "/v1/data/items/:id",
				pluginId: "test-plugin",
				surface: "sdk",
				kind: "canonical",
			}),
			expect.objectContaining({ path: "/items/:id", kind: "alias", aliasOf: expect.any(String) }),
		]),
	);
	expect(JSON.stringify(manifest)).not.toContain("handler");
});

test("new declarations and their removal change the executable routes and manifest together", async () => {
	const create = (enabled: boolean) => {
		const router = registerRouter(new Hono(), group);
		if (enabled) router.get("/added", (c) => c.text("executed"));
		return router;
	};
	const before = create(false),
		after = create(true),
		removed = create(false);
	expect((await before.request("/added")).status).toBe(404);
	expect(await (await after.request("/added")).text()).toBe("executed");
	expect((await routeManifest(after, runtime)).routes).toContainEqual(
		expect.objectContaining({ path: "/added" }),
	);
	expect((await removed.request("/added")).status).toBe(404);
	expect((await routeManifest(removed, runtime)).routes).not.toContainEqual(
		expect.objectContaining({ path: "/added" }),
	);
});

test("coverage catches raw registrations and removed runtime entries independently of declarations", () => {
	const raw = new Hono();
	const router = registerRouter(raw, group);
	router.get("/registered", (c) => c.text("yes"));
	assertRouteCoverage(router);
	raw.get("/bypass", (c) => c.text("unregistered"));
	expect(() => assertRouteCoverage(router)).toThrow("ROUTE_UNREGISTERED");
	raw.routes.pop();
	raw.routes.pop();
	expect(() => assertRouteCoverage(router)).toThrow("ROUTE_NOT_MOUNTED");
});

test("nested routers keep their owners and middleware is not inventoried as an endpoint", async () => {
	const root = registerRouter(new Hono(), { ...group, module: "root", pluginId: "core" });
	const child = registerRouter(new Hono(), group);
	child.use("*", async (_, next) => {
		await next();
	});
	child.get("/:id", (c) => c.text(c.req.param("id")));
	root.route("/items", child);
	expect(await (await root.request("/items/9")).text()).toBe("9");
	const manifest = await routeManifest(root, runtime);
	expect(manifest.routes.filter((r) => r.method === "GET")).toEqual([
		expect.objectContaining({ path: "/items/:id", pluginId: "test-plugin" }),
	]);
	expect(manifest.routes.some((r) => r.path === "/items/*")).toBe(false);
});

test("unregistered children and ambiguous duplicate endpoints fail coverage", () => {
	const root = registerRouter(new Hono(), group);
	const child = new Hono();
	child.get("/hidden", (c) => c.text("hidden"));
	root.route("/child", child);
	expect(() => assertRouteCoverage(root)).toThrow("ROUTE_UNREGISTERED");
	const duplicate = registerRouter(new Hono(), group);
	duplicate.get("/same", (c) => c.text("first"));
	duplicate.get("/same", (c) => c.text("second"));
	expect(() => assertRouteCoverage(duplicate)).toThrow("ROUTE_DUPLICATE");
});

test("the real API manifest is private, complete, versioned and conditionally cacheable", async () => {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(
		readFileSync(
			new URL(
				"../../../../../../../packages/plugins/superboard-core/api/migrations/0066_gateway_operator.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	const env = {
		DB: sqliteD1(sqlite),
		MODULE_INTERNAL_TOKEN: "fixture-manifest-token",
		SUPERBOARD_INSTANCE_ID: "fixture",
		ENVIRONMENT: "test",
		SUPERBOARD_WORKER_VERSION: { id: "running-version" },
	};
	const request = new Request("https://api.internal/internal/route-manifest/v1");
	const denied = await api.fetch(request, env as never, {} as ExecutionContext);
	expect(denied.status).toBe(403);
	const headers = await signPluginTaskRequest(request, env.MODULE_INTERNAL_TOKEN);
	const response = await api.fetch(
		new Request(request, { headers }),
		env as never,
		{} as ExecutionContext,
	);
	const body = (await response.json()) as { error?: unknown; routes: unknown[]; buildId: string };
	expect({ status: response.status, error: body.error }).toEqual({ status: 200, error: undefined });
	expect(body.buildId).toBe("running-version");
	expect(body.routes.length).toBeGreaterThan(10);
	headers.set("if-none-match", response.headers.get("etag") ?? "");
	const unchanged = await api.fetch(
		new Request(request, { headers }),
		env as never,
		{} as ExecutionContext,
	);
	expect(unchanged.status).toBe(304);
	const external = await api.fetch(
		new Request("https://sdk.example.test/internal/route-manifest/v1", { headers }),
		env as never,
		{} as ExecutionContext,
	);
	expect(external.status).toBe(404);
	sqlite.close();
});

test("an explicit extension mounts only new endpoints while preserving the existing handler", async () => {
	const root = registerRouter(new Hono(), group);
	root.get("/v2/shared", (c) => c.text("original"));
	const extension = registerRouter(new Hono(), { ...group, module: "extension" });
	extension.get("/shared", (c) => c.text("shadowed"));
	extension.get("/added", (c) => c.text("added"));
	root.defineRoute({ mount: "extend" }).route("/v2", extension);
	assertRouteCoverage(root);
	expect(await (await root.request("/v2/shared")).text()).toBe("original");
	expect(await (await root.request("/v2/added")).text()).toBe("added");
	expect(
		(await routeManifest(root, runtime)).routes.filter(
			(route) => route.path === "/v2/shared" && route.method === "GET",
		),
	).toHaveLength(1);
});

test("framework configuration chains keep subsequent endpoints registered", async () => {
	const router = registerRouter(new Hono(), group);
	router
		.onError((_error, c) => c.text("caught", 500))
		.get("/after-error-handler", (c) => c.text("registered"));
	expect(await (await router.request("/after-error-handler")).text()).toBe("registered");
	expect((await routeManifest(router, runtime)).routes).toContainEqual(
		expect.objectContaining({ path: "/after-error-handler" }),
	);
});

test("manifests reject dangling aliases and duplicate route identities", async () => {
	const { parseRouteManifest } =
		await import("../../../../../../../packages/contracts/src/route-manifest.js");
	const router = registerRouter(new Hono(), group);
	router.get("/valid", (c) => c.text("valid"));
	const manifest = await routeManifest(router, runtime);
	const route = manifest.routes[0]!;
	expect(() => parseRouteManifest({ ...manifest, routes: [route, route] })).toThrow(
		"ROUTE_MANIFEST_INVALID",
	);
	expect(() =>
		parseRouteManifest({ ...manifest, routes: [{ ...route, kind: "alias", aliasOf: "missing" }] }),
	).toThrow("ROUTE_MANIFEST_INVALID");
	expect(() =>
		parseRouteManifest({ ...manifest, routes: [{ ...route, service: "other" }] }),
	).toThrow("ROUTE_MANIFEST_INVALID");
});

test("Gateway refuses ambiguous published paths before executing their handlers", async () => {
	const { compileGatewayRoutes } =
		await import("../../../../../../../packages/plugins/superboard-core/api/src/routes/gateway-admin.js");
	const route = {
		enabled: true,
		method: "GET" as const,
		target_path: "/health",
		rate_limit: 60,
		expected_revision: null,
	};
	expect(() =>
		compileGatewayRoutes([
			{ ...route, route_id: "first", path_pattern: "/items/:id" },
			{ ...route, route_id: "second", path_pattern: "/items/:other" },
		]),
	).toThrow("ROUTE_DUPLICATE");
});

test("public dispatch preserves optional parameters and nested regex captures", async () => {
	const router = registerRouter(new Hono(), group);
	router
		.defineRoute({ exposures: [{ surface: "sdk", path: "/v1/items/:id?" }] })
		.get("/items/:id?", (c) => c.json({ id: c.req.param("id") ?? null }));
	router
		.defineRoute({ exposures: [{ surface: "sdk", path: "/v1/pairs/:first{(foo|bar)}/:second" }] })
		.get("/pairs/:first{(foo|bar)}/:second", (c) =>
			c.json({ first: c.req.param("first"), second: c.req.param("second") }),
		);
	for (const [path, expected] of [
		["/v1/items", { id: null }],
		["/v1/items/42", { id: "42" }],
		["/v1/pairs/foo/last", { first: "foo", second: "last" }],
	] as const) {
		const response = await dispatchRegisteredRoute(
			router,
			new Request(`https://sdk.test${path}`),
			"sdk",
			(request) => router.fetch(request),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(expected);
	}
});

test("native routes support regex quantifiers without leaking pattern syntax into dispatch", async () => {
	const { createFetchRouter, resolveRegisteredRoute } =
		await import("../../../../../../../packages/contracts/src/route-registry.js");
	const router = createFetchRouter(group);
	router.get("/codes/:code{[0-9]{2}}/:tail", ({ params }) => Response.json(params));
	const response = await router.fetch(new Request("https://test.internal/codes/42/end"), {});
	expect(response.status).toBe(200);
	await expect(response.json()).resolves.toEqual({ code: "42", tail: "end" });
	expect(resolveRegisteredRoute(router, "GET", "internal", "/codes/42/end")?.executionPath).toBe(
		"/codes/42/end",
	);
	expect((await router.fetch(new Request("https://test.internal/codes/4/end"), {})).status).toBe(
		404,
	);
});

test("Gateway administrative endpoints are mounted and inventoried individually", async () => {
	const { app: apiRouter } =
		await import("../../../../../../../packages/plugins/superboard-core/api/src/index.js");
	const manifest = await routeManifest(apiRouter, { ...runtime, service: "api" });
	for (const [method, path] of [
		["GET", "/api/v1/gateway/routes"],
		["PUT", "/api/v1/gateway/routes/:id"],
		["POST", "/api/v1/gateway/manifests"],
		["GET", "/api/v1/gateway/active-manifest"],
		["POST", "/api/v1/gateway/access-policy"],
		["GET", "/api/v1/gateway/rate-limits"],
	]) {
		expect(manifest.routes).toContainEqual(
			expect.objectContaining({
				method,
				path,
				pluginId: "superboard-gateway",
				access: "operator",
			}),
		);
		const denied = await apiRouter.request(path.replace(":id", "fixture"), { method }, {});
		expect(denied.status).toBe(401);
	}
});

test("MCP operator endpoints expose their own mounted methods and declared owner", async () => {
	const { app: apiRouter } =
		await import("../../../../../../../packages/plugins/superboard-core/api/src/index.js");
	const manifest = await routeManifest(apiRouter, { ...runtime, service: "api" });
	for (const [method, path] of [
		["GET", "/api/v1/mcp/operator/sessions"],
		["GET", "/api/v1/mcp/operator/receipts"],
		["GET", "/api/v1/mcp/operator/tools"],
		["POST", "/api/v1/mcp/operator/invocations"],
	]) {
		expect(manifest.routes).toContainEqual(
			expect.objectContaining({ method, path, pluginId: "superboard-mcp", access: "operator" }),
		);
		expect((await apiRouter.request(path, { method }, {})).status).toBe(401);
	}
});

test("Observability administrative routes expose separate registered handlers", async () => {
	const { app: apiRouter } =
		await import("../../../../../../../packages/plugins/superboard-core/api/src/index.js");
	const manifest = await routeManifest(apiRouter, { ...runtime, service: "api" });
	for (const [method, path] of [
		["GET", "/api/v1/observability/runtime-metrics"],
		["GET", "/api/v1/observability/service-health"],
		["GET", "/api/v1/observability/incidents"],
		["POST", "/api/v1/observability/incidents/:id{[a-f0-9]{64}}/acknowledge"],
		["POST", "/api/v1/observability/incidents/:id{[a-f0-9]{64}}/resolve"],
	] as const) {
		expect(manifest.routes).toContainEqual(
			expect.objectContaining({
				method,
				path,
				pluginId: "superboard-observability",
				access: "operator",
			}),
		);
		const response = await apiRouter.request(
			path.replace(":id{[a-f0-9]{64}}", "a".repeat(64)),
			{ method },
			{},
		);
		expect(response.status).toBe(401);
	}
});

test("a native router bridge executes and inventories the same declarations", async () => {
	const { createFetchRouter, mountRegisteredRouter } =
		await import("../../../../../../../packages/contracts/src/route-registry.js");
	const source = createFetchRouter<{ marker: string }>(group);
	source.get("/bridged/:id", ({ params, env }) =>
		Response.json({ id: params.id, marker: env.marker }),
	);
	const parent = registerRouter(new Hono(), { ...group, module: "parent" });
	mountRegisteredRouter(parent, source, (c: import("hono").Context) =>
		source.fetch(c.req.raw, { marker: "executed" }),
	);
	await expect((await parent.request("/bridged/42")).json()).resolves.toEqual({
		id: "42",
		marker: "executed",
	});
	expect((await routeManifest(parent, runtime)).routes).toContainEqual(
		expect.objectContaining({
			path: "/bridged/:id",
			module: group.module,
			pluginId: group.pluginId,
		}),
	);
	source.get("/not-mounted", () => new Response("hidden"));
	expect(() => assertRouteCoverage(parent)).toThrow("ROUTE_BRIDGE_NOT_MOUNTED");
});

test("coverage rejects mutations of an existing routing entry", () => {
	const raw = new Hono();
	const tracked = registerRouter(raw, group);
	tracked.get("/original", (c) => c.text("original"));
	const entry = raw.routes[0];
	if (!entry) throw new Error("fixture route missing");
	entry.path = "/unregistered-replacement";
	expect(() => assertRouteCoverage(tracked)).toThrow("ROUTE_ENTRY_MUTATED");
});

test("the Files bridge remains owned by Files when executed by the API service", async () => {
	const { app: apiRouter } =
		await import("../../../../../../../packages/plugins/superboard-core/api/src/index.js");
	const manifest = await routeManifest(apiRouter, { ...runtime, service: "api" });
	expect(manifest.routes).toContainEqual(
		expect.objectContaining({
			routeId: "api:files:operator-proxy",
			service: "api",
			pluginId: "superboard-files",
			access: "operator",
		}),
	);
});

test("nested router changes after mounting fail coverage instead of silently disappearing", () => {
	const child = registerRouter(new Hono(), {
		service: "api",
		module: "child",
		pluginId: "owner",
		surface: "internal",
		access: "public",
	});
	const parent = registerRouter(new Hono(), {
		service: "api",
		module: "parent",
		pluginId: "owner",
		surface: "internal",
		access: "public",
	});
	child.get("/first", (c) => c.text("first"));
	parent.route("/child", child);
	child.get("/second", (c) => c.text("second"));
	expect(() => assertRouteCoverage(parent)).toThrow("ROUTE_CHILD_MOUNT_STALE");
});

test("implicit HEAD inventory corresponds to an actual bodyless HTTP response", async () => {
	const router = registerRouter(new Hono(), {
		service: "api",
		module: "head",
		pluginId: "owner",
		surface: "internal",
		access: "public",
	});
	router.get("/item", (c) => c.text("body", 200, { "X-Route": "item" }));
	const response = await router.request("/item", { method: "HEAD" });
	expect(response.status).toBe(200);
	expect(await response.text()).toBe("");
	expect(response.headers.get("X-Route")).toBe("item");
	expect(
		registeredRoutes(router).some((route) => route.method === "HEAD" && route.path === "/item"),
	).toBe(true);
});
