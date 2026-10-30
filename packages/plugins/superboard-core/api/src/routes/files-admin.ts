import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { resolveRouteDestination } from "@superboard/contracts/route-registry";
import { routeService } from "@superboard/contracts/route-services";
import type { Context } from "hono";

import { getRequestAuthContext } from "../lib/auth.js";
import { resolveAuthorizedProjectContext } from "../lib/domain-modules.js";
import type { Env } from "../types.js";

export const filesAdminRoute = {
	id: "api:files:operator-proxy",
	path: "/api/v1/files/projects/:projectRef/:rest{.+}",
	pluginId: "superboard-files",
	access: "operator" as const,
	transport: "fallback" as const,
	destination: { service: "files" as const, path: "/internal/v1/operator/:rest{.+}" },
};

export async function filesAdmin(c: Context<{ Bindings: Env }>): Promise<Response> {
	const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
	if (!auth?.siteOperator)
		return Response.json({ error: { code: "OPERATOR_REQUIRED" } }, { status: 401 });
	const projectRef = c.req.param("projectRef") ?? "";
	const scope = await resolveAuthorizedProjectContext(
		c.env.DB,
		auth.userId,
		projectRef,
		auth.siteOperator,
	);
	if (!scope.ok) return Response.json({ error: { code: scope.code } }, { status: scope.status });
	const contract = routeService(filesAdminRoute.destination.service);
	const service = c.env[contract.binding];
	const token = c.env[contract.apiSecret];
	if (!service || !token)
		return Response.json({ error: { code: "FILES_UNAVAILABLE" } }, { status: 503 });
	const source = new URL(c.req.url);
	const destination = resolveRouteDestination(filesAdminRoute, source.pathname);
	if (!destination) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	const target = new URL(destination.path, `https://${destination.service}.internal`);
	target.search = source.search;
	const headers = await createProjectContextHeaders(
		{
			...scope.context,
			actorId: 0,
			operatorId: auth.siteOperator.operator_id,
			module: filesAdminRoute.destination.service,
			method: c.req.method,
			pathname: target.pathname,
			requestId: c.req.header("X-Request-Id") ?? crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		token,
	);
	for (const name of ["Content-Type", "Content-Length", "Idempotency-Key", "Range"]) {
		const value = c.req.header(name);
		if (value) headers.set(name, value);
	}
	return service.fetch(new Request(new Request(target, c.req.raw), { headers }));
}
