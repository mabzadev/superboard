import {
	PROJECT_CONTEXT_HEADERS,
	signProjectContext,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { readBytesLimited } from "@superboard/contracts/request-body";
import { Hono, type Context } from "hono";

import { getRequestAuthContext } from "../lib/auth";
import { domainError, resolveAuthorizedProjectContext } from "../lib/domain-modules";
import type { Env } from "../types";

type AdminContext = Context<{ Bindings: Env }>;

const routes = new Hono<{ Bindings: Env }>();

routes.get("/:projectRef/users", async (c) => {
	const authorized = await authorize(c);
	if (authorized instanceof Response) return authorized;
	const source = new URL(c.req.url);
	const query = new URLSearchParams();
	for (const name of ["q", "limit", "offset"] as const) {
		const value = source.searchParams.get(name);
		if (value !== null) query.set(name, value);
	}
	return forward(c, `/internal/v1/admin/users${query.size ? `?${query}` : ""}`, authorized);
});

routes.get("/:projectRef/users/:userId", async (c) => {
	const authorized = await authorize(c);
	if (authorized instanceof Response) return authorized;
	return forward(
		c,
		`/internal/v1/admin/users/${encodeURIComponent(c.req.param("userId"))}`,
		authorized,
	);
});

routes.get("/:projectRef/members", async (c) => {
	const authorized = await authorize(c);
	if (authorized instanceof Response) return authorized;
	return forward(c, `/internal/v1/admin/members${new URL(c.req.url).search}`, authorized);
});
routes.all("/:projectRef/profiles/:userId", async (c) => {
	if (!["GET", "PUT"].includes(c.req.method)) return c.notFound();
	const authorized = await authorize(c);
	if (authorized instanceof Response) return authorized;
	return forward(
		c,
		`/internal/v1/admin/profiles/${encodeURIComponent(c.req.param("userId"))}`,
		authorized,
	);
});
routes.post("/:projectRef/profiles/:userId/suspend", async (c) => {
	const authorized = await authorize(c);
	if (authorized instanceof Response) return authorized;
	return forward(
		c,
		`/internal/v1/admin/profiles/${encodeURIComponent(c.req.param("userId"))}/suspend`,
		authorized,
	);
});

async function authorize(c: AdminContext): Promise<InternalProjectContext | Response> {
	const requestId = c.req.header("x-request-id") || crypto.randomUUID();
	const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
	if (!auth) {
		return domainError(requestId, 401, "unauthorized", "Invalid or expired token");
	}
	const project = await resolveAuthorizedProjectContext(
		c.env.DB,
		auth.userId,
		c.req.param("projectRef") || "",
		auth.siteOperator,
	);
	if (!project.ok) {
		return domainError(requestId, project.status, project.code, project.message);
	}
	if (!new Set(["owner", "admin"]).has(project.context.role)) {
		return domainError(
			requestId,
			403,
			"administrator_required",
			"Owner or administrator access is required",
		);
	}
	return {
		...project.context,
		actorId: auth.userId,
		...(auth.siteOperator ? { operatorId: auth.siteOperator.operator_id } : {}),
		requestId,
		issuedAt: Math.floor(Date.now() / 1_000),
		module: "identity",
		method: c.req.method,
		pathname: "",
	};
}

async function forward(
	c: AdminContext,
	path: string,
	authorized: InternalProjectContext,
): Promise<Response> {
	const requestId = c.req.header("x-request-id") || crypto.randomUUID();
	if (!c.env.IDENTITY_SERVICE || !c.env.MODULE_INTERNAL_TOKEN) {
		return domainError(
			requestId,
			503,
			"identity_admin_unavailable",
			"Application identity administration is unavailable",
			{ retryable: true },
		);
	}
	try {
		const target = new URL(`https://identity.internal${path}`);
		const context = { ...authorized, pathname: target.pathname };
		const signature = await signProjectContext(context, c.env.MODULE_INTERNAL_TOKEN);
		const internal = await c.env.IDENTITY_SERVICE.fetch(target, {
			method: c.req.method,
			headers: {
				accept: "application/json",
				"Content-Type": "application/json",
				"Idempotency-Key": c.req.header("Idempotency-Key") ?? "",
				[PROJECT_CONTEXT_HEADERS.token]: c.env.MODULE_INTERNAL_TOKEN,
				[PROJECT_CONTEXT_HEADERS.projectId]: String(context.projectId),
				[PROJECT_CONTEXT_HEADERS.projectRef]: context.projectRef,
				[PROJECT_CONTEXT_HEADERS.instanceId]: String(context.instanceId),
				[PROJECT_CONTEXT_HEADERS.environment]: context.environment,
				[PROJECT_CONTEXT_HEADERS.actorId]: String(context.actorId),
				...(context.operatorId ? { [PROJECT_CONTEXT_HEADERS.operatorId]: context.operatorId } : {}),
				[PROJECT_CONTEXT_HEADERS.role]: context.role,
				[PROJECT_CONTEXT_HEADERS.requestId]: requestId,
				[PROJECT_CONTEXT_HEADERS.issuedAt]: String(context.issuedAt),
				[PROJECT_CONTEXT_HEADERS.version]: "1",
				[PROJECT_CONTEXT_HEADERS.signature]: signature,
			},
			...(c.req.method !== "GET" ? { body: await readBytesLimited(c.req.raw, 16384) } : {}),
			signal: AbortSignal.timeout(10_000),
		});
		const headers = new Headers({
			"cache-control": "private, no-store",
			"content-type": internal.headers.get("content-type") || "application/json; charset=utf-8",
			"x-content-type-options": "nosniff",
			"x-request-id": requestId,
		});
		return new Response(internal.body, {
			status: internal.status,
			headers,
		});
	} catch (cause) {
		console.error(
			JSON.stringify({
				event: "identity_admin_proxy_failed",
				request_id: requestId,
				error: cause instanceof Error ? cause.message : String(cause),
			}),
		);
		return domainError(
			requestId,
			502,
			"identity_admin_request_failed",
			"Application identity administration could not be queried",
			{ retryable: true },
		);
	}
}

export default routes;
