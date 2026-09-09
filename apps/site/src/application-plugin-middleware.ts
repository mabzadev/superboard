import { applicationUserOperation } from "@superboard/contracts/application-plugin-api";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import type { MiddlewareHandler } from "astro";

import { requireActiveSuperBoardPlugin } from "./lib/plugin-availability.js";
import { getSiteEnv } from "./lib/site-env.js";
import { resolveSuperBoardPluginTarget } from "./lib/superboard-plugin-catalog.js";

const route =
	/^\/_emdash\/api\/superboard\/plugins\/supbrd-plug-(?:user|identity)\/(commands|data-sources)\/(?:supbrd-plug-user\.(?:command|data_source)\.)?([a-z_]+)$/u;
export const onRequest: MiddlewareHandler = async (context, next) => {
	const match = route.exec(context.url.pathname);
	const operation = match && applicationUserOperation(match[1], match[2]);
	if (!operation || (operation.method === "GET" && !context.url.searchParams.has("request")))
		return next();
	const cors = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers":
			"Authorization, Content-Type, PROJECT-KEY, PLATFORM, IDENTIFIER, ENVIRONMENT, Idempotency-Key, X-EmDash-Request",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Cache-Control": "no-store",
	};
	if (context.request.method === "OPTIONS")
		return new Response(null, { status: 204, headers: cors });
	try {
		const env = getSiteEnv();
		const denied = await requireActiveSuperBoardPlugin(env.DB, {
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
			plugin_id: "supbrd-plug-user",
		});
		if (denied) return denied;
		if (context.request.method !== operation.method)
			return Response.json(
				{ error: { code: "METHOD_NOT_ALLOWED" } },
				{ status: 405, headers: cors },
			);
		if (
			operation.method === "POST" &&
			!context.request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")
		)
			return Response.json({ error: { code: "JSON_REQUIRED" } }, { status: 415, headers: cors });
		const envelope: unknown =
			operation.method === "POST"
				? await readJsonObjectLimited(context.request, 65536)
				: JSON.parse(context.url.searchParams.get("request") ?? "null");
		const path = `/api/v1/application-identity/${operation.kind}/${operation.id}`;
		if (
			!envelope ||
			typeof envelope !== "object" ||
			Array.isArray(envelope) ||
			!("method" in envelope) ||
			envelope.method !== operation.method ||
			!("path" in envelope) ||
			envelope.path !== path ||
			Object.keys(envelope).some((key) => !["method", "path", "body"].includes(key))
		)
			return Response.json(
				{ error: { code: "APPLICATION_ADAPTER_REQUEST_INVALID" } },
				{ status: 422, headers: cors },
			);
		const headers = new Headers();
		for (const name of [
			"Authorization",
			"PROJECT-KEY",
			"PLATFORM",
			"IDENTIFIER",
			"ENVIRONMENT",
			"Idempotency-Key",
		]) {
			const value = context.request.headers.get(name);
			if (value) headers.set(name, value);
		}
		headers.set("Content-Type", "application/json");
		if (!env.API_SERVICE)
			return Response.json(
				{ error: { code: "APPLICATION_API_UNAVAILABLE" } },
				{ status: 503, headers: cors },
			);
		const response = await env.API_SERVICE.fetch(
			new Request(`https://api.internal${path}`, {
				method: operation.method,
				headers,
				...(operation.method === "POST"
					? { body: JSON.stringify("body" in envelope ? envelope.body : {}) }
					: {}),
				signal: AbortSignal.timeout(30000),
			}),
		);
		return new Response(response.body, {
			status: response.status,
			headers: { ...cors, "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
		});
	} catch (error) {
		if (error instanceof RequestBodyError || error instanceof SyntaxError)
			return Response.json(
				{ error: { code: "APPLICATION_ADAPTER_REQUEST_INVALID" } },
				{ status: error instanceof RequestBodyError ? error.status : 422, headers: cors },
			);
		console.error("[application-plugin] request failed", error);
		return Response.json(
			{ error: { code: "APPLICATION_API_UNAVAILABLE" } },
			{ status: 503, headers: cors },
		);
	}
};
