import { Hono } from "hono";
import { expect, test } from "vitest";

import {
	projectDestinationRoute,
	registerRouter,
	registeredRoutes,
	resolveRouteDestination,
} from "../../../../../../../packages/contracts/src/route-registry.js";

const proxyDefinition = {
	id: "api:files-proxy",
	path: "/analytics/projects/:projectRef/:rest{.+}",
	destination: { service: "files", path: "/internal/operator/:rest{.+}" },
	transport: "fallback" as const,
};

test("a proxy uses its declared destination for dispatch and derives owned endpoints from the target router", async () => {
	const target = registerRouter(new Hono(), {
		service: "files",
		module: "objects",
		pluginId: "file-owner",
		surface: "internal",
		access: "internal",
	});
	target
		.defineRoute({ id: "files:object" })
		.get("/internal/operator/objects/:id", (c) =>
			c.json({ id: c.req.param("id"), q: c.req.query("q") }),
		);
	target.get("/unrelated", (c) => c.text("not delegated"));
	const proxy = registerRouter(new Hono(), {
		service: "api",
		module: "proxy",
		pluginId: "core-owner",
		surface: "internal",
		access: "operator",
	});
	proxy.defineRoute(proxyDefinition).all(proxyDefinition.path, (c) => {
		const destination = resolveRouteDestination(proxyDefinition, new URL(c.req.url).pathname);
		if (!destination) return c.notFound();
		return target.request(destination.path + new URL(c.req.url).search);
	});
	const response = await proxy.request("/analytics/projects/1-prod/objects/42?q=value");
	expect(response.status).toBe(200);
	await expect(response.json()).resolves.toEqual({ id: "42", q: "value" });
	const declaredProxy = registeredRoutes(proxy)[0];
	const declaredTarget = registeredRoutes(target).find((route) => route.routeId === "files:object");
	if (!declaredProxy || !declaredTarget) throw new Error("fixture routes missing");
	const projected = projectDestinationRoute(declaredProxy, declaredTarget);
	expect(projected).toMatchObject({
		routeId: "api:files-proxy->files:object",
		method: "GET",
		path: "/analytics/projects/:projectRef/objects/:id",
		pluginId: "file-owner",
		service: "api",
		destination: {
			service: "files",
			routeId: "files:object",
			path: "/internal/operator/objects/:id",
		},
	});
	const unrelated = registeredRoutes(target).find((route) => route.path === "/unrelated");
	if (!unrelated) throw new Error("fixture route missing");
	expect(projectDestinationRoute(declaredProxy, unrelated)).toBeNull();
});

test("proxy inventory retains stale observations and removes withdrawn target endpoints", async () => {
	const { createRouteInventoryCollector } =
		await import("../../../../../../../packages/contracts/src/route-inventory.js");
	const { routeManifest } =
		await import("../../../../../../../packages/contracts/src/route-registry.js");
	const { selectRouteReference } =
		await import("../../../../../../../packages/contracts/src/route-reference.js");
	const createTarget = (enabled: boolean) => {
		const router = registerRouter(new Hono(), {
			service: "files",
			module: "objects",
			pluginId: "file-owner",
			surface: "internal",
			access: "internal",
		});
		if (enabled)
			router
				.defineRoute({ id: "files:object" })
				.get("/internal/operator/objects/:id", (c) => c.text(c.req.param("id")));
		return router;
	};
	let target = createTarget(true);
	let available = true;
	const proxy = registerRouter(new Hono(), {
		service: "api",
		module: "proxy",
		pluginId: "core-owner",
		surface: "internal",
		access: "operator",
	});
	proxy.defineRoute(proxyDefinition).all(proxyDefinition.path, (c) => {
		const destination = resolveRouteDestination(proxyDefinition, new URL(c.req.url).pathname);
		return destination ? target.request(destination.path) : c.notFound();
	});
	const runtime = {
		instanceId: "proxy-test",
		environment: "test",
		service: "api",
		buildId: "api-version",
		releaseId: "release",
	};
	const input = {
		...runtime,
		own: await routeManifest(proxy, runtime),
		sources: [
			{
				service: "files",
				workerName: "files-worker",
				enabled: true,
				secret: "fixture",
				binding: {
					async fetch() {
						if (!available) throw new Error("offline");
						return Response.json(
							await routeManifest(target, {
								...runtime,
								service: "files",
								buildId: "files-version",
							}),
						);
					},
				},
			},
		],
	};
	const collect = createRouteInventoryCollector();
	const id = "api:files-proxy->files:object";
	const missing = await collect({ ...input, sources: [] });
	expect(missing.status).toBe("partial");
	expect(missing.sources).toContainEqual(
		expect.objectContaining({ service: "files", reason: "ROUTE_DESTINATION_UNVERIFIED" }),
	);
	const current = await collect(input);
	expect(selectRouteReference(current.routes, id, "file-owner")).toMatchObject({
		path: "/analytics/projects/:projectRef/objects/:id",
		destinationBuildId: "files-version",
	});
	expect((await proxy.request("/analytics/projects/1-prod/objects/42")).status).toBe(200);
	available = false;
	const stale = await collect(input);
	expect(stale.status).toBe("partial");
	expect(stale.routes.find((route) => route.routeId === id)?.availability).toBe("stale");
	expect(() => selectRouteReference(stale.routes, id)).toThrow("ROUTE_REFERENCE_UNAVAILABLE");
	available = true;
	target = createTarget(false);
	const removed = await collect(input);
	expect(removed.status).toBe("complete");
	expect(removed.routes.some((route) => route.routeId === id)).toBe(false);
	expect((await proxy.request("/analytics/projects/1-prod/objects/42")).status).toBe(404);
});

