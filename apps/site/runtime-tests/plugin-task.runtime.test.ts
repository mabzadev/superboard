import {
	sendPluginTaskCommand,
	signPluginTaskRequest,
	withPluginTaskLifecycle,
	type PluginTaskBindings,
	type PluginTaskCommand,
} from "@superboard/contracts/plugin-task";
import {
	createExecutionContext,
	createMessageBatch,
	createScheduledController,
	env,
	getQueueResult,
	SELF,
} from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import analyticsWorker from "../../../workers/analytics/src/index.js";
import { ingestAnalyticsEvents } from "../../../workers/analytics/src/ingestion.js";
import { dispatchLifecycleApi, pluginTaskContext } from "./lifecycle-health-services.js";

const pluginId = "supbrd-plugmod-analytics";
const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};
function toggle(action: string) {
	return SELF.fetch(`https://site.example/_emdash/api/superboard/plugins/${pluginId}/${action}`, {
		method: "POST",
		headers,
	});
}
function moduleEnvironment(id = pluginId): PluginTaskBindings {
	const execution = pluginTaskContext(createExecutionContext(), id);
	return {
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SUPERBOARD_INSTANCE_ID: "reference-production",
		INTERNAL_API_TOKEN: "runtime-module-secret",
		API_SERVICE: {
			fetch: (request) =>
				dispatchLifecycleApi(request, env as unknown as Record<string, unknown>, execution),
		},
	};
}
function command(): PluginTaskCommand {
	return {
		action: "claim",
		instance_id: "reference-production",
		plugin_id: pluginId,
		lease_id: crypto.randomUUID(),
		lease_token: crypto.randomUUID(),
		task_id: `test:${crypto.randomUUID()}`,
		kind: "queue",
		duration_ms: 1000,
	};
}

beforeAll(async () => {
	const enabled = await toggle("enable");
	expect(enabled.status, await enabled.clone().text()).toBe(201);
});

test.each([
	["/operation", { SUPERBOARD_PLUGIN_LIFECYCLE: "required" }, "PLUGIN_TASK_CONFIGURATION_INVALID"],
	["/health", { SUPERBOARD_PLUGIN_LIFECYCLE: "required" }, "PLUGIN_TASK_CONFIGURATION_INVALID"],
	[
		"/internal/v1/health",
		{ SUPERBOARD_INSTANCE_ID: "reference-production" },
		"PLUGIN_TASK_CONFIGURATION_INVALID",
	],
	[
		"/health",
		{ SUPERBOARD_PLUGIN_LIFECYCLE: "required", SUPERBOARD_INSTANCE_ID: "reference-production" },
		"PLUGIN_TASK_AUTHORITY_UNAVAILABLE",
	],
	[
		"/internal/v1/health",
		{
			SUPERBOARD_PLUGIN_LIFECYCLE: "required",
			SUPERBOARD_INSTANCE_ID: "reference-production",
			API_SERVICE: { fetch: async () => Response.json({}) },
		},
		"PLUGIN_TASK_SECRET_REQUIRED",
	],
] as const)("HTTP admission rejects broken configuration at %s", async (path, bindings, code) => {
	let executed = false;
	const worker = withPluginTaskLifecycle(
		pluginId,
		{
			fetch: (_request, _bindings: PluginTaskBindings) => {
				executed = true;
				return Response.json({ ready: true });
			},
		},
		{ fetch: true },
	);
	const response = await worker.fetch!(
		new Request(`https://worker.example${path}`),
		bindings,
		createExecutionContext(),
	);
	expect(response.status).toBe(503);
	expect(await response.json()).toMatchObject({ error: { code } });
	expect(executed).toBe(false);
});

test("health remains available when a correctly configured plugin is inactive", async () => {
	expect((await toggle("disable")).status).toBe(201);
	try {
		const worker = withPluginTaskLifecycle(
			pluginId,
			{
				fetch: (_request, _bindings: PluginTaskBindings) => Response.json({ ready: true }),
			},
			{ fetch: true },
		);
		const response = await worker.fetch!(
			new Request("https://worker.example/health"),
			moduleEnvironment(),
			createExecutionContext(),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ready: true });
	} finally {
		expect((await toggle("enable")).status).toBe(201);
	}
});

test("a task lease survives requests and blocks disable even after its deadline", async () => {
	const bindings = moduleEnvironment();
	const input = command();
	const first = await sendPluginTaskCommand(bindings, input);
	expect(first.state).toBe("running");
	expect(await sendPluginTaskCommand(moduleEnvironment(), input)).toMatchObject({
		lease_id: input.lease_id,
		state: "running",
	});
	await env.DB.prepare(
		"UPDATE superboard_plugin_task_leases SET deadline_at = ? WHERE lease_id = ?",
	)
		.bind(new Date(Date.now() - 1000).toISOString(), input.lease_id)
		.run();
	await expect(sendPluginTaskCommand(bindings, { ...input, action: "check" })).rejects.toThrow(
		"PLUGIN_TASK_DEADLINE_EXCEEDED",
	);
	expect((await toggle("disable")).status).toBe(409);
	await sendPluginTaskCommand(moduleEnvironment(), { ...input, action: "finish" });
	expect((await toggle("disable")).status).toBe(201);
	await expect(sendPluginTaskCommand(bindings, command())).rejects.toThrow("PLUGIN_NOT_ACTIVE");
	expect((await toggle("enable")).status).toBe(201);
});

