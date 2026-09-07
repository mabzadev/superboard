import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import type { Context } from "hono";

import { getRequestAuthContext } from "../lib/auth.js";
import { resolveAuthorizedProjectContext } from "../lib/domain-modules.js";
import type { Env } from "../types.js";

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
	if (!c.env.FILES_SERVICE || !c.env.FILES_INTERNAL_TOKEN)
		return Response.json({ error: { code: "FILES_UNAVAILABLE" } }, { status: 503 });
	const source = new URL(c.req.url);
	const prefix = `/api/v1/files/projects/${encodeURIComponent(projectRef)}`;
	const target = new URL(
		`/internal/v1/operator${source.pathname.slice(prefix.length)}${source.search}`,
		"https://files.internal",
	);
	const headers = await createProjectContextHeaders(
		{
			...scope.context,
			actorId: 0,
			operatorId: auth.siteOperator.operator_id,
			module: "files",
			method: c.req.method,
			pathname: target.pathname,
			requestId: c.req.header("X-Request-Id") ?? crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		c.env.FILES_INTERNAL_TOKEN,
	);
	for (const name of ["Content-Type", "Content-Length", "Idempotency-Key", "Range"]) {
		const value = c.req.header(name);
		if (value) headers.set(name, value);
	}
	return c.env.FILES_SERVICE.fetch(new Request(new Request(target, c.req.raw), { headers }));
}