test("invalid destinations cannot enter a service manifest", async () => {
	const { parseRouteDescriptors } =
		await import("../../../../../../../packages/contracts/src/route-manifest.js");
	const router = registerRouter(new Hono(), {
		service: "api",
		module: "proxy",
		pluginId: "core-owner",
		surface: "internal",
		access: "operator",
	});
	router.defineRoute(proxyDefinition).all(proxyDefinition.path, (c) => c.notFound());
	const descriptor = registeredRoutes(router)[0];
	if (!descriptor) throw new Error("fixture route missing");
	for (const destination of [
		{ service: 42, path: "/internal" },
		{ service: "files", path: "//external.example" },
	])
		expect(() => parseRouteDescriptors([{ ...descriptor, destination }])).toThrow(
			"ROUTE_MANIFEST_INVALID",
		);
});

test("domain proxy projections use canonical project paths and omit an absent optional suffix", async () => {
	const { domainRouteDestination, extractDomainRoute } =
		await import("../../../../../../../packages/plugins/superboard-core/api/src/lib/domain-modules.js");
	for (const moduleName of [
		"app",
		"products",
		"analytics",
		"marketing",
		"email",
		"dynamic-links",
	] as const) {
		const destination = domainRouteDestination(moduleName);
		if (!destination) throw new Error("destination missing");
		const proxy = registerRouter(new Hono(), {
			service: "api",
			module: moduleName,
			pluginId: "proxy-owner",
			surface: "internal",
			access: "operator",
		});
		proxy
			.defineRoute({ destination, transport: "fallback" })
			.all(`/api/v1/${moduleName}/*`, (c) => c.text("proxy"));
		const target = registerRouter(new Hono(), {
			service: moduleName,
			module: "test",
			pluginId: "business-owner",
			surface: "internal",
			access: "internal",
		});
		const prefix = moduleName === "email" ? "/internal/v1/admin" : "/internal/v1";
		target.get(prefix, (c) => c.text("root"));
		target.get(`${prefix}/items/:id`, (c) => c.text(c.req.param("id")));
		const descriptor = registeredRoutes(proxy)[0];
		if (!descriptor) throw new Error("proxy missing");
		const projected = registeredRoutes(target)
			.filter((route) => route.method === "GET")
			.map((route) => projectDestinationRoute(descriptor, route));
		expect(projected.map((route) => route?.path)).toEqual([
			`/api/v1/${moduleName}/projects/:projectRef`,
			`/api/v1/${moduleName}/projects/:projectRef/items/:id`,
		]);
		for (const suffix of ["", "/items/42"]) {
			const pathname = `/api/v1/${moduleName}/projects/1-prod${suffix}`;
			const resolved = resolveRouteDestination({ path: descriptor.path, destination }, pathname);
			const extracted = extractDomainRoute(
				new Request(`https://api.internal${pathname}`),
				moduleName,
				prefix,
			);
			expect(extracted).toMatchObject({ ok: true, internalPath: resolved?.path });
			const response = await target.request(resolved?.path ?? "/missing");
			expect(response.status).toBe(200);
			expect(await response.text()).toBe(suffix ? "42" : "root");
		}
	}
});

