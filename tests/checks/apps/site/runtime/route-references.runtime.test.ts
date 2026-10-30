import { resolveRouteReference } from "@superboard/contracts/route-reference";
import { env } from "cloudflare:test";
import { expect, test } from "vitest";
import { resolveApiRouteReferences } from "../../../../../apps/site/src/lib/route-references.js";

import registry from "../../../../../scripts/config/superboard-plugin-api-adapters.json";

test("all configured references resolve through executing service bindings with their policy owner", async () => {
	const ids = [
		...new Set(
			registry.adapters.flatMap((adapter) =>
				adapter.operations.flatMap((operation) =>
					"route_id" in operation && typeof operation.route_id === "string"
						? [operation.route_id]
						: [],
				),
			),
		),
	];
	const routes = await resolveApiRouteReferences(env, { id: "operator-1", role: 50 }, ids);
	let checked = 0;
	for (const adapter of registry.adapters)
		for (const operation of adapter.operations) {
			if (!("route_id" in operation) || typeof operation.route_id !== "string") continue;
			const resolved = resolveRouteReference(operation, routes, adapter.plugin_id);
			expect(
				adapter.kind !== "data_source" ||
					resolved.method === "GET" ||
					("read_only" in operation && operation.read_only === true),
			).toBe(true);
			expect(
				resolved.path.startsWith(
					operation.route_id.startsWith("site:") ? "/_emdash/api/" : "/api/",
				),
			).toBe(true);
			checked++;
		}
	expect(checked).toBeGreaterThan(0);
});
