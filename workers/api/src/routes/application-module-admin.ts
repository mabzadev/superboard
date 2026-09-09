import { readRequestObjectLimited } from "@superboard/contracts/request-body";
import type { Context } from "hono";

import { getRequestAuthContext } from "../lib/auth.js";
import { resolveAuthorizedProjectContext } from "../lib/domain-modules.js";
import type { Env } from "../types.js";

const resourcePattern = /^\/(?:jobs|voices|conversions|outputs)(?:\/[a-zA-Z0-9._:-]+\/retry)?$/u;

export async function applicationModuleAdmin(c: Context<{ Bindings: Env }>): Promise<Response> {
	const pluginId = `supbrd-plugmod-${c.req.param("plugin")}`;
	if (pluginId !== c.env.CUSTOM_WORKER_PLUGIN_ID || !c.env.CUSTOM_WORKER)
		return Response.json({ error: { code: "PLUGIN_NOT_FOUND" } }, { status: 404 });
	const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
	if (!auth?.siteOperator)
		return Response.json({ error: { code: "OPERATOR_REQUIRED" } }, { status: 401 });
	if (auth.siteOperator.role < 40)
		return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
	const projectRef = c.req.param("projectRef") ?? "";
	const scope = await resolveAuthorizedProjectContext(
		c.env.DB,
		auth.userId,
		projectRef,
		auth.siteOperator,
	);
	if (!scope.ok) return Response.json({ error: { code: scope.code } }, { status: scope.status });
	const source = new URL(c.req.url);
	const prefix = `/api/v1/plugins/${c.req.param("plugin")}/projects/${projectRef}`;
	const resource = source.pathname.slice(prefix.length);
	if (
		resource === "/runtime-identities" &&
		c.req.method === "PUT" &&
		pluginId === "supbrd-plugmod-vocostar"
	) {
		if (auth.siteOperator.role < 50)
			return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
		if (!c.env.CUSTOM_WORKER_TOKEN)
			return Response.json({ error: { code: "PLUGIN_UNAVAILABLE" } }, { status: 503 });
		const body = await readRequestObjectLimited(c.req.raw, 4096);
		const response = await c.env.CUSTOM_WORKER.fetch(
			new Request("https://custom.internal/internal/v1/runtime/identities", {
				method: "PUT",
				headers: {
					"content-type": "application/json",
					"x-custom-worker-token": c.env.CUSTOM_WORKER_TOKEN,
				},
				body: JSON.stringify({
					legacyUserId: body.legacyUserId,
					subject: body.subject,
					projectRef,
				}),
				signal: AbortSignal.timeout(10000),
			}),
		);
		return new Response(response.body, {
			status: response.status,
			headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
		});
	}
	if (
		!resourcePattern.test(resource) ||
		(c.req.method !== "GET" &&
			!(c.req.method === "POST" && resource.startsWith("/jobs/") && resource.endsWith("/retry")))
	)
		return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	if (!c.env.CUSTOM_WORKER_TOKEN)
		return Response.json({ error: { code: "PLUGIN_UNAVAILABLE" } }, { status: 503 });
	const query = new URLSearchParams();
	for (const name of ["limit", "cursor", "status", "capability"]) {
		const value = source.searchParams.get(name);
		if (value !== null) query.set(name, value);
	}
	const response = await c.env.CUSTOM_WORKER.fetch(
		new Request(
			`https://custom.internal/internal/v1/operator/projects/${encodeURIComponent(projectRef)}${resource}?${query}`,
			{
				method: c.req.method,
				headers: { "x-custom-worker-token": c.env.CUSTOM_WORKER_TOKEN },
				signal: AbortSignal.timeout(10000),
			},
		),
	);
	return new Response(response.body, {
		status: response.status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}
