import {
	PROJECT_CONTEXT_HEADERS,
	signProjectContext,
	type ProjectContext,
} from "@superboard/contracts/project-context";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import type { Context, Next } from "hono";

import { decryptJson, sha256 } from "./secrets.js";
import type { Env } from "./types.js";

type MarketingContext = Context<{ Bindings: Env; Variables: { project: ProjectContext } }>;

export async function migrateEmailProfiles(c: MarketingContext): Promise<Response> {
	const project = c.get("project");
	if (!c.env.EMAIL_SERVICE || !c.env.EMAIL_INTERNAL_TOKEN)
		return Response.json({ error: { code: "email_service_unavailable" } }, { status: 503 });
	const body = c.req.raw.body ? await readJsonObjectLimited(c.req.raw, 1024) : {};
	const cursor = typeof body.cursor === "string" ? body.cursor : "";
	await c.env.DB.prepare(
		"INSERT INTO marketing_email_profile_authority (project_id,status,last_cursor) VALUES (?,'pending','') ON CONFLICT DO NOTHING",
	)
		.bind(project.projectId)
		.run();
	const state = await c.env.DB.prepare(
		"SELECT status,last_cursor FROM marketing_email_profile_authority WHERE project_id = ?",
	)
		.bind(project.projectId)
		.first<{ status: string; last_cursor: string }>();
	if (state?.status === "active") return Response.json({ data: { complete: true, imported: 0 } });
	if (state?.last_cursor !== cursor)
		return Response.json({ error: { code: "migration_cursor_conflict" } }, { status: 409 });
	const rows = await c.env.DB.prepare(
		"SELECT * FROM smtp_profiles WHERE project_id = ? AND id > ? ORDER BY id LIMIT 101",
	)
		.bind(project.projectId, cursor)
		.all<Record<string, unknown>>();
	const batch = rows.results.slice(0, 100);
	const profiles = await Promise.all(
		batch.map(async (row) => ({
			...row,
			...JSON.parse(String(row.public_config_json)),
			...(await decryptJson<{ password: string | null }>(
				c.env.SMTP_ENCRYPTION_KEY,
				String(row.encrypted_config),
			)),
			encrypted_config: undefined,
			public_config_json: undefined,
			project_id: undefined,
		})),
	);
	const operationKey = `smtp-migration:${await sha256(`${project.projectId}:${cursor}`)}`;
	const response = await forward(
		c,
		"/internal/v1/admin/migration/smtp-profiles",
		"POST",
		JSON.stringify({ profiles }),
		operationKey,
	);
	if (!response.ok) return response;
	const complete = rows.results.length <= 100;
	const nextCursor = String(batch.at(-1)?.id ?? cursor);
	await c.env.DB.prepare(
		"UPDATE marketing_email_profile_authority SET status = ?,last_cursor = ?,completed_at = ? WHERE project_id = ? AND last_cursor = ?",
	)
		.bind(
			complete ? "active" : "pending",
			nextCursor,
			complete ? new Date().toISOString() : null,
			project.projectId,
			cursor,
		)
		.run();
	return Response.json(
		{
			data: { complete, imported: batch.length, ...(!complete ? { next_cursor: nextCursor } : {}) },
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

export async function forwardMigratedEmailProfiles(
	c: MarketingContext,
	next: Next,
): Promise<Response | void> {
	if (!new URL(c.req.url).pathname.startsWith("/internal/v1/settings/smtp")) return next();
	if (new URL(c.req.url).pathname.endsWith("/migrate-to-email")) return next();
	const state = await c.env.DB.prepare(
		"SELECT status FROM marketing_email_profile_authority WHERE project_id = ?",
	)
		.bind(c.get("project").projectId)
		.first<{ status: string }>()
		.catch((error: unknown) => {
			if (error instanceof Error && error.message.includes("no such table")) return null;
			throw error;
		});
	if (!state) return next();
	if (state.status === "pending")
		return ["GET", "HEAD"].includes(c.req.method)
			? next()
			: Response.json({ error: { code: "email_profile_migration_pending" } }, { status: 503 });
	const source = new URL(c.req.url);
	return forward(
		c,
		source.pathname.replace("/internal/v1/", "/internal/v1/admin/") + source.search,
		c.req.method,
		c.req.raw.body,
		c.req.header("Idempotency-Key"),
	);
}

async function forward(
	c: MarketingContext,
	path: string,
	method: string,
	body: BodyInit | null | undefined,
	operationKey?: string,
): Promise<Response> {
	if (!c.env.EMAIL_SERVICE || !c.env.EMAIL_INTERNAL_TOKEN)
		return Response.json({ error: { code: "email_service_unavailable" } }, { status: 503 });
	const target = new URL(path, "https://email.internal");
	const context = {
		...c.get("project"),
		module: "email" as const,
		method,
		pathname: target.pathname,
		issuedAt: Math.floor(Date.now() / 1000),
	};
	const headers = new Headers({
		"Content-Type": "application/json",
		[PROJECT_CONTEXT_HEADERS.token]: c.env.EMAIL_INTERNAL_TOKEN,
		[PROJECT_CONTEXT_HEADERS.projectId]: String(context.projectId),
		[PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
		[PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
		[PROJECT_CONTEXT_HEADERS.environment]: context.environment,
		[PROJECT_CONTEXT_HEADERS.actorId]: String(context.actorId),
		[PROJECT_CONTEXT_HEADERS.role]: context.role,
		[PROJECT_CONTEXT_HEADERS.requestId]: context.requestId,
		[PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
		[PROJECT_CONTEXT_HEADERS.version]: "1",
		[PROJECT_CONTEXT_HEADERS.signature]: await signProjectContext(
			context,
			c.env.EMAIL_INTERNAL_TOKEN,
		),
	});
	if (context.operatorId) headers.set(PROJECT_CONTEXT_HEADERS.operatorId, context.operatorId);
	if (operationKey) headers.set("Idempotency-Key", operationKey);
	return c.env.EMAIL_SERVICE.fetch(
		new Request(target, { method, headers, body: ["GET", "HEAD"].includes(method) ? null : body }),
	);
}