test("project-scoped destinations retain public reference parameters while dispatching the service context", async () => {
	const { domainRouteDestination } =
		await import("../../../../../../../packages/plugins/superboard-core/api/src/lib/domain-modules.js");
	for (const service of ["flows", "support"] as const) {
		const destination = domainRouteDestination(service);
		if (!destination) throw new Error("destination missing");
		const target = registerRouter(new Hono(), {
			service,
			module: "test",
			pluginId: "business-owner",
			surface: "internal",
			access: "internal",
		});
		const parameter = service === "support" ? "projectId" : "projectRef";
		target.get(`/internal/v1/projects/:${parameter}/items/:id`, (c) => c.json(c.req.param()));
		const proxy = registerRouter(new Hono(), {
			service: "api",
			module: service,
			pluginId: "business-owner",
			surface: "internal",
			access: "operator",
		});
		const path = `/api/v1/${service}/*`;
		proxy.defineRoute({ destination, transport: "fallback" }).all(path, (c) => {
			const resolved = resolveRouteDestination({ path, destination }, new URL(c.req.url).pathname, {
				projectId: "12",
			});
			return resolved ? target.request(resolved.path) : c.notFound();
		});
		const response = await proxy.request(`/api/v1/${service}/projects/10-test/items/item-1`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			[parameter]: service === "support" ? "12" : "10-test",
			id: "item-1",
		});
		const declaredProxy = registeredRoutes(proxy)[0];
		const declaredTarget = registeredRoutes(target)[0];
		if (!declaredProxy || !declaredTarget) throw new Error("fixture routes missing");
		expect(projectDestinationRoute(declaredProxy, declaredTarget)?.path).toBe(
			`/api/v1/${service}/projects/:projectRef/items/:id`,
		);
	}
});

