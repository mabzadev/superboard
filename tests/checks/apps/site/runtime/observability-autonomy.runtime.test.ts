import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import customWorker from "../../../../../apps/reference/worker/src/index.js";
import { pruneObservabilityObservations } from "../../../../../packages/plugins/superboard-core/api/src/lib/observability-retention.js";
import observabilityWorker from "../../../../../packages/plugins/superboard-core/observability/src/index.js";
import { dispatchLifecycleApi, pluginTaskContext } from "./lifecycle-health-services.js";
import {
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";

const plugin = "superboard-observability";
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
	expect((await ingest(event, "superboard-flows")).status).toBe(403);
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

test("production supervision reads persisted instance metrics without Cloudflare API credentials", async () => {
	await toggle("enable");
	const service = "oauth-installed-instance";
	expect(
		(
			await ingest({
				instance_id: "reference-production",
				observation_id: crypto.randomUUID(),
				service,
				event_type: "fetch",
				outcome: "ok",
				status: 200,
				exceptions: 0,
				truncated: true,
				cpu_ms: 4,
				wall_ms: 12,
				observed_at: new Date().toISOString(),
			})
		).status,
	).toBe(201);
	const context = pluginTaskContext(createExecutionContext(), plugin);
	const bindings = {
		ENVIRONMENT: "production",
		SUPERBOARD_OBSERVABILITY_SOURCE: "emdash",
		SUPERBOARD_INSTANCE_ID: "reference-production",
		OBSERVABILITY_INTERNAL_TOKEN: "runtime-observability-secret",
		API_SERVICE: {
			fetch: (request: Request) =>
				dispatchLifecycleApi(request, env as Record<string, unknown>, context),
		},
	};
	const response = await observabilityWorker.fetch!(
		new Request("https://observability.internal/internal/v1/summary?window=15", {
			headers: { "x-observability-token": "runtime-observability-secret" },
		}),
		bindings as never,
		context,
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		status: "ok",
		source: "emdash",
		windowMinutes: 15,
		rows: expect.arrayContaining([
			{
				service,
				eventType: "fetch",
				outcome: "ok",
				invocations: 1,
				exceptions: 0,
				truncated: 1,
				averageCpuMs: 4,
				averageWallMs: 12,
				maximumCpuMs: 4,
				maximumWallMs: 12,
			},
		]),
	});
});

test("batched observations persist in one request and expired observations are pruned", async () => {
	await toggle("enable");
	const service = `batched-${crypto.randomUUID()}`;
	const observation = (status: number) => ({
		instance_id: "reference-production",
		observation_id: crypto.randomUUID(),
		service,
		event_type: "fetch",
		outcome: status >= 500 ? "exception" : "ok",
		status,
		exceptions: status >= 500 ? 1 : 0,
		cpu_ms: 1,
		wall_ms: 2,
		observed_at: new Date().toISOString(),
	});
	expect(
		(await ingest({ observations: [{ ...observation(200), instance_id: "other" }] })).status,
	).toBe(403);
	const delivered = await ingest({ observations: [observation(200), observation(503)] });
	expect(delivered.status).toBe(201);
	expect(await delivered.json()).toMatchObject({
		data: { observations: [{ incident_id: null }, { incident_id: expect.any(String) }] },
	});
	const db = (env as unknown as { HEALTH_API_DB: D1Database }).HEALTH_API_DB;
	const expired = crypto.randomUUID();
	const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
	await db.batch([
		db
			.prepare(
				"INSERT INTO observability_observations(instance_id,observation_id,service,event_type,outcome,http_status,exceptions,cpu_ms,wall_ms,observed_at) VALUES ('reference-production',?,?,'fetch','ok',200,0,1,1,?)",
			)
			.bind(expired, service, old),
		db
			.prepare(
				"INSERT INTO observability_observation_details(instance_id,observation_id,truncated) VALUES ('reference-production',?,0)",
			)
			.bind(expired),
	]);
	expect(await pruneObservabilityObservations(db)).toBeGreaterThanOrEqual(1);
	expect(
		await db
			.prepare("SELECT COUNT(*) AS count FROM observability_observations WHERE service=?")
			.bind(service)
			.first(),
	).toEqual({ count: 2 });
	expect(
		await db
			.prepare(
				"SELECT COUNT(*) AS count FROM observability_observation_details WHERE observation_id=?",
			)
			.bind(expired)
			.first(),
	).toEqual({ count: 0 });
});

