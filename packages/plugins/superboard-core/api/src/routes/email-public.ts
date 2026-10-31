import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { registerRouter } from "@superboard/contracts/route-registry";
import { configuredSecrets, matchesAnySecret } from "@superboard/contracts/secret";
import { Hono } from "hono";

import { readJsonObjectLimited } from "../lib/http-limits";
import type { Env } from "../types";

/**
 * Public transactional email API (server-side secret keys only).
 *
 * The gateway never interprets the secret: it forwards the bearer key to the
 * Email Worker, which owns the hashed key store, scopes, per-project rate
 * limits, validation, suppressions, quotas and idempotency.
 */
const EMAIL_PUBLIC_SEND_BODY_LIMIT = 15 * 1024 * 1024;
const KEY_FORMAT = /^sb_email_[a-f0-9]{64}$/;
const FORWARDED_HEADERS = ["content-type", "idempotency-key", "user-agent"];

export const emailPublicRoutes = registerRouter(new Hono<{ Bindings: Env }>(), {
	service: "api",
	module: "routes.email-public.emailPublicRoutes",
	pluginId: "superboard-email",
	surface: "sdk",
	access: "sdk-key",
});

emailPublicRoutes
	.defineRoute({
		exposures: [
			{
				surface: "sdk",
				path: "/v1/email/send",
				aliases: ["/v1/communication/email/send", "/api/v1/email/send"],
			},
		],
	})
	.post("/api/v1/email/send", (c) =>
		proxyEmailPublicApi(c.env, c.req.raw, "/internal/v1/public/send"),
	);
emailPublicRoutes
	.defineRoute({
		exposures: [
			{
				surface: "sdk",
				path: "/v1/email/messages/:id",
				aliases: ["/v1/communication/email/messages/:id", "/api/v1/email/messages/:id"],
			},
		],
	})
	.get("/api/v1/email/messages/:id", (c) =>
		proxyEmailPublicApi(
			c.env,
			c.req.raw,
			`/internal/v1/public/messages/${encodeURIComponent(c.req.param("id"))}`,
		),
	);
emailPublicRoutes
	.defineRoute({
		exposures: [
			{
				surface: "sdk",
				path: "/v1/email/messages/:id/cancel",
				aliases: [
					"/v1/communication/email/messages/:id/cancel",
					"/api/v1/email/messages/:id/cancel",
				],
			},
		],
	})
	.post("/api/v1/email/messages/:id/cancel", (c) =>
		proxyEmailPublicApi(
			c.env,
			c.req.raw,
			`/internal/v1/public/messages/${encodeURIComponent(c.req.param("id"))}/cancel`,
		),
	);
emailPublicRoutes
	.defineRoute({ surface: "internal", access: "internal" })
	.post("/internal/v1/email/template-source", (c) => resolveEmailTemplateSource(c.env, c.req.raw));

export async function proxyEmailPublicApi(
	env: Env,
	request: Request,
	internalPath: string,
): Promise<Response> {
	const requestId = safeRequestId(request.headers.get("x-request-id"));
	const key = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
	if (!KEY_FORMAT.test(key))
		return failure(
			requestId,
			401,
			"api_key_invalid",
			"Send a server API key as Authorization: Bearer sb_email_…",
		);
	if (Number(request.headers.get("content-length") || 0) > EMAIL_PUBLIC_SEND_BODY_LIMIT)
		return failure(requestId, 413, "request_too_large", "The request body exceeds 15 MB");
	const token = env.EMAIL_INTERNAL_TOKEN?.trim();
	if (!env.EMAIL_SERVICE || !token)
		return failure(requestId, 503, "email_unavailable", "The email service is unavailable", true);
	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set("x-internal-token", token);
	headers.set("x-superboard-email-key", key);
	headers.set("x-request-id", requestId);
	try {
		const target = new URL(`https://email.internal${internalPath}`);
		// Constructing from the source Request streams the body without buffering it.
		const forwarded = new Request(target, request);
		const response = await env.EMAIL_SERVICE.fetch(new Request(forwarded, { headers }));
		const responseHeaders = new Headers();
		for (const name of ["content-type", "retry-after", "idempotency-replayed"]) {
			const value = response.headers.get(name);
			if (value) responseHeaders.set(name, value);
		}
		responseHeaders.set("cache-control", "no-store");
		responseHeaders.set("x-request-id", requestId);
		return new Response(response.body, { status: response.status, headers: responseHeaders });
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "email_public_api_proxy_failed",
				request_id: requestId,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		return failure(
			requestId,
			502,
			"email_request_failed",
			"The email service request failed",
			true,
		);
	}
}

