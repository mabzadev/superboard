import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import observabilityWorker from "../../../../../packages/plugins/supbrd-core/observability/src/index.js";
import { dispatchLifecycleApi, pluginTaskContext } from "./lifecycle-health-services.js";

const plugin = "supbrd-plugmod-observability";
const headers = {
	"X-Parity-Operator": "1",
	"X-EmDash-Request": "1",
	Origin: "https://site.example",
	"Content-Type": "application/json",
};
function toggle(action: string) {
	return SELF.fetch(`https://site.example/_emdash/api/superboard/plugins/${plugin}/${action}`, {
		method: "POST",
		headers,
	});
}
function read(source: string, path: string) {
	return SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${plugin}/data-sources/${source}?request=${encodeURIComponent(JSON.stringify({ method: "GET", path }))}`,
		{ headers },
	);
}
function command(id: string, incident: string, body = {}, key = crypto.randomUUID()) {
	return SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${plugin}/commands/${id}`,
		{
			method: "POST",
			headers: { ...headers, "Idempotency-Key": key },
			body: JSON.stringify({
				method: "POST",
				path: `/api/v1/observability/incidents/${incident}/${id === "acknowledge_incident" ? "acknowledge" : "resolve"}`,
				body,
			}),
		},
	);
}
async function ingest(body: unknown, producer = plugin, secret = "runtime-observability-secret") {
	const request = new Request("https://api.internal/internal/observability/observations", {
		method: "POST",
		body: JSON.stringify(body),
	});
	return dispatchLifecycleApi(
		new Request(request, { headers: await signPluginTaskRequest(request, secret) }),
		env as unknown as Record<string, unknown>,
		pluginTaskContext(createExecutionContext(), producer),
	);
}

test("Observability persists observations and incident transitions while the required core rejects disabling", async () => {
	expect((await toggle("enable")).status).toBe(201);
	const event = {
		instance_id: "reference-production",
		observation_id: crypto.randomUUID(),
		service: "isolated-api",
		event_type: "fetch",
		outcome: "exception",
		status: 500,
		exceptions: 1,
		cpu_ms: 2,
		wall_ms: 5,
		observed_at: new Date().toISOString(),
	};
	expect((await ingest(event, "supbrd-plugmod-flows")).status).toBe(403);
	expect((await ingest(event, plugin, "forged-secret")).status).toBe(401);
	expect((await ingest({ ...event, instance_id: "other" })).status).toBe(403);
	const delivered = await ingest(event);
	expect(delivered.status, await delivered.clone().text()).toBe(201);
	expect((await ingest(event)).status).toBe(201);
	const list = await read("incidents", "/api/v1/observability/incidents");
	expect(list.status, await list.clone().text()).toBe(200);
	const result = (await list.json()) as {
		data: { items: Array<{ incident_id: string; status: string; occurrences: number }> };
	};
	expect(result.data.items).toHaveLength(1);
	const incident = result.data.items[0]!;
	expect(incident).toMatchObject({ status: "open", occurrences: 1 });
	const key = crypto.randomUUID();
	const acknowledged = await command("acknowledge_incident", incident.incident_id, {}, key);
	expect(acknowledged.status, await acknowledged.clone().text()).toBe(200);
	expect((await command("acknowledge_incident", incident.incident_id, {}, key)).status).toBe(200);
	const resolved = await command("resolve_incident", incident.incident_id, {
		resolution: "Fixed the failing handler",
	});
	expect(resolved.status, await resolved.clone().text()).toBe(200);
	const metrics = await read("runtime_metrics", "/api/v1/observability/runtime-metrics");
	expect(metrics.status).toBe(200);
	expect(await metrics.json()).toMatchObject({
		data: { rows: [{ service: "isolated-api", invocations: 1, exceptions: 1 }] },
	});
	const health = await read("service_health", "/api/v1/observability/service-health");
	expect(health.status).toBe(200);
	expect(await health.json()).toMatchObject({
		data: { items: [{ service: "isolated-api", status: "unhealthy" }] },
	});
	const disabled = await toggle("disable");
	expect(disabled.status).toBe(409);
	expect(await disabled.json()).toMatchObject({ error: { code: "CORE_COMPONENT_REQUIRED" } });
	expect((await ingest(event)).status).toBe(201);
	expect((await read("incidents", "/api/v1/observability/incidents")).status).toBe(200);
	expect((await toggle("enable")).status).toBe(200);
	const restored = await read("incidents", "/api/v1/observability/incidents");
	expect(await restored.json()).toMatchObject({
		data: {
			items: [{ status: "resolved", occurrences: 1, resolution: "Fixed the failing handler" }],
		},
	});
	const db = (env as unknown as { HEALTH_API_DB: D1Database }).HEALTH_API_DB;
	expect(
		await db.prepare("SELECT COUNT(*) AS count FROM observability_incident_transitions").first(),
	).toEqual({ count: 2 });
});

test("the actual tail handler persists sanitized observations without observing its own ingestion requests", async () => {
	expect((await toggle("enable")).status).toBe(200);
	const context = pluginTaskContext(createExecutionContext(), plugin);
	const bindings = {
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SUPERBOARD_INSTANCE_ID: "reference-production",
		OBSERVABILITY_INTERNAL_TOKEN: "runtime-observability-secret",
		ENVIRONMENT: "local",
		ANALYTICS: { writeDataPoint() {} },
		API_SERVICE: {
			fetch: (request: Request) =>
				dispatchLifecycleApi(request, env as unknown as Record<string, unknown>, context),
		},
	};
	const trace = {
		event: {
			request: {
				method: "GET",
				url: "https://api.example/private?secret=must-not-persist",
				headers: {},
			},
			response: { status: 500 },
		},
		eventTimestamp: Date.now(),
		logs: [],
		exceptions: [{ message: "private exception must not persist", timestamp: Date.now() }],
		diagnosticsChannelEvents: [],
		scriptName: "tail-tested-worker",
		entrypoint: "default",
		outcome: "exception",
		executionModel: "stateless",
		truncated: false,
		cpuTime: 3,
		wallTime: 8,
	};
	await observabilityWorker.tail!(
		[
			trace as TraceItem,
			{
				...trace,
				event: {
					...trace.event,
					request: {
						...trace.event.request,
						url: "https://api.internal/internal/observability/observations",
					},
				},
			} as TraceItem,
		],
		bindings as never,
		context,
	);
	const db = (env as unknown as { HEALTH_API_DB: D1Database }).HEALTH_API_DB;
	const rows = await db
		.prepare("SELECT * FROM observability_observations WHERE service='tail-tested-worker'")
		.all();
	expect(rows.results).toHaveLength(1);
	expect(JSON.stringify(rows.results)).not.toContain("private");
	expect(rows.results[0]).toMatchObject({ exceptions: 1, http_status: 500, cpu_ms: 3 });
});
