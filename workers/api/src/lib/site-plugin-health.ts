import { inspectSqlDatabaseAndSchemaHealth } from "@superboard/contracts/health";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

import type { Env } from "../types.js";

const nativePlugins = new Set([
	"supbrd-plug-user",
	"supbrd-plug-settings",
	"supbrd-plug-content",
	"supbrd-plug-products",
	"supbrd-plug-audit",
]);
const bindings = {
	"supbrd-plugmod-vocostar": ["CUSTOM_WORKER", "/health"],
	"supbrd-plugmod-billing": ["BILLING", "/internal/v1/health"],
	"supbrd-plugmod-support": ["SUPPORT_MODULE", "/internal/v1/health"],
	"supbrd-plugmod-flows": ["FLOWS_MODULE", "/internal/v1/health"],
	"supbrd-plugmod-analytics": ["ANALYTICS_MODULE", "/internal/v1/health"],
	"supbrd-plugmod-marketing": ["MARKETING_MODULE", "/internal/v1/health"],
	"supbrd-plugmod-email": ["EMAIL_SERVICE", "/internal/v1/health"],
	"supbrd-plugmod-dynamic-links": ["DYNAMIC_LINKS_MODULE", "/internal/v1/health"],
	"supbrd-plugmod-files": ["FILES_SERVICE", "/health"],
	"supbrd-plugmod-paywalls": ["PAYWALLS_MODULE", "/internal/v1/health"],
	"supbrd-plugmod-onboardings": ["ONBOARDINGS_MODULE", "/internal/v1/health"],
	"supbrd-plugmod-observability": ["OBSERVABILITY", "/internal/v1/health"],
} as const;
const nativeWorkerBindings: Record<
	string,
	readonly (readonly ["APP_MODULE" | "PRODUCTS_MODULE" | "IDENTITY_SERVICE", string])[]
> = {
	"supbrd-plug-user": [
		["APP_MODULE", "/internal/v1/health"],
		["IDENTITY_SERVICE", "/health"],
	],
	"supbrd-plug-settings": [["APP_MODULE", "/internal/v1/health"]],
	"supbrd-plug-products": [["PRODUCTS_MODULE", "/internal/v1/health"]],
};

export async function inspectSitePluginWorkerHealth(env: Env, pluginId: string): Promise<Response> {
	try {
		if (pluginId === "supbrd-plugmod-vocostar" && env.CUSTOM_WORKER_PLUGIN_ID !== pluginId)
			throw new Error("PLUGIN_TARGET_MISMATCH");
		let evidence: unknown;
		if (nativePlugins.has(pluginId) || pluginId === "supbrd-plugmod-gateway") {
			const schema = await inspectSqlDatabaseAndSchemaHealth(env.DB, env.D1_EXPECTED_MIGRATION);
			await env.KV.get("superboard:plugin-readiness");
			if (schema.status !== "current") throw new Error("DATABASE_SCHEMA_NOT_CURRENT");
			const workers = await Promise.all(
				(nativeWorkerBindings[pluginId] ?? []).map(async ([binding, path]) => {
					const service = env[binding];
					if (!service) throw new Error(`WORKER_BINDING_UNAVAILABLE:${binding}`);
					const response = await service.fetch(
						new Request(`https://worker.internal${path}`, { signal: AbortSignal.timeout(5000) }),
					);
					const payload = await readJsonObjectLimited(response, 65536);
					const health = isRecord(payload.data) ? payload.data : payload;
					if (
						!response.ok ||
						!["ok", "ready"].includes(String(health.status)) ||
						(isRecord(health.schema) && health.schema.status !== "current")
					) {
						console.error("[site-plugin-health] resource diagnostic", {
							binding,
							status: health.status,
							reason: health.reason,
							schema: health.schema,
						});
						throw new Error(`WORKER_NOT_READY:${binding}`);
					}
					return { binding, health };
				}),
			);
			evidence = { scope: "api", schema, workers };
		} else {
			let response: Response;
			if (pluginId === "supbrd-plugmod-mcp") {
				if (!env.MCP_DOMAIN) throw new Error("WORKER_BINDING_UNAVAILABLE");
				const url = new URL(
					env.MCP_DOMAIN.includes("://") ? env.MCP_DOMAIN : `https://${env.MCP_DOMAIN}`,
				);
				if (url.username || url.password || !["http:", "https:"].includes(url.protocol))
					throw new Error("WORKER_URL_INVALID");
				url.pathname = "/health";
				url.search = "";
				response = env.MCP_SERVICE
					? await env.MCP_SERVICE.fetch(
							new Request(url, { headers: { Host: url.host }, signal: AbortSignal.timeout(5000) }),
						)
					: await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
			} else {
				const descriptor = bindings[pluginId as keyof typeof bindings];
				if (!descriptor)
					return Response.json({ error: { code: "PLUGIN_NOT_FOUND" } }, { status: 404 });
				const [binding, path] = descriptor;
				const service = env[binding];
				if (!service) throw new Error("WORKER_BINDING_UNAVAILABLE");
				const headers = new Headers();
				if (binding === "OBSERVABILITY" && env.OBSERVABILITY_INTERNAL_TOKEN)
					headers.set("x-observability-token", env.OBSERVABILITY_INTERNAL_TOKEN);
				response = await service.fetch(
					new Request(`https://${binding.toLowerCase().replaceAll("_", "-")}.internal${path}`, {
						headers,
						signal: AbortSignal.timeout(5000),
					}),
				);
			}
			const payload = await readJsonObjectLimited(response, 65536);
			if (!isRecord(payload)) throw new Error("WORKER_NOT_READY");
			const health = isRecord(payload.data) ? payload.data : payload;
			const optionalAnalytics =
				pluginId === "supbrd-plugmod-observability" &&
				env.ENVIRONMENT !== "production" &&
				health.status === "degraded" &&
				health.analyticsQueryConfigured === false;
			if (
				!response.ok ||
				(health.status !== "ok" && health.status !== "ready" && !optionalAnalytics)
			) {
				console.error("[site-plugin-health] resource diagnostic", {
					pluginId,
					status: health.status,
					reason: health.reason,
					schema: health.schema,
				});
				throw new Error("WORKER_NOT_READY");
			}
			if (pluginId === "supbrd-plugmod-billing" && health.credential_copies === null)
				throw new Error("WORKER_DATABASE_NOT_READY");
			if (isRecord(health.schema) && health.schema.status !== "current")
				throw new Error("WORKER_SCHEMA_NOT_CURRENT");
			evidence = payload;
		}
		return Response.json(
			{ plugin_id: pluginId, status: "ready", checked_at: new Date().toISOString(), evidence },
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	} catch (error) {
		console.error("[site-plugin-health] probe failed", { plugin_id: pluginId, error });
		return Response.json(
			{ plugin_id: pluginId, status: "unavailable", error: { code: "PLUGIN_WORKER_NOT_READY" } },
			{ status: 503, headers: { "Cache-Control": "private, no-store" } },
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
