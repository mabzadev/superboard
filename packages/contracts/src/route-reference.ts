import { pluginPackage } from "./plugin-packages.js";
import { routeParameterNames, type RouteDescriptor } from "./route-registry.js";

function matchesOwner(routePluginId: string, expectedOwner: string): boolean {
	if (routePluginId === expectedOwner) return true;
	const pkg = pluginPackage(expectedOwner);
	if (pkg) {
		if (pkg.id === routePluginId || pkg.directory === routePluginId) return true;
		if (pkg.components.includes(routePluginId)) return true;
	}
	const routePkg = pluginPackage(routePluginId);
	if (routePkg) {
		if (routePkg.id === expectedOwner || routePkg.directory === expectedOwner) return true;
		if (routePkg.components.includes(expectedOwner)) return true;
	}
	return false;
}

export const ROUTE_REFERENCES_PATH = "/_emdash/api/superboard/route-definitions";
export const INTERNAL_ROUTE_REFERENCES_PATH = "/internal/site/route-definitions";
export const INTERNAL_ROUTE_OWNER_PATH = "/internal/site/route-owner";

export function routeReferenceBatches(ids: readonly string[]): string[][] {
	const batches: string[][] = [];
	let batch: string[] = [];
	let size = 0;
	for (const id of new Set(ids)) {
		const length = new URLSearchParams({ route_id: id }).toString().length + 1;
		if (length > 1800) throw new RouteReferenceError("ROUTE_REFERENCE_INVALID");
		if (batch.length && (size + length > 1800 || batch.length >= 64)) {
			batches.push(batch);
			batch = [];
			size = 0;
		}
		batch.push(id);
		size += length;
	}
	if (batch.length) batches.push(batch);
	return batches;
}
export interface RouteReferenceTarget {
	route_id?: string;
	method?: string;
	path?: string;
}
export class RouteReferenceError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}
export function selectRouteReference(
	routes: readonly RouteDescriptor[],
	id: string,
	owner?: string,
): RouteDescriptor {
	const candidates = routes.filter(
		(route) =>
			(!("availability" in route) || route.availability === "current") &&
			((route.routeId === id && route.kind === "canonical") ||
				(route.id === id && (route.kind === "canonical" || route.kind === "alias"))) &&
			(route.surface === "internal" || (route.service === "site" && route.surface === "board")) &&
			route.transport !== "fallback",
	);
	if (!candidates.length) throw new RouteReferenceError("ROUTE_REFERENCE_UNAVAILABLE");
	if (candidates.length !== 1) throw new RouteReferenceError("ROUTE_REFERENCE_AMBIGUOUS");
	const route = candidates[0];
	if (!route || (owner !== undefined && !matchesOwner(route.pluginId, owner))) {
		throw new RouteReferenceError("ROUTE_REFERENCE_OWNER_MISMATCH");
	}
	return route;
}

export function selectRouteReferences(
	routes: readonly RouteDescriptor[],
	ids: readonly string[],
): RouteDescriptor[] {
	const selected = new Map<string, RouteDescriptor>();
	for (const id of ids) {
		const route = selectRouteReference(routes, id);
		selected.set(route.id, route);
		if (route.aliasOf) {
			const canonical = selectRouteReference(routes, route.aliasOf);
			selected.set(canonical.id, canonical);
		}
	}
	return [...selected.values()];
}
export function resolveRouteReference<T extends RouteReferenceTarget>(
	operation: T,
	routes: readonly RouteDescriptor[],
	owner?: string,
): T & { method: string; path: string } {
	if (!operation.route_id) {
		if (!operation.method || !operation.path)
			throw new RouteReferenceError("ROUTE_REFERENCE_INVALID");
		return { ...operation, method: operation.method, path: operation.path };
	}
	if (operation.method !== undefined || operation.path !== undefined)
		throw new RouteReferenceError("ROUTE_REFERENCE_DUPLICATED");
	const route = selectRouteReference(routes, operation.route_id, owner);
	if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(route.method))
		throw new RouteReferenceError("ROUTE_REFERENCE_METHOD_UNSUPPORTED");
	if ("parameters" in operation) {
		const expected = new Set(routeParameterNames(route.path));
		const parameters: unknown = operation.parameters;
		if (
			!Array.isArray(parameters) ||
			parameters.length !== expected.size ||
			new Set(parameters).size !== expected.size ||
			parameters.some((value) => typeof value !== "string" || !expected.has(value))
		)
			throw new RouteReferenceError("ROUTE_REFERENCE_PARAMETERS_MISMATCH");
	}
	return { ...operation, method: route.method, path: route.path };
}
export function requestedRouteReferences(url: URL): string[] {
	const ids = [...new Set(url.searchParams.getAll("route_id"))];
	if (!ids.length || ids.length > 64 || ids.some((id) => !id.trim() || id.length > 4096))
		throw new RouteReferenceError("ROUTE_REFERENCE_INVALID");
	return ids;
}
