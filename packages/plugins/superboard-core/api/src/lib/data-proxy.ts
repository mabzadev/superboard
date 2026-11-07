import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import type { Context } from "hono";

import type { Env } from "../types.js";
import { resolveSdkProjectContext } from "./domain-modules.js";

export const DATA_FAMILIES = [
	["db", "superboard-database"],
	["storage", "superboard-storage"],
	["realtime", "superboard-database"],
	["functions", "superboard-functions"],
	["vectors", "superboard-vectors"],
	["ai", "superboard-vectors"],
	["manage", "superboard-database"],
] as const;
type DataFamily = (typeof DATA_FAMILIES)[number][0];

const FORWARDED_HEADERS = [
	"authorization",
	"content-type",
	"content-length",
	"accept",
	"range",
	"if-none-match",
	"if-match",
	"if-modified-since",
	"x-upsert",
	"x-request-id",
	"cf-connecting-ip",
	"upgrade",
	"sec-websocket-key",
	"sec-websocket-version",
	"sec-websocket-protocol",
	"sec-websocket-extensions",
];
const INTERNAL_HEADER =
	/^(x-internal|x-project|x-instance|x-environment|x-actor|x-operator|x-role|x-context|x-superboard-|host$|cookie$|cf-)/iu;
const SELF_AUTHENTICATED = [
	/^\/v1\/storage\/signed\/[^/]+$/u,
	/^\/v1\/storage\/public\//u,
	/^\/v1\/realtime\/connect$/u,
];

export function dataInternalPath(family: DataFamily, pathname: string): string | null {
	const prefix = `/api/v1/app-data/${family}`;
	if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
	return `/v1/${family}${pathname.slice(prefix.length)}`;
}

export async function proxyDataService(
	c: Context<{ Bindings: Env }>,
	internalPath: string,
): Promise<Response> {
	const service = c.env.FILES_SERVICE;
	const token = c.env.FILES_INTERNAL_TOKEN;
	if (!service || !token)
		return failure(503, "data_unavailable", "Data service is unavailable", true);
	const request = c.req.raw;
	const source = new URL(request.url);
	const target = new URL(internalPath, "https://files.internal");
	target.search = source.search;
	const method = request.method.toUpperCase();
	const headers = forwardedHeaders(request, internalPath.startsWith("/v1/functions/"));
	const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/iu)?.[1] ?? "";
	if (
		!bearer.startsWith("sb_secret_") &&
		!SELF_AUTHENTICATED.some((pattern) => pattern.test(internalPath))
	) {
		const resolved = await resolveSdkProjectContext(c.env.DB, request, c.env);
		if (!resolved.ok)
			return failure(resolved.status, resolved.code, resolved.message, resolved.status === 503);
		const context = await createProjectContextHeaders(
			{
				...resolved.context,
				actorId: 0,
				role: "sdk",
				module: "files",
				method,
				pathname: target.pathname,
				requestId: requestId(request),
				issuedAt: Math.floor(Date.now() / 1000),
			},
			token,
		);
		for (const [name, value] of context) headers.set(name, value);
	}
	const websocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
	try {
		return await service.fetch(target, {
			method,
			headers,
			body: method === "GET" || method === "HEAD" ? null : request.body,
			...(websocket ? {} : { signal: AbortSignal.timeout(timeoutFor(internalPath)) }),
		});
	} catch (cause) {
		console.error(
			JSON.stringify({
				event: "data_proxy_failed",
				path: internalPath,
				error: cause instanceof Error ? cause.message : String(cause),
			}),
		);
		return failure(503, "data_unavailable", "Data service is unavailable", true);
	}
}

function forwardedHeaders(request: Request, functionCall: boolean): Headers {
	const headers = new Headers();
	if (functionCall) {
		for (const [name, value] of request.headers)
			if (!INTERNAL_HEADER.test(name)) headers.set(name, value);
		const ip = request.headers.get("cf-connecting-ip");
		if (ip) headers.set("cf-connecting-ip", ip);
		return headers;
	}
	for (const name of FORWARDED_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	return headers;
}

function timeoutFor(path: string): number {
	if (path.startsWith("/v1/functions/")) return 310_000;
	if (path.startsWith("/v1/storage/")) return 300_000;
	return 60_000;
}

function requestId(request: Request): string {
	const provided = request.headers.get("x-request-id") ?? "";
	return /^[A-Za-z0-9._:-]{1,128}$/u.test(provided) ? provided : crypto.randomUUID();
}

function failure(status: number, code: string, message: string, retryable: boolean): Response {
	return Response.json(
		{ error: { code, message, retryable } },
		{ status, headers: { "cache-control": "no-store" } },
	);
}
