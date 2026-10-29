import type {
	DeploymentConfiguration,
	DeploymentRoute,
} from "@superboard/contracts/deployment-configuration";
import {
	routeDestinations,
	registeredRoutes,
	type RouteDescriptor,
} from "@superboard/contracts/route-registry";

export function deploymentRoutes(
	router: Parameters<typeof registeredRoutes>[0],
	configuration: DeploymentConfiguration,
	observed: readonly RouteDescriptor[] = registeredRoutes(router),
): DeploymentRoute[] {
	const origins = new Map(
		configuration.endpoints.map((endpoint) => [endpoint.surface, endpoint.url]),
	);
	const surfaces = {
		sdk: "sdk",
		board: "console",
		shortlinks: "links",
		"custom-api": "custom-api",
	} as const;
	return observed
		.map((route): DeploymentRoute => {
			const origin =
				route.surface === "internal" ? undefined : origins.get(surfaces[route.surface]);
			const destination = origin ? new URL(origin) : undefined;
			if (destination) destination.pathname = route.path;
			return {
				transport: route.transport,
				...(route.executionScope ? { executionScope: route.executionScope } : {}),
				...(routeDestinations(route).length ? { destinations: routeDestinations(route) } : {}),
				id: route.id,
				routeId: route.routeId,
				pluginId: route.pluginId,
				method: route.method,
				path: route.path,
				surface: route.surface,
				...(destination ? { url: destination.href } : {}),
				worker: route.service,
				clients:
					route.surface === "internal"
						? ["service"]
						: route.surface === "board"
							? ["operator"]
							: ["mobile", "web"],
				kind: route.kind,
				access: route.access,
				...("availability" in route &&
				(route.availability === "current" || route.availability === "stale")
					? { availability: route.availability }
					: {}),
				...("buildId" in route && typeof route.buildId === "string"
					? { buildId: route.buildId }
					: {}),
				...("observedAt" in route && typeof route.observedAt === "string"
					? { observedAt: route.observedAt }
					: {}),
				...("origin" in route && (route.origin === "cms" || route.origin === "superboard")
					? { origin: route.origin }
					: {}),
			};
		})
		.sort(
			(a, b) =>
				a.surface.localeCompare(b.surface) ||
				a.path.localeCompare(b.path) ||
				a.method.localeCompare(b.method),
		);
}

export function deploymentWebOrigins(raw: string | undefined): string[] {
	const parsed: unknown = JSON.parse(raw ?? "[]");
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((value: unknown) => {
		if (typeof value !== "string") return [];
		try {
			const url = new URL(value);
			return !url.username &&
				!url.password &&
				url.pathname === "/" &&
				!url.search &&
				!url.hash &&
				(url.protocol === "https:" ||
					(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
				? [url.origin]
				: [];
		} catch {
			return [];
		}
	});
}
