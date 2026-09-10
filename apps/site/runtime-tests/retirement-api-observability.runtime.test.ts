import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { createExecutionContext, env } from "cloudflare:test";
import { expect, test } from "vitest";

import customWorker from "../../../workers/custom/reference/src/index.js";
import { dispatchLifecycleApi, pluginTaskContext } from "./lifecycle-health-services.js";
import {
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-observability";
const file = "retirement-api-observability.runtime.test.ts";
test("canonical Observability APIs preserve real observations and incident transitions and reject unsupported retries without changing Custom jobs", async () => {
	const scope = await prepareApiPlugin(plugin);
	const db = pluginDatabase("api");
	const read = async <T>(id: string, path: string) =>
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
	expect(ingested.status, await ingested.clone().text()).toBe(201);
	const metrics = await read<{ data: { rows: Array<Record<string, unknown>> } }>(
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
	const health = await read<{ data: { items: Array<Record<string, unknown>> } }>(
		"service_health",
		"/api/v1/observability/service-health",
	);
	expect(health.data.items).toContainEqual(
		expect.objectContaining({ service: "proof-api", status: "unhealthy" }),
	);
	proveApi(plugin, "service_health", "read", file, [observation.observation_id]);
	const incidents = await read<{ data: { items: Array<{ incident_id: string; status: string }> } }>(
		"incidents",
		"/api/v1/observability/incidents",
	);
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
	const status = await read<{
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
	const listed = await read<{ jobs: Array<Record<string, unknown>> }>(
		"platform_custom_jobs",
		"/api/v1/platform/custom/jobs",
	);
	expect(listed.jobs).toContainEqual(expect.objectContaining({ id: job.id, status: "completed" }));
	proveApi(plugin, "platform_custom_jobs", "read", file, [job.id]);
	const retried = await apiCommand(plugin, "retry_custom_job", {
		method: "POST",
		path: `/api/v1/platform/custom/jobs/${job.id}/retry`,
	});
	expect(retried.status, await retried.clone().text()).toBe(404);
	const after = await customDb
		.prepare("SELECT * FROM reference_custom_jobs WHERE id=?")
		.bind(job.id)
		.first();
	expect(after).toEqual(before);
});
