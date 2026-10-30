import { verifyPluginTaskRequest } from "@superboard/contracts/internal-request-signature";
import {
	parseRouteDescriptors,
	ROUTE_MANIFEST_PATH,
	serializeRouteManifest,
} from "@superboard/contracts/route-manifest";
import type { RouteDescriptor } from "@superboard/contracts/route-registry";
import type { MiddlewareHandler } from "astro";

import { getSiteEnv } from "./lib/site-env.js";
import { siteMiddlewareRoutes } from "./lib/site-route-registry.js";

export const onRequest: MiddlewareHandler = async (context, next) => {
	if (context.url.pathname !== ROUTE_MANIFEST_PATH) return next();
	if (!context.url.hostname.endsWith(".internal")) return new Response(null, { status: 404 });
	if (context.request.method !== "GET") return new Response(null, { status: 405 });
	const env = getSiteEnv();
	if (!(await verifyPluginTaskRequest(context.request, env.SITE_OPERATOR_BRIDGE_TOKEN ?? "")))
		return new Response(null, { status: 403 });
	try {
		// @ts-ignore - virtual module
		const module: unknown = await import("virtual:superboard/route-manifest");
		await import("./lib/plugin-api-adapter.js");
		if (!module || typeof module !== "object" || !("default" in module))
			throw new Error("ASTRO_MANIFEST_MODULE_INVALID");
		const compiled: unknown = module.default;
		if (
			!compiled ||
			typeof compiled !== "object" ||
			!("failures" in compiled) ||
			!Array.isArray(compiled.failures) ||
			compiled.failures.length ||
			!("descriptors" in compiled)
		)
			throw new Error("ASTRO_ROUTE_COVERAGE_INCOMPLETE");
		const own: RouteDescriptor = {
			id: "site:manifest",
			routeId: "site:manifest",
			module: "route-manifest",
			pluginId: "supbrd-core",
			service: "site",
			method: "GET",
			path: ROUTE_MANIFEST_PATH,
			executionPath: ROUTE_MANIFEST_PATH,
			surface: "internal",
			access: "internal",
			transport: "http",
			kind: "canonical",
		};
		const version: unknown = Reflect.get(env, "SUPERBOARD_WORKER_VERSION");
		const buildId =
			version &&
			typeof version === "object" &&
			"id" in version &&
			typeof version.id === "string" &&
			version.id.trim()
				? version.id
				: "unavailable";
		const releaseId: unknown = Reflect.get(env, "SUPERBOARD_RELEASE");
		const manifest = await serializeRouteManifest(
			[...parseRouteDescriptors(compiled.descriptors), ...siteMiddlewareRoutes(), own],
			{
				instanceId: env.SUPERBOARD_INSTANCE_ID,
				environment: env.SUPERBOARD_ENVIRONMENT,
				service: "site",
				buildId,
				...(typeof releaseId === "string" && releaseId ? { releaseId } : {}),
			},
		);
		const headers = {
			ETag: `W/"${manifest.revision}"`,
			"Cache-Control": "private, no-cache",
			"X-SuperBoard-Observed-At": manifest.observedAt,
		};
		return context.request.headers.get("if-none-match") === headers.ETag
			? new Response(null, { status: 304, headers })
			: Response.json(manifest, { headers });
	} catch (error) {
		return Response.json(
			{
				error: {
					code: "SITE_ROUTE_COVERAGE_UNAVAILABLE",
					message: error instanceof Error ? error.message : "Unknown route inventory",
				},
			},
			{ status: 503 },
		);
	}
};