/**
 * Internal callback for the Email Worker: loads the published Email Studio
 * template of a project from the Marketing worker with a gateway-signed,
 * read-only project context.
 */
export async function resolveEmailTemplateSource(env: Env, request: Request): Promise<Response> {
	const requestId = safeRequestId(request.headers.get("x-request-id"));
	if (
		!(await matchesAnySecret(
			request.headers.get("x-internal-token") ?? "",
			configuredSecrets(env.EMAIL_INTERNAL_TOKEN),
		))
	)
		return failure(requestId, 401, "internal_auth_invalid", "Internal authentication is required");
	let body: Record<string, unknown>;
	try {
		body = await readJsonObjectLimited(request, 4_096, "Template request is too large");
	} catch {
		return failure(requestId, 422, "template_request_invalid", "The template request is invalid");
	}
	const projectId = Number(body.project_id);
	const templateId = typeof body.template_id === "string" ? body.template_id : "";
	if (
		!Number.isSafeInteger(projectId) ||
		projectId <= 0 ||
		!/^[A-Za-z0-9._:-]{1,128}$/.test(templateId)
	)
		return failure(requestId, 422, "template_request_invalid", "The template request is invalid");
	const secret = env.MODULE_INTERNAL_TOKEN?.trim();
	if (!env.MARKETING_MODULE || !secret)
		return failure(requestId, 503, "template_unavailable", "Templates are unavailable", true);
	const project = await env.DB.prepare(
		"SELECT id, instance_id, is_test FROM projects WHERE id = ? LIMIT 1",
	)
		.bind(projectId)
		.first<{ id: number; instance_id: number; is_test: number }>();
	if (!project) return failure(requestId, 404, "template_not_found", "Template not found");
	const environment = Number(project.is_test) === 1 ? "test" : "production";
	const pathname = `/internal/v1/studio/templates/${encodeURIComponent(templateId)}/published`;
	const headers = await createProjectContextHeaders(
		{
			projectId,
			projectRef: `${project.instance_id}-${environment === "test" ? "test" : "prod"}`,
			instanceId: Number(project.instance_id),
			environment,
			actorId: 0,
			operatorId: "email-api",
			// The published-template read is restricted to project administrators;
			// the gateway signs this single read on behalf of the Email Worker.
			role: "admin",
			requestId,
			issuedAt: Math.floor(Date.now() / 1_000),
			module: "marketing",
			method: "GET",
			pathname,
		},
		secret,
	);
	try {
		const response = await env.MARKETING_MODULE.fetch(
			new Request(`https://marketing.internal${pathname}`, { method: "GET", headers }),
		);
		if (response.status === 404)
			return failure(requestId, 404, "template_not_found", "Template not found");
		if (!response.ok)
			return failure(requestId, 503, "template_unavailable", "Templates are unavailable", true);
		const payload = await readJsonObjectLimited(response, 2_000_000, "Template is too large");
		const data: unknown = payload.data;
		if (!data || typeof data !== "object" || !("document" in data) || !data.document)
			return failure(requestId, 404, "template_not_found", "Template not found");
		const revision = "revision" in data ? data.revision : undefined;
		return Response.json(
			{ data: { revision: revision ?? null, document: data.document } },
			{ headers: { "cache-control": "no-store", "x-request-id": requestId } },
		);
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "email_template_source_failed",
				request_id: requestId,
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		return failure(requestId, 503, "template_unavailable", "Templates are unavailable", true);
	}
}

function safeRequestId(value: string | null): string {
	const provided = String(value || "").trim();
	return /^[A-Za-z0-9._:-]{1,128}$/u.test(provided) ? provided : crypto.randomUUID();
}

function failure(
	requestId: string,
	status: number,
	code: string,
	message: string,
	retryable = false,
) {
	return Response.json(
		{ error: { code, message, retryable, request_id: requestId } },
		{ status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
	);
}
