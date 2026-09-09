import type {
	DeploymentConfiguration,
	DeploymentRoute,
} from "@superboard/contracts/deployment-configuration";

export function deploymentRoutes(
	routes: readonly { method: string; path: string }[],
	configuration: DeploymentConfiguration,
	sdkRoutes: readonly { method: string; path: string }[] = [],
	isClientRoute: (path: string) => boolean = () => false,
): DeploymentRoute[] {
	const endpoints = new Map(configuration.endpoints.map((item) => [item.surface, item.url]));
	const seen = new Set<string>();
	const result: DeploymentRoute[] = [];
	const add = (
		route: { method: string; path: string },
		surface: string,
		worker: string,
		clients: string[],
	) => {
		if (route.path.startsWith("/internal") || route.path === "*" || route.path === "/*") return;
		const origin = endpoints.get(surface);
		if (!origin) return;
		const key = `${surface}:${route.method}:${route.path}`;
		if (seen.has(key)) return;
		seen.add(key);
		result.push({
			method: route.method,
			path: route.path,
			surface,
			worker,
			clients,
			url: `${origin}${route.path}`,
		});
	};
	for (const route of sdkRoutes)
		add(
			route,
			route.path.startsWith("/custom/") ? "custom-api" : "sdk",
			route.path.startsWith("/custom/") ? "custom" : "api",
			["mobile", "web"],
		);
	for (const route of routes) {
		if (route.path.includes("/custom/")) continue;
		if (route.path.startsWith("/api/v1/sdk") || isClientRoute(route.path))
			add(route, "sdk", "api", ["mobile", "web"]);
	}
	return result.sort(
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
