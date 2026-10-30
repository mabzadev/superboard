import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import {
	ROUTE_REFERENCES_PATH,
	requestedRouteReferences,
	RouteReferenceError,
} from "@superboard/contracts/route-reference";
import type { MiddlewareHandler } from "astro";

import { configurationBlocks, instanceConfiguration } from "./lib/instance-configuration.js";
import { canAccessOperatorConsole } from "./lib/operator-access.js";
import { resolveApiRouteReferences } from "./lib/route-references.js";
import { getSiteEnv } from "./lib/site-env.js";
import { createSiteRouteMiddleware } from "./lib/site-route-registry.js";

const configurationRoutes = createSiteRouteMiddleware({
	module: "instance-configuration",
	pluginId: "supbrd-core",
	access: "operator",
});
configurationRoutes.on("GET", "/_emdash/api/superboard/deployment-configuration", (context, next) =>
	configurationResponse(context, next, false),
);
configurationRoutes.on(
	"POST",
	["/_emdash/api/plugins/superboard-settings/admin", "/_emdash/api/plugins/supbrd-core/admin"],
	(context, next) => configurationResponse(context, next, true),
);
configurationRoutes.on("GET", ROUTE_REFERENCES_PATH, async (context) => {
	if (!canAccessOperatorConsole(context.locals.user))
		return Response.json(
			{ error: { code: "OPERATOR_REQUIRED" } },
			{ status: context.locals.user ? 403 : 401 },
		);
	try {
		const routes = await resolveApiRouteReferences(
			getSiteEnv(),
			context.locals.user,
			requestedRouteReferences(context.url),
		);
		return Response.json({ routes }, { headers: { "Cache-Control": "private, no-store" } });
	} catch (error) {
		return Response.json(
			{
				error: {
					code: error instanceof RouteReferenceError ? error.code : "ROUTE_REFERENCE_UNAVAILABLE",
				},
			},
			{ status: 503 },
		);
	}
});
export const onRequest = configurationRoutes.onRequest;

async function configurationResponse(
	context: Parameters<MiddlewareHandler>[0],
	next: Parameters<MiddlewareHandler>[1],
	plugin: boolean,
): Promise<Response> {
	if (!canAccessOperatorConsole(context.locals.user))
		return Response.json(
			{ error: { code: "OPERATOR_REQUIRED" } },
			{ status: context.locals.user ? 403 : 401 },
		);
	try {
		let cursor = 0;
		if (plugin) {
			const body = await readJsonObjectLimited(context.request.clone(), 65536);
			if (
				body.page !== "/configuration" &&
				body.action_id !== "deployment-refresh" &&
				body.action_id !== "deployment-routes-page"
			)
				return next();
			const value = body.value;
			cursor = Number(
				value && typeof value === "object" && "cursor" in value
					? value.cursor
					: (body.cursor ?? value ?? 0),
			);
		}
		const data = await instanceConfiguration(getSiteEnv(), context.locals.user, context.request);
		const headers: Record<string, string> = { "Cache-Control": "private, no-cache" };
		if (data.routeInventory) {
			headers.ETag = `W/"${data.configuration.checksum}:${data.routeInventory.revision}"`;
			headers["X-SuperBoard-Observed-At"] = data.routeInventory.checkedAt;
			if (!plugin && context.request.headers.get("if-none-match") === headers.ETag)
				return new Response(null, { status: 304, headers });
		}
		return Response.json(
			plugin ? { data: configurationBlocks(data, context.request, cursor) } : data,
			{ headers },
		);
	} catch (error) {
		if (error instanceof RequestBodyError)
			return Response.json({ error: { code: error.code } }, { status: error.status });
		console.error("[instance-configuration] configuration unavailable");
		return Response.json(
			{ error: { code: "DEPLOYMENT_CONFIGURATION_UNAVAILABLE" } },
			{ status: 503 },
		);
	}
}
