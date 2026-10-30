import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import { parseRouteManifest } from "@superboard/contracts/route-manifest";
import {
	INTERNAL_ROUTE_REFERENCES_PATH,
	RouteReferenceError,
	routeReferenceBatches,
	selectRouteReferences,
} from "@superboard/contracts/route-reference";

import { executingAstroRoutes } from "./astro-route-integration.js";
import { proxyOperatorApiRequest, type OperatorApiProxyEnv } from "./operator-api-proxy.js";
import { siteMiddlewareRoutes } from "./site-route-registry.js";

export async function resolveApiRouteReferences(
	env: OperatorApiProxyEnv,
	operator: { id: string; role: number; disabled?: boolean },
	ids: readonly string[],
) {
	const localIds = ids.filter((id) => id.startsWith("site:"));
	if (localIds.length) await import("./plugin-api-adapter.js");
	const local = selectRouteReferences(
		[
			...siteMiddlewareRoutes(),
			...(localIds.some((id) => id.startsWith("site:astro:")) ? await executingAstroRoutes() : []),
		],
		localIds,
	);
	const results = await Promise.all(
		routeReferenceBatches(ids.filter((id) => !id.startsWith("site:"))).map(async (batch) => {
			const url = new URL(INTERNAL_ROUTE_REFERENCES_PATH, "https://api.internal");
			for (const id of batch) url.searchParams.append("route_id", id);
			const response = await proxyOperatorApiRequest({
				request: new Request(url),
				env,
				operator,
				plugin_context: { plugin_id: "supbrd-core", project_ref: "instance-wide" },
			});
			if (!response.ok) {
				await response.body?.cancel();
				throw new RouteReferenceError("ROUTE_REFERENCE_UNAVAILABLE");
			}
			const manifest = parseRouteManifest(await readJsonObjectLimited(response, 2 * 1024 * 1024));
			if (
				manifest.instanceId !== env.SUPERBOARD_INSTANCE_ID ||
				manifest.environment !== env.SUPERBOARD_ENVIRONMENT ||
				manifest.service !== "api"
			)
				throw new RouteReferenceError("ROUTE_REFERENCE_CONTEXT_MISMATCH");
			return manifest.routes;
		}),
	);
	return [...new Map([...local, ...results.flat()].map((route) => [route.id, route])).values()];
}
