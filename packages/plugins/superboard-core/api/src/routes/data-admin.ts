import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { resolveRouteDestination } from "@superboard/contracts/route-registry";
import { routeService } from "@superboard/contracts/route-services";
import type { Context } from "hono";

import { getRequestAuthContext } from "../lib/auth.js";
import { resolveAuthorizedProjectContext } from "../lib/domain-modules.js";
import type { Env } from "../types.js";

const DATA_BRICKS = [
	["database", "superboard-database"],
	["storage", "superboard-storage"],
	["functions", "superboard-functions"],
	["vectors", "superboard-vectors"],
] as const;

export const dataAdminRoutes = DATA_BRICKS.map(([brick, pluginId]) => ({
	id: `api:data-${brick}:operator-proxy`,
	path: `/api/v1/data/${brick}/projects/:projectRef/:rest{.+}`,
	pluginId,
	access: "operator" as const,
	transport: "fallback" as const,
	destination: { service: "files" as const, path: `/internal/v1/data/${brick}/:rest{.+}` },
}));

type DataAdminRoute = (typeof dataAdminRoutes)[number];

export function dataAdmin(route: DataAdminRoute) {
	return async (c: Context<{ Bindings: Env }>): Promise<Response> => {
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator)
			return Response.json({ error: { code: "OPERATOR_REQUIRED" } }, { status: 401 });
		const scope = await resolveAuthorizedProjectContext(
			c.env.DB,
			auth.userId,
			c.req.param("projectRef") ?? "",
			auth.siteOperator,
		);
		if (!scope.ok)
			return Response.json({ error: { code: scope.code } }, { status: scope.status });
		const contract = routeService(route.destination.service);
		const service = c.env[contract.binding];
		const token = c.env[contract.apiSecret];
		if (!service || !token)
			return Response.json({ error: { code: "DATA_UNAVAILABLE" } }, { status: 503 });
		const source = new URL(c.req.url);
		const destination = resolveRouteDestination(route, source.pathname);
		if (!destination) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
		const target = new URL(destination.path, `https://${destination.service}.internal`);
		target.search = source.search;
		const headers = await createProjectContextHeaders(
			{
				...scope.context,
				actorId: 0,
				operatorId: auth.siteOperator.operator_id,
				module: route.destination.service,
				method: c.req.method,
				pathname: target.pathname,
				requestId: c.req.header("X-Request-Id") ?? crypto.randomUUID(),
				issuedAt: Math.floor(Date.now() / 1000),
			},
			token,
		);
		for (const name of ["Content-Type", "Content-Length", "Range"]) {
			const value = c.req.header(name);
			if (value) headers.set(name, value);
		}
		return service.fetch(new Request(new Request(target, c.req.raw), { headers }));
	};
}