const file = "observability-autonomy.runtime.test.ts";
test("canonical Observability APIs preserve real observations and incident transitions and reject unsupported retries without changing Custom jobs", async () => {
	const scope = await prepareApiPlugin(plugin);
	const db = pluginDatabase("api");
	await db.batch([
		db.prepare("DELETE FROM observability_incident_transitions"),
		db.prepare("DELETE FROM observability_incidents"),
	]);
	const readJson = async <T>(id: string, path: string) =>
		jsonResult<T>(await apiRead(plugin, id, { method: "GET", path }));
	const observation = {
		instance_id: "reference-production",
		observation_id: crypto.randomUUID(),
		service: "proof-api",
		event_type: "fetch",
		outcome: "exception",
		status: 500,
		exceptions: 1,
		cpu_ms: 3,
		wall_ms: 7,
		observed_at: new Date().toISOString(),
	};
	const ingestion = new Request("https://api.internal/internal/observability/observations", {
		method: "POST",
		body: JSON.stringify(observation),
	});
	const ingested = await dispatchLifecycleApi(
		new Request(ingestion, {
			headers: await signPluginTaskRequest(ingestion, "runtime-observability-secret"),
		}),
		{ ...env },
		pluginTaskContext(createExecutionContext(), plugin),
	);
	expect(ingested.status).toBe(201);
	const metrics = await readJson<{ data: { rows: Array<Record<string, unknown>> } }>(
		"runtime_metrics",
		"/api/v1/observability/runtime-metrics",
	);
	expect(metrics.data.rows).toContainEqual(
		expect.objectContaining({
			service: "proof-api",
			invocations: 1,
			exceptions: 1,
			averageCpuMs: 3,
		}),
	);
	proveApi(plugin, "runtime_metrics", "read", file, [observation.observation_id]);
	const health = await readJson<{ data: { items: Array<Record<string, unknown>> } }>(
		"service_health",
		"/api/v1/observability/service-health",
	);
	expect(health.data.items).toContainEqual(
		expect.objectContaining({ service: "proof-api", status: "unhealthy" }),
	);
	proveApi(plugin, "service_health", "read", file, [observation.observation_id]);
	const incidents = await readJson<{
		data: { items: Array<{ incident_id: string; status: string }> };
	}>("incidents", "/api/v1/observability/incidents");
	expect(incidents.data.items).toHaveLength(1);
	const incident = incidents.data.items[0]!;
	expect(incident.status).toBe("open");
	proveApi(plugin, "incidents", "read", file, [incident.incident_id]);
	await jsonResult(
		await apiCommand(plugin, "acknowledge_incident", {
			method: "POST",
			path: `/api/v1/observability/incidents/${incident.incident_id}/acknowledge`,
			body: {},
		}),
	);
	expect(
		await db
			.prepare("SELECT status FROM observability_incidents WHERE incident_id=?")
			.bind(incident.incident_id)
			.first(),
	).toEqual({ status: "acknowledged" });
	proveApi(plugin, "acknowledge_incident", "mutation", file, [incident.incident_id]);
	await jsonResult(
		await apiCommand(plugin, "resolve_incident", {
			method: "POST",
			path: `/api/v1/observability/incidents/${incident.incident_id}/resolve`,
			body: { resolution: "Handler corrected" },
		}),
	);
	expect(
		await db
			.prepare("SELECT status,resolution FROM observability_incidents WHERE incident_id=?")
			.bind(incident.incident_id)
			.first(),
	).toEqual({ status: "resolved", resolution: "Handler corrected" });
	proveApi(plugin, "resolve_incident", "mutation", file, [incident.incident_id]);
	const status = await readJson<{
		metricAvailability: { mode: string; historicalMetrics: string };
		metrics: { instances: number; projects: number };
		deployment: { target: string };
	}>("platform_status", "/api/v1/platform/status");
	expect(status).toMatchObject({
		metricAvailability: { mode: "managed", historicalMetrics: "unavailable" },
		metrics: { instances: 1, projects: 2 },
		deployment: { target: "reference-production" },
	});
	proveApi(plugin, "platform_status", "read", file, [
		scope.production_project_ref,
		scope.test_project_ref,
	]);
	const customDb = pluginDatabase("custom-reference");
	const userId = crypto.randomUUID();
	const create = await customWorker.fetch(
		new Request("https://custom.internal/internal/v1/jobs", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-custom-worker-token": "retirement-custom-secret",
				"x-custom-worker-subject": userId,
				"x-custom-worker-project": scope.production_project_ref,
			},
			body: JSON.stringify({
				idempotencyKey: crypto.randomUUID(),
				projectRef: scope.production_project_ref,
				capability: "reference.echo",
				requestedAt: new Date().toISOString(),
				payload: { message: "observability integration" },
			}),
		}),
		{
			REFERENCE_DB: customDb,
			CUSTOM_WORKER_TOKEN: "retirement-custom-secret",
			ENVIRONMENT: "development",
			REFERENCE_JOB_RETENTION_DAYS: "30",
		} as never,
	);
	const job = await jsonResult<{ id: string; status: string }>(create, 202);
	expect(job.status).toBe("completed");
	const before = await customDb
		.prepare("SELECT * FROM reference_custom_jobs WHERE id=?")
		.bind(job.id)
		.first();
	const listed = await readJson<{ jobs: Array<Record<string, unknown>> }>(
		"platform_custom_jobs",
		"/api/v1/platform/custom/jobs",
	);
	expect(listed.jobs).toContainEqual(expect.objectContaining({ id: job.id, status: "completed" }));
	proveApi(plugin, "platform_custom_jobs", "read", file, [job.id]);
	const retried = await apiCommand(plugin, "retry_custom_job", {
		method: "POST",
		path: `/api/v1/platform/custom/jobs/${job.id}/retry`,
	});
	expect(retried.status).toBe(404);
	const after = await customDb
		.prepare("SELECT * FROM reference_custom_jobs WHERE id=?")
		.bind(job.id)
		.first();
	expect(after).toEqual(before);
});
