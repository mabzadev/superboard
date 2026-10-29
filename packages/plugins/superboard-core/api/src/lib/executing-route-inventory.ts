import { routeDestinations } from "@superboard/contracts/route-registry";
import type { DeploymentConfiguration } from "@superboard/contracts/deployment-configuration";
import {
	createRouteInventoryCollector,
	type RouteInventory,
	type RouteSourceDefinition,
} from "@superboard/contracts/route-inventory";
import { buildRouteManifest } from "@superboard/contracts/route-manifest";
import { routeService } from "@superboard/contracts/route-services";

import { publishedGatewayRoutes } from "../routes/gateway-admin.js";
import { workerTopology } from "../routes/platform-status.js";
import type { Env } from "../types.js";

const collectorKey = Symbol.for("superboard.executing-route-inventory.v1");
const globals = globalThis as typeof globalThis & {
	[collectorKey]?: ReturnType<typeof createRouteInventoryCollector>;
};
const collect = (globals[collectorKey] ??= createRouteInventoryCollector());

function binding(env: Env, name: string | null | undefined): RouteSourceDefinition["binding"] {
	if (!name) return undefined;
	const value: unknown = Reflect.get(env, name);
	if (
		!value ||
		typeof value !== "object" ||
		!("fetch" in value) ||
		typeof value.fetch !== "function"
	)
		return undefined;
	const fetch = value.fetch;
	return {
		async fetch(request) {
			const response: unknown = await Reflect.apply(fetch, value, [request]);
			if (!(response instanceof Response)) throw new Error("ROUTE_RESPONSE_INVALID");
			return response;
		},
	};
}

export async function executingRouteInventory(
	env: Env,
	configuration: DeploymentConfiguration,
	router: Parameters<typeof import("@superboard/contracts/route-registry").registeredRoutes>[0],
): Promise<RouteInventory> {
	const topology = workerTopology(env);
	const expected =
		topology.status === "ok"
			? [...topology.workers.values()]
			: configuration.workers.flatMap((worker) =>
					worker.modules.map((id) => ({
						id,
						workerName: worker.name,
						enabled: true,
						managed: undefined,
					})),
				);
	const sources = expected
		.filter((source) => source.id !== "api")
		.map((source) => {
			const contract = routeService(source.id);
			const secret: unknown = contract
				? Reflect.get(env, contract.apiSecret)
				: source.managed
					? env.MODULE_INTERNAL_TOKEN
					: undefined;
			return {
				service: source.id,
				workerName: source.workerName ?? source.id,
				enabled: source.enabled,
				binding: binding(env, contract?.binding ?? source.managed?.binding),
				secret: typeof secret === "string" && secret.trim() ? secret : undefined,
			};
		});
	if (topology.status !== "ok")
		sources.push({
			service: "topology",
			workerName: "unverified",
			enabled: true,
			binding: undefined,
			secret: undefined,
		});
	const own = await buildRouteManifest(await apiRouteSources(router, env), env, {
		service: "api",
		pluginId: "supbrd-core",
	});
	return collect({
		instanceId: configuration.target,
		environment: configuration.environment,
		own,
		sources,
	});
}

export async function apiRouteSources(
	router: Parameters<typeof import("@superboard/contracts/route-registry").registeredRoutes>[0],
	env: object,
) {
	if (!hasGatewayBindings(env)) throw new Error("GATEWAY_INVENTORY_UNVERIFIABLE");
	return [router, await publishedGatewayRoutes(env.DB, env.SUPERBOARD_INSTANCE_ID)];
}
function hasGatewayBindings(
	env: object,
): env is { DB: D1Database; SUPERBOARD_INSTANCE_ID: string } {
	return (
		"DB" in env &&
		!!env.DB &&
		typeof env.DB === "object" &&
		"prepare" in env.DB &&
		typeof env.DB.prepare === "function" &&
		"SUPERBOARD_INSTANCE_ID" in env &&
		typeof env.SUPERBOARD_INSTANCE_ID === "string"
	);
}

export async function routeReferenceCandidates(
	env: Env,
	router: Parameters<typeof import("@superboard/contracts/route-registry").registeredRoutes>[0],
	ids: readonly string[],
) {
	const manifest = await buildRouteManifest(await apiRouteSources(router, env), env, {
		service: "api",
		pluginId: "supbrd-core",
	});
	const services = new Set(
		manifest.routes.flatMap((route) =>
			ids.some((id) => id.startsWith(`${route.routeId}->`))
				? routeDestinations(route).map((destination) => destination.service)
				: [],
		),
	);
	if (!services.size) return { manifest, candidates: manifest.routes };
	const topology = workerTopology(env);
	const sources = [...services].map((service) => {
		const contract = routeService(service);
		const secret: unknown = contract ? Reflect.get(env, contract.apiSecret) : undefined;
		const configured = topology.workers.get(service);
		return {
			service,
			workerName: configured?.workerName ?? service,
			enabled: configured?.enabled ?? true,
			binding: binding(env, contract?.binding),
			secret: typeof secret === "string" ? secret : undefined,
		};
	});
	const inventory = await collect({
		instanceId: manifest.instanceId,
		environment: manifest.environment,
		own: manifest,
		sources,
	});
	return { manifest, candidates: inventory.routes.filter((route) => route.service === "api") };
}
