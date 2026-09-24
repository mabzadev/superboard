import { inspectSqlDatabaseAndSchemaHealth } from "@superboard/contracts/health";
import {
	pluginWorkerHealthDefinition,
	type PluginWorkerProbe,
	type WorkerServiceHealth,
} from "@superboard/contracts/plugin-worker-health";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

import type { Env } from "../types.js";

type HealthEnvironment = Pick<
	Env,
	| "DB"
	| "KV"
	| "D1_EXPECTED_MIGRATION"
	| "ENVIRONMENT"
	| "MCP_DOMAIN"
	| "OBSERVABILITY_INTERNAL_TOKEN"
> &
	Partial<{
		[Binding in PluginWorkerProbe["binding"]]: Pick<NonNullable<Env[Binding]>, "fetch">;
	}>;

class ProbeFailure extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

export async function inspectSitePluginWorkerHealth(
	env: HealthEnvironment,
	pluginId: string,
): Promise<Response> {
	const definition = pluginWorkerHealthDefinition(pluginId);
	if (!definition) return Response.json({ error: { code: "PLUGIN_NOT_FOUND" } }, { status: 404 });
	let schema: Awaited<ReturnType<typeof inspectSqlDatabaseAndSchemaHealth>> | undefined;
	let storeFailure: string | null = null;
	if (definition.native) {
		try {
			schema = await inspectSqlDatabaseAndSchemaHealth(env.DB, env.D1_EXPECTED_MIGRATION);
			await env.KV.get("superboard:plugin-readiness");
			if (schema.status !== "current") storeFailure = "DATABASE_SCHEMA_NOT_CURRENT";
		} catch {
			storeFailure = "PLUGIN_STORE_UNAVAILABLE";
		}
	}
	const observations = await Promise.all(
		definition.workers.map(async (probe) => {
			try {
				const health = await inspectWorker(env, pluginId, definition.native, probe);
				return { summary: serviceResult(probe, null), health };
			} catch (error) {
				return {
					summary: serviceResult(
						probe,
						error instanceof ProbeFailure ? error.code : "WORKER_HEALTH_REQUEST_FAILED",
					),
				};
			}
		}),
	);
	const services = observations.map((observation) => observation.summary);
	const reason =
		storeFailure ?? services.find((service) => service.status === "unavailable")?.reason ?? null;
	const evidence = definition.native
		? {
				scope: "api",
				schema,
				workers: observations.flatMap((observation) =>
					observation.health
						? [{ binding: observation.summary.binding, health: observation.health }]
						: [],
				),
			}
		: observations[0]?.health;
	if (reason) console.error("[site-plugin-health] probe failed", { plugin_id: pluginId, reason });
	return Response.json(
		{
			plugin_id: pluginId,
			status: reason ? "unavailable" : "ready",
			checked_at: new Date().toISOString(),
			services,
			...(evidence === undefined ? {} : { evidence }),
			...(reason ? { reason, error: { code: "PLUGIN_WORKER_NOT_READY" } } : {}),
		},
		{ status: reason ? 503 : 200, headers: { "Cache-Control": "private, no-store" } },
	);
}

function serviceResult(probe: PluginWorkerProbe, reason: string | null): WorkerServiceHealth {
	return {
		service: probe.service,
		binding: probe.binding,
		status: reason ? "unavailable" : "ready",
		checked_at: new Date().toISOString(),
		reason,
	};
}

async function inspectWorker(
	env: HealthEnvironment,
	pluginId: string,
	native: boolean,
	probe: PluginWorkerProbe,
): Promise<Record<string, unknown>> {
	let response: Response;
	if (probe.service === "mcp") {
		if (!env.MCP_DOMAIN) throw new ProbeFailure("WORKER_BINDING_UNAVAILABLE");
		const url = new URL(
			env.MCP_DOMAIN.includes("://") ? env.MCP_DOMAIN : `https://${env.MCP_DOMAIN}`,
		);
		if (url.username || url.password || !["http:", "https:"].includes(url.protocol))
			throw new ProbeFailure("WORKER_URL_INVALID");
		url.pathname = "/health";
		url.search = "";
		url.hash = "";
		response = env.MCP_SERVICE
			? await env.MCP_SERVICE.fetch(
					new Request(url, { headers: { Host: url.host }, signal: AbortSignal.timeout(5000) }),
				)
			: await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
	} else {
		const service = env[probe.binding];
		if (!service) throw new ProbeFailure("WORKER_BINDING_UNAVAILABLE");
		const headers = new Headers();
		if (probe.binding === "OBSERVABILITY" && env.OBSERVABILITY_INTERNAL_TOKEN)
			headers.set("x-observability-token", env.OBSERVABILITY_INTERNAL_TOKEN);
		const hostname = native ? "worker" : probe.binding.toLowerCase().replaceAll("_", "-");
		response = await service.fetch(
			new Request(`https://${hostname}.internal${probe.path}`, {
				headers,
				signal: AbortSignal.timeout(5000),
			}),
		);
	}
	const payload = await readJsonObjectLimited(response, 65536);
	const health = isRecord(payload.data) ? payload.data : payload;
	const optionalAnalytics =
		pluginId === "supbrd-plugmod-observability" &&
		env.ENVIRONMENT !== "production" &&
		health.status === "degraded" &&
		health.analyticsQueryConfigured === false;
	if (!response.ok || (health.status !== "ok" && health.status !== "ready" && !optionalAnalytics))
		throw new ProbeFailure("WORKER_NOT_READY");
	if (pluginId === "supbrd-plugmod-billing" && health.credential_copies === null)
		throw new ProbeFailure("WORKER_DATABASE_NOT_READY");
	if (isRecord(health.schema) && health.schema.status !== "current")
		throw new ProbeFailure("WORKER_SCHEMA_NOT_CURRENT");
	return native ? health : payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
