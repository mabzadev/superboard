import { readRequestObjectLimited } from "@superboard/contracts/request-body";
import { SITE_OPERATOR_HEADERS } from "@superboard/contracts/site-operator";
import type { Context, MiddlewareHandler } from "hono";

import type { Env } from "../types.js";
import { getRequestAuthContext, type AuthContext } from "./auth.js";
import { resolveAuthorizedProjectContext } from "./domain-modules.js";

export type SiteAdapterVariables = { siteAuth?: AuthContext };
type AdapterContext = Context<{ Bindings: Env; Variables: SiteAdapterVariables }>;

export function siteOperatorAdapter(
	scope: "instances" | "projects" | "mcp",
): MiddlewareHandler<{ Bindings: Env; Variables: SiteAdapterVariables }> {
	return async (c, next) => {
		if (!c.req.raw.headers.has(SITE_OPERATOR_HEADERS.context)) return next();
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator) return c.json({ error: { code: "OPERATOR_SESSION_REQUIRED" } }, 401);
		if (!auth.instanceId)
			return c.json({ error: { code: "OPERATOR_PROJECT_SCOPE_UNAVAILABLE" } }, 409);
		c.set("siteAuth", auth);
		const segments = new URL(c.req.url).pathname
			.slice(`/api/v1/${scope}`.length)
			.split("/")
			.filter(Boolean);
		if (scope === "instances") {
			if (!segments.length) {
				if (c.req.method !== "GET")
					return c.json({ error: { code: "SINGLE_INSTANCE_REQUIRED" } }, 409);
			} else if (Number(segments[0]) !== auth.instanceId)
				return c.json({ error: { code: "INSTANCE_FORBIDDEN" } }, 403);
			if (segments.length === 1 && c.req.method === "DELETE")
				return c.json({ error: { code: "CORE_INSTANCE_DELETION_REQUIRED" } }, 409);
		}
		if (scope === "projects") {
			let projectRef = segments[0] ?? "";
			if (projectRef === "add_event") {
				const body = await readRequestObjectLimited(c.req.raw.clone(), 1024 * 1024);
				projectRef = String(body.project_id ?? "");
			}
			if (projectRef === "exports") {
				const file = await c.env.DB.prepare(
					"SELECT f.id FROM downloadable_files f JOIN projects p ON p.id = f.project_id WHERE f.file_key = ? AND p.instance_id = ?",
				)
					.bind(decodeURIComponent(segments[1] ?? ""), auth.instanceId)
					.first();
				if (!file) return c.json({ error: { code: "PROJECT_FORBIDDEN" } }, 403);
			} else {
				const project = await resolveAuthorizedProjectContext(
					c.env.DB,
					0,
					projectRef,
					auth.siteOperator,
				);
				if (!project.ok) return c.json({ error: { code: project.code } }, project.status);
				const resource = segments[1];
				const resourceId = segments[2];
				if (resourceId && /^[0-9]+$/.test(resourceId)) {
					const owned = await ownedResource(
						c,
						resource ?? "",
						resourceId,
						project.context.projectId,
					);
					if (!owned) return c.json({ error: { code: "RESOURCE_NOT_FOUND" } }, 404);
				}
			}
		}
		if (scope === "mcp" && segments[0] === "projects" && c.req.method === "POST")
			return c.json({ error: { code: "SINGLE_INSTANCE_REQUIRED" } }, 409);
		return next();
	};
}

async function ownedResource(
	c: AdapterContext,
	resource: string,
	id: string,
	projectId: number,
): Promise<boolean> {
	const sql: Record<string, string> = {
		links:
			"SELECT l.id FROM links l JOIN redirect_configs r ON r.id = l.redirect_config_id WHERE l.id = ? AND r.project_id = ?",
		campaigns: "SELECT id FROM campaigns WHERE id = ? AND project_id = ?",
		visitors: "SELECT id FROM visitors WHERE id = ? AND project_id = ?",
		notifications: "SELECT id FROM notifications WHERE id = ? AND project_id = ?",
	};
	const statement = sql[resource];
	return !statement || Boolean(await c.env.DB.prepare(statement).bind(id, projectId).first());
}