test("conditional proxy references survive backend cutover and become stale when an enabled destination is missing", async () => {
	const { createRouteInventoryCollector } =
		await import("../../../../../../../packages/contracts/src/route-inventory.js");
	const { routeManifest } =
		await import("../../../../../../../packages/contracts/src/route-registry.js");
	const { resolveRouteReference } =
		await import("../../../../../../../packages/contracts/src/route-reference.js");
	const legacy = registerRouter(new Hono(), {
		service: "paywalls",
		module: "test",
		pluginId: "owner",
		surface: "internal",
		access: "internal",
	});
	legacy.get("/legacy/:id{[0-9]{2}}", (c) => c.json({ backend: "legacy", id: c.req.param("id") }));
	const flows = registerRouter(new Hono(), {
		service: "flows",
		module: "test",
		pluginId: "owner",
		surface: "internal",
		access: "internal",
	});
	flows.get("/cutover/:id", (c) => c.json({ backend: "flows", id: c.req.param("id") }));
	const choices = [
		{
			service: "paywalls",
			path: "/legacy/:id",
			sourcePath: "/projects/:projectRef/:id",
			condition: "legacy-project" as const,
		},
		{
			service: "flows",
			path: "/cutover/:id",
			sourcePath: "/projects/:projectRef/:id",
			condition: "flows-project" as const,
		},
	];
	const proxy = registerRouter(new Hono(), {
		service: "api",
		module: "test",
		pluginId: "owner",
		surface: "internal",
		access: "operator",
	});
	let cutover = false;
	proxy
		.defineRoute({ id: "api:conditional", destinations: choices, transport: "fallback" })
		.all("/projects/:projectRef/:id", (c) => {
			const destination = choices[cutover ? 1 : 0];
			if (!destination) throw new Error("fixture destination missing");
			const resolved = resolveRouteDestination({ path: c.req.path, destination }, c.req.path);
			if (!resolved) return c.notFound();
			return (cutover ? flows : legacy).request(resolved.path);
		});
	const runtime = {
		instanceId: "conditional",
		environment: "test",
		buildId: "build",
		releaseId: "release",
	};
	const own = await routeManifest(proxy, { ...runtime, service: "api" });
	const collect = createRouteInventoryCollector();
	let failLegacy = false;
	const snapshot = async (legacyEnabled: boolean, flowsEnabled: boolean, reverse = false) => {
		const sources = [
			{
				service: "paywalls",
				workerName: "legacy",
				enabled: legacyEnabled,
				secret: "test",
				binding: {
					async fetch() {
						if (failLegacy) throw new Error("offline");
						return Response.json(await routeManifest(legacy, { ...runtime, service: "paywalls" }));
					},
				},
			},
			{
				service: "flows",
				workerName: "flows",
				enabled: flowsEnabled,
				secret: "test",
				binding: {
					async fetch() {
						return Response.json(await routeManifest(flows, { ...runtime, service: "flows" }));
					},
				},
			},
		];
		return collect({ ...runtime, own, sources: reverse ? sources.toReversed() : sources });
	};
	const before = await snapshot(true, false);
	const reference = before.routes.find((route) => route.routeId.startsWith("api:conditional->"));
	if (!reference) throw new Error("conditional facade missing");
	const operation = { route_id: reference.routeId, parameters: ["projectRef", "id"] };
	expect(resolveRouteReference(operation, before.routes, "owner").path).toBe(
		"/projects/:projectRef/:id",
	);
	expect(await (await proxy.request("/projects/1-prod/12")).json()).toEqual({
		backend: "legacy",
		id: "12",
	});
	cutover = true;
	const after = await snapshot(false, true);
	expect(resolveRouteReference(operation, after.routes, "owner").path).toBe(
		"/projects/:projectRef/:id",
	);
	expect(await (await proxy.request("/projects/1-prod/12")).json()).toEqual({
		backend: "flows",
		id: "12",
	});
	const both = await snapshot(true, true);
	expect(
		both.routes.find((route) => route.routeId === operation.route_id)?.destinations,
	).toHaveLength(2);
	expect((await snapshot(true, true, true)).revision).toBe(both.revision);
	failLegacy = true;
	const partial = await snapshot(true, true);
	expect(partial.status).toBe("partial");
	expect(() => resolveRouteReference(operation, partial.routes, "owner")).toThrow(
		"ROUTE_REFERENCE_UNAVAILABLE",
	);
});

test("an unverified conditional destination cannot silently acquire another plugin owner", async () => {
	const { createRouteInventoryCollector } =
		await import("../../../../../../../packages/contracts/src/route-inventory.js");
	const { routeManifest } =
		await import("../../../../../../../packages/contracts/src/route-registry.js");
	const proxy = registerRouter(new Hono(), {
		service: "api",
		module: "conditional",
		pluginId: "owner",
		surface: "internal",
		access: "operator",
	});
	proxy
		.defineRoute({
			destinations: [
				{ service: "paywalls", path: "/items", sourcePath: "/items", condition: "legacy-project" },
				{ service: "flows", path: "/items", sourcePath: "/items", condition: "flows-project" },
			],
			transport: "fallback",
		})
		.all("/items", (c) => c.text("proxy"));
	const runtime = {
		instanceId: "conflict",
		environment: "test",
		buildId: "build",
		releaseId: "release",
	};
	const sources = ["paywalls", "flows"].map((service) => {
		const target = registerRouter(new Hono(), {
			service,
			module: "items",
			pluginId: service === "flows" ? "foreign-owner" : "owner",
			surface: "internal",
			access: "internal",
		});
		target.get("/items", (c) => c.text("item"));
		return {
			service,
			workerName: service,
			enabled: true,
			secret: "test",
			binding: {
				async fetch() {
					return Response.json(await routeManifest(target, { ...runtime, service }));
				},
			},
		};
	});
	const inventory = await createRouteInventoryCollector()({
		...runtime,
		own: await routeManifest(proxy, { ...runtime, service: "api" }),
		sources,
	});
	expect(inventory.status).toBe("partial");
	expect(
		inventory.issues?.some((issue) => issue.startsWith("ROUTE_DESTINATION_OWNER_MISMATCH:")),
	).toBe(true);
	expect(
		inventory.routes
			.filter((route) => route.routeId.includes("->"))
			.every((route) => route.availability === "stale"),
	).toBe(true);
});
