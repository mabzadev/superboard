import { parseRouteDescriptors } from "@superboard/contracts/route-manifest";
import type { APIContext } from "astro";

async function routeGraph() {
	// @ts-ignore - virtual module
	const module: unknown = await import("virtual:superboard/route-manifest");
	if (!module || typeof module !== "object" || !("default" in module))
		throw new Error("ASTRO_MANIFEST_MODULE_INVALID");
	const graph: unknown = module.default;
	if (
		!graph ||
		typeof graph !== "object" ||
		!("failures" in graph) ||
		!Array.isArray(graph.failures) ||
		graph.failures.length ||
		!("descriptors" in graph) ||
		!("handlers" in graph) ||
		!graph.handlers ||
		typeof graph.handlers !== "object"
	)
		throw new Error("ASTRO_ROUTE_COVERAGE_INCOMPLETE");
	return { routes: parseRouteDescriptors(graph.descriptors), handlers: graph.handlers };
}

export async function executingAstroRoutes() {
	return (await routeGraph()).routes;
}

export async function executeAstroRoute(
	id: string,
	method: string,
	context: APIContext,
): Promise<Response> {
	const graph = await routeGraph();
	const loader: unknown = Reflect.get(graph.handlers, id);
	if (typeof loader !== "function") throw new Error("ASTRO_ROUTE_HANDLER_UNAVAILABLE");
	const module: unknown = await Reflect.apply(loader, undefined, []);
	if (!module || typeof module !== "object") throw new Error("ASTRO_ROUTE_MODULE_INVALID");
	const handler: unknown =
		Reflect.get(module, method) ?? (method === "HEAD" ? Reflect.get(module, "GET") : undefined);
	if (typeof handler !== "function") throw new Error("ASTRO_ROUTE_HANDLER_UNAVAILABLE");
	const response: unknown = await Reflect.apply(handler, undefined, [context]);
	if (!(response instanceof Response)) throw new Error("ASTRO_ROUTE_RESPONSE_INVALID");
	return response;
}
