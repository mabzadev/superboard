import { Hono } from "hono";
import { expect, test } from "vitest";

import { resolveRouteReference } from "../../../../../../../packages/contracts/src/route-reference.js";
import {
	registerRouter,
	registeredRoutes,
} from "../../../../../../../packages/contracts/src/route-registry.js";

const owner = "superboard-gateway";
const operation = {
	route_id: "api:reference:fixture",
	parameters: [],
	query: "none",
	body: "none",
};
function endpoint(path: string) {
	const router = registerRouter(new Hono(), {
		service: "api",
		module: "reference-fixture",
		pluginId: owner,
		surface: "internal",
		access: "operator",
	});
	router.defineRoute({ id: operation.route_id }).get(path, (c) => c.text("executed"));
	return router;
}
test("an adapter reference follows the executing declaration after its path changes", async () => {
	for (const path of ["/before", "/after"]) {
		const router = endpoint(path);
		const resolved = resolveRouteReference(operation, registeredRoutes(router), owner);
		expect(resolved.method).toBe("GET");
		expect(resolved.path).toBe(path);
		expect(await (await router.request(resolved.path, { method: resolved.method })).text()).toBe(
			"executed",
		);
	}
});
test("missing, ambiguous and foreign-owner references cannot dispatch", () => {
	const rows = registeredRoutes(endpoint("/current"));
	expect(() => resolveRouteReference(operation, [], owner)).toThrow("ROUTE_REFERENCE_UNAVAILABLE");
	expect(() => resolveRouteReference(operation, [...rows, ...rows], owner)).toThrow(
		"ROUTE_REFERENCE_AMBIGUOUS",
	);
	expect(() => resolveRouteReference(operation, rows, "superboard-files")).toThrow(
		"ROUTE_REFERENCE_OWNER_MISMATCH",
	);
	expect(() =>
		resolveRouteReference({ ...operation, method: "POST", path: "/invented" }, rows, owner),
	).toThrow("ROUTE_REFERENCE_DUPLICATED");
});

test("adapter parameter policies must cover the executing route parameters", () => {
	const rows = registeredRoutes(endpoint("/items/:id"));
	expect(() => resolveRouteReference(operation, rows, owner)).toThrow(
		"ROUTE_REFERENCE_PARAMETERS_MISMATCH",
	);
	expect(resolveRouteReference({ ...operation, parameters: ["id"] }, rows, owner).path).toBe(
		"/items/:id",
	);
});

test("direct adapter references resolve against the real API routing table", async () => {
	const { app } =
		await import("../../../../../../../packages/plugins/superboard-core/api/src/index.js");
	const { default: registry } =
		await import("../../../../../../../scripts/config/superboard-plugin-api-adapters.json");
	const rows = registeredRoutes(app);
	let checked = 0;
	for (const adapter of registry.adapters)
		for (const configured of adapter.operations) {
			if (
				!("route_id" in configured) ||
				typeof configured.route_id !== "string" ||
				configured.route_id.includes("->") ||
				configured.route_id.startsWith("site:")
			)
				continue;
			const resolved = resolveRouteReference(configured, rows, adapter.plugin_id);
			expect(resolved.path.startsWith("/api/")).toBe(true);
			const validRead =
				adapter.kind !== "data_source" ||
				("read_only" in configured && configured.read_only) ||
				resolved.method === "GET";
			expect(validRead).toBe(true);
			checked++;
		}
	expect(checked).toBeGreaterThan(0);
});

test("large reference collections remain verifiable by the operator signature guard", async () => {
	const { routeReferenceBatches } =
		await import("../../../../../../../packages/contracts/src/route-reference.js");
	const { signSiteOperatorRequest, verifySiteOperatorRequest } =
		await import("../../../../../../../packages/contracts/src/site-operator.js");
	const ids = Array.from(
		{ length: 96 },
		(_, index) =>
			`api:products:operator-proxy->products:items:GET:/internal/v1/items/:itemId/action-${index}`,
	);
	const batches = routeReferenceBatches([...ids, ...ids]);
	expect(batches.flat()).toEqual(ids);
	expect(batches.length).toBeGreaterThan(1);
	for (const batch of batches) {
		const url = new URL("https://api.internal/internal/site/route-definitions");
		for (const id of batch) url.searchParams.append("route_id", id);
		const request = new Request(url);
		const identity = { operator_id: "test-operator", instance_id: "test-instance", role: 50 };
		const headers = await signSiteOperatorRequest(request, identity, "test-secret");
		expect(
			await verifySiteOperatorRequest(
				new Request(request, { headers }),
				"test-instance",
				"test-secret",
			),
		).toMatchObject(identity);
	}
});

test("an explicitly referenced alias executes its handler and retains its canonical dependency", async () => {
	const { createFetchRouter } =
		await import("../../../../../../../packages/contracts/src/route-registry.js");
	const { selectRouteReferences } =
		await import("../../../../../../../packages/contracts/src/route-reference.js");
	const { parseRouteDescriptors } =
		await import("../../../../../../../packages/contracts/src/route-manifest.js");
	const router = createFetchRouter<void>({
		service: "site",
		module: "fixture",
		pluginId: "owner",
		surface: "internal",
		access: "operator",
	});
	router
		.defineRoute({
			id: "site:fixture:read",
			exposures: [{ surface: "internal", path: "/current", aliases: ["/legacy"] }],
		})
		.get("/current", () => new Response("executed"));
	const routes = registeredRoutes(router);
	const alias = routes.find((route) => route.kind === "alias");
	if (!alias) throw new Error("fixture alias missing");
	const selected = selectRouteReferences(routes, ["site:fixture:read", alias.id, alias.id]);
	expect(parseRouteDescriptors(selected)).toHaveLength(2);
	expect(resolveRouteReference({ route_id: alias.id }, selected, "owner").path).toBe("/legacy");
	const response = await router.fetch(new Request("https://site.internal/legacy"), undefined);
	expect(await response.text()).toBe("executed");
});
