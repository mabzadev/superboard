import { pluginPackageOwner } from "@superboard/contracts/plugin-packages";
import { selectRouteReference } from "@superboard/contracts/route-reference";
import { matchRouteParameters, resolveManifestRoute } from "@superboard/contracts/route-registry";
import type { APIContext } from "astro";

import { executeAstroRoute, executingAstroRoutes } from "./astro-route-integration.js";

const collectionName = /^[a-z][a-z0-9_]*$/u;

export async function dispatchContentPluginApi(
	context: APIContext,
	request: Request,
	routeId?: string,
): Promise<Response> {
	const url = new URL(request.url);
	const routes = (await executingAstroRoutes()).filter(
		(route) => pluginPackageOwner(route.pluginId) === pluginPackageOwner("superboard-content"),
	);
	const route = routeId
		? selectRouteReference(routes, routeId, "superboard-content")
		: resolveManifestRoute(routes, request.method, "board", url.pathname)?.route;
	if (!route) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	if (route.method !== request.method)
		return Response.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
	const matched = matchRouteParameters(route.path, url.pathname);
	if (
		!matched ||
		matched.collection === "views" ||
		(matched.collection && !collectionName.test(matched.collection))
	)
		return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	const params = Object.fromEntries(
		Object.entries(matched).map(([name, value]) => [name, decodeURIComponent(value)]),
	);
	return executeAstroRoute(route.id, route.method, { ...context, params, request, url });
}