test("holds admission until all actual waitUntil database work settles", async () => {
	await env.DB.exec(
		"CREATE TABLE task_wait_until_test (id INTEGER PRIMARY KEY, completed INTEGER NOT NULL);",
	);
	let release!: () => void;
	const paused = new Promise<void>((resolve) => {
		release = resolve;
	});
	let started!: () => void;
	const admitted = new Promise<void>((resolve) => {
		started = resolve;
	});
	const worker = withPluginTaskLifecycle(pluginId, {
		scheduled: (_controller, _bindings: PluginTaskBindings, context) => {
			context.waitUntil(
				(async () => {
					started();
					await paused;
					await env.DB.prepare(
						"INSERT INTO task_wait_until_test (id, completed) VALUES (1, 1)",
					).run();
				})(),
			);
		},
	});
	const running = worker.scheduled!(
		createScheduledController(),
		moduleEnvironment(),
		createExecutionContext(),
	);
	await admitted;
	expect((await toggle("disable")).status).toBe(409);
	expect(await env.DB.prepare("SELECT * FROM task_wait_until_test").first()).toBeNull();
	release();
	await running;
	expect(await env.DB.prepare("SELECT completed FROM task_wait_until_test").first()).toEqual({
		completed: 1,
	});
	expect((await toggle("disable")).status).toBe(201);
	await worker.scheduled!(
		createScheduledController(),
		moduleEnvironment(),
		createExecutionContext(),
	);
	expect(
		await env.DB.prepare("SELECT COUNT(*) AS count FROM task_wait_until_test").first(),
	).toEqual({ count: 1 });
	expect((await toggle("enable")).status).toBe(201);
});

test("the real Analytics queue defers while disabled and projects the same event after reactivation", async () => {
	const databases = env as unknown as { HEALTH_ANALYTICS_DB: D1Database };
	const bindings = {
		...moduleEnvironment(),
		DB: databases.HEALTH_ANALYTICS_DB,
		EVENT_ARCHIVE: env.MEDIA,
		ANALYTICS_ID_HASH_KEY: "runtime-analytics-task-key",
		ANALYTICS_CONFIG_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		DLQ_NAME: "analytics-task-dlq",
		ENVIRONMENT: "local",
	};
	const event = {
		schema_version: 1 as const,
		event_id: `task-${crypto.randomUUID()}`,
		event_name: "superboard.analytics.installation.created.v1",
		occurred_at: new Date().toISOString(),
		source: "system" as const,
		application_id: "task-app",
		app_instance_id: "task-installation",
		session_id: "task-session",
		properties: {},
	};
	await ingestAnalyticsEvents(
		bindings as never,
		{
			projectId: 49,
			projectRef: "49-test",
			instanceId: 49,
			environment: "test",
			actorId: 0,
			role: "system",
			requestId: crypto.randomUUID(),
		},
		[event],
	);
	expect((await toggle("disable")).status).toBe(201);
	const body = {
		schema_version: 1,
		type: "analytics.event.project",
		project_id: "49",
		event_id: event.event_id,
	};
	const batch = createMessageBatch("analytics-task-ingest", [
		{ id: "deferred-event", timestamp: new Date(), attempts: 1, body },
	]);
	const execution = createExecutionContext();
	await analyticsWorker.queue!(batch, bindings as never, execution);
	expect((await getQueueResult(batch, execution)).explicitAcks).toEqual([]);
	expect(
		await bindings.DB.prepare("SELECT status FROM analytics_event_receipts WHERE event_id = ?")
			.bind(event.event_id)
			.first(),
	).toEqual({ status: "queued" });
	expect((await toggle("enable")).status).toBe(201);
	const replay = createMessageBatch("analytics-task-ingest", [
		{ id: "deferred-event", timestamp: new Date(), attempts: 2, body },
	]);
	const replayContext = createExecutionContext();
	await analyticsWorker.queue!(replay, bindings as never, replayContext);
	expect((await getQueueResult(replay, replayContext)).explicitAcks).toEqual(["deferred-event"]);
	expect(
		await bindings.DB.prepare("SELECT status FROM analytics_event_receipts WHERE event_id = ?")
			.bind(event.event_id)
			.first(),
	).toEqual({ status: "projected" });
});

test("the broker rejects cross-plugin and cross-instance task claims", async () => {
	await expect(
		sendPluginTaskCommand(moduleEnvironment("supbrd-plugmod-paywalls"), command()),
	).rejects.toThrow("PLUGIN_TASK_SCOPE_FORBIDDEN");
	await expect(
		sendPluginTaskCommand(moduleEnvironment(), { ...command(), instance_id: "other-instance" }),
	).rejects.toThrow("PLUGIN_TASK_INSTANCE_FORBIDDEN");
	const request = new Request("https://site.example/superboard-system/plugin-task-authority", {
		method: "POST",
		body: JSON.stringify(command()),
	});
	const forged = await SELF.fetch(
		new Request(request, { headers: await signPluginTaskRequest(request, "incorrect-secret") }),
	);
	expect(forged.status).toBe(401);
});
