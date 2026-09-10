import type { AnalyticsEventV1 } from "@superboard/contracts/analytics";
import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { createExecutionContext, createMessageBatch, env, getQueueResult } from "cloudflare:test";
import { expect } from "vitest";

import analyticsWorker from "../../../../../packages/plugins/supbrd-plug-analytics/worker/src/index.js";
import type { Env } from "../../../../../packages/plugins/supbrd-plug-analytics/worker/src/types.js";
import { dispatchLifecycleApi, pluginTaskContext } from "./lifecycle-health-services.js";
import { jsonResult, pluginDatabase } from "./retirement-api-helpers.js";

export async function analyticsFacts(projectRef: string) {
	const api = pluginDatabase("api");
	const project = await api
		.prepare(
			"SELECT p.id,p.instance_id FROM projects p JOIN instances i ON i.id=p.instance_id WHERE i.uri_scheme=? AND p.is_test=0",
		)
		.bind(env.SUPERBOARD_INSTANCE_ID)
		.first<{ id: number; instance_id: number }>();
	expect(project).toBeTruthy();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Workers pool supplies generated bindings; the real Analytics Worker receives its isolated D1 and task broker
	const runtime = {
		...env,
		DB: pluginDatabase("analytics"),
		INTERNAL_API_TOKEN: "runtime-module-secret",
		MODULE_INTERNAL_TOKEN: "runtime-module-secret",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SITE_SERVICE: undefined,
		SITE_OPERATOR_BRIDGE_TOKEN: undefined,
		QUEUE_NAME: "retirement-analytics-ingest",
		DLQ_NAME: "retirement-analytics-ingest-dlq",
		API_SERVICE: {
			fetch: (request: Request) =>
				dispatchLifecycleApi(
					request,
					{ ...env },
					pluginTaskContext(createExecutionContext(), "supbrd-plugmod-analytics"),
				),
		},
	} as unknown as Env;
	const application = `proof-${crypto.randomUUID()}`;
	const now = new Date().toISOString();
	const common = {
		schema_version: 1 as const,
		occurred_at: now,
		application_id: application,
		app_instance_id: "proof-installation",
		session_id: "proof-session",
		user_id: "proof-customer",
		context: { platform: "ios", app_version: "1.0.0", country_code: "CH" },
	};
	const events: AnalyticsEventV1[] = [
		{
			...common,
			event_id: crypto.randomUUID(),
			event_name: "screen.viewed",
			source: "sdk",
			properties: { view_name: "Checkout", duration_seconds: 12 },
		},
		{
			...common,
			event_id: crypto.randomUUID(),
			event_name: "crash.reported",
			source: "sdk",
			properties: { message: "Proof crash", stack: "checkout:42", fatal: true },
		},
		{
			...common,
			event_id: crypto.randomUUID(),
			event_name: "feedback.submitted",
			source: "sdk",
			properties: { rating: 4, comment: "Proof feedback" },
		},
		{
			...common,
			event_id: crypto.randomUUID(),
			event_name: "superboard.analytics.installation.created.v1",
			source: "system",
			properties: { attribution_id: "proof-attribution" },
		},
		{
			...common,
			event_id: crypto.randomUUID(),
			event_name: "superboard.analytics.purchase.verified.v1",
			source: "billing",
			properties: {
				store: "apple",
				environment: "sandbox",
				event_type: "initial_purchase",
				store_transaction_id: `transaction-${crypto.randomUUID()}`,
				product_id: "proof-product",
				amount_micros: 5000000,
				currency: "CHF",
			},
		},
	];
	const url = "https://analytics.internal/internal/v1/events";
	const headers = await createProjectContextHeaders(
		{
			module: "analytics",
			method: "POST",
			pathname: "/internal/v1/events",
			projectId: project!.id,
			instanceId: project!.instance_id,
			projectRef,
			environment: "production",
			actorId: 0,
			role: "system",
			requestId: crypto.randomUUID(),
			issuedAt: Math.floor(Date.now() / 1000),
		},
		"runtime-module-secret",
	);
	headers.set("Content-Type", "application/json");
	headers.set("Idempotency-Key", crypto.randomUUID());
	const accepted = await analyticsWorker.fetch!(
		new Request(url, { method: "POST", headers, body: JSON.stringify({ events }) }),
		runtime,
		createExecutionContext(),
	);
	expect(await jsonResult(accepted, 202)).toMatchObject({
		data: { accepted: events.length, rejected: 0 },
	});
	const context = createExecutionContext();
	const batch = createMessageBatch(
		"retirement-analytics-ingest",
		events.map((event) => ({
			id: crypto.randomUUID(),
			timestamp: new Date(),
			attempts: 1,
			body: {
				schema_version: 1,
				type: "analytics.event.project",
				project_id: String(project!.id),
				event_id: event.event_id,
			},
		})),
	);
	await analyticsWorker.queue!(batch, runtime, context);
	expect((await getQueueResult(batch, context)).explicitAcks).toHaveLength(events.length);
	const stored = await pluginDatabase("analytics")
		.prepare(
			"SELECT event_id,status FROM analytics_event_receipts WHERE project_id=? AND application_id=?",
		)
		.bind(String(project!.id), application)
		.all<{ event_id: string; status: string }>();
	expect(stored.results).toHaveLength(events.length);
	expect(stored.results.every((row) => row.status === "projected")).toBe(true);
	return { events, application, projectId: String(project!.id) };
}
