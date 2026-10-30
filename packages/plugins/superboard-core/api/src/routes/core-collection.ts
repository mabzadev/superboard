import { registerRouter } from "@superboard/contracts/route-registry";
import {
	AnalyticsContractError,
	parseAnalyticsEventsV1,
	type AnalyticsEventV1,
} from "@superboard/contracts/analytics";
import {
	PluginTaskUnavailable,
	runPluginTask,
	verifyPluginTaskRequest,
} from "@superboard/contracts/plugin-task";
import { readJsonLimited, RequestBodyError } from "@superboard/contracts/request-body";
import { configuredSecrets } from "@superboard/contracts/secret";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { CollectionError, collectEvents, readCollectedEvents } from "../lib/core-collection.js";
import type { Env } from "../types.js";

const customerEvent = z.object({
	id: z.string().trim().min(1).max(128),
	type: z.enum([
		"view",
		"open",
		"install",
		"reinstall",
		"reactivation",
		"app_open",
		"user_referred",
		"time_spent",
		"purchase",
		"refund",
	]),
	occurred_at: z
		.string()
		.datetime({ offset: true })
		.transform((value) => new Date(value).toISOString()),
	customer_id: z.string().trim().min(1).max(128).optional(),
	referrer_customer_id: z.string().trim().min(1).max(128).optional(),
	platform: z.enum(["ios", "android", "web"]).optional(),
	revenue_cents: z.number().int().nonnegative().optional(),
	engagement_time: z.number().int().nonnegative().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function collectSdkTelemetry(
	c: Context<{ Bindings: Env }>,
	projectId: number,
	format: "analytics" | "customer" = "analytics",
): Promise<Response> {
	try {
		const input = await readJsonLimited(c.req.raw, 1024 * 1024);
		let events: AnalyticsEventV1[];
		if (format === "customer") {
			const parsed = z.object({ events: z.array(customerEvent).min(1).max(100) }).parse(input);
			events = parsed.events.map((event) => ({
				schema_version: 1,
				event_id: event.id,
				event_name: `customer.${event.type}`,
				source: "sdk",
				application_id: c.req.header("IDENTIFIER") ?? "application",
				occurred_at: event.occurred_at,
				...(event.customer_id ? { user_id: event.customer_id } : {}),
				context: { platform: event.platform ?? c.req.header("PLATFORM") ?? "unknown" },
				properties: { customer_event: event },
			}));
		} else {
			events = parseAnalyticsEventsV1(input).map((event) => ({ ...event, source: "sdk" }));
		}
		events = parseAnalyticsEventsV1({ events });
		const results = await collectEvents(c.env.DB, projectId, events, format);
		return c.json(
			{
				data: {
					accepted: results.filter((result) => result.status === "accepted").length,
					duplicates: results.filter((result) => result.status === "duplicate").length,
					rejected: 0,
					results,
				},
			},
			202,
			{ "Cache-Control": "no-store" },
		);
	} catch (error) {
		if (error instanceof CollectionError)
			return c.json({ error: { code: error.code, message: error.message } }, error.status);
		if (error instanceof AnalyticsContractError || error instanceof z.ZodError)
			return c.json(
				{ error: { code: "collection_event_invalid", message: "Invalid collection event" } },
				422,
			);
		if (error instanceof RequestBodyError)
			return c.json({ error: { code: error.code, message: error.message } }, error.status);
		if (
			error instanceof Error &&
			/NOT NULL constraint failed: core_collected_events.payload_json/u.test(error.message)
		)
			return c.json(
				{
					error: {
						code: "collection_event_id_conflict",
						message: "Event identifier already has a different payload",
					},
				},
				409,
			);
		throw error;
	}
}

const collection = registerRouter(new Hono<{ Bindings: Env }>(), {"service":"api","module":"routes.core-collection.collection","pluginId":"supbrd-core","surface":"internal","access":"internal"});

collection.use("/:plugin/*", async (c, next) => {
	const plugin = c.req.param("plugin");
	if (
		!/^(?:supbrd-(?:core|(?:plug|plugmod)-[a-z0-9]+(?:-[a-z0-9]+)*)|superboard-[a-z0-9]+(?:-[a-z0-9]+)*)$/u.test(
			plugin,
		)
	)
		return c.json({ error: { code: "COLLECTION_CONSUMER_INVALID" } }, 403);
	let verified = false;
	for (const secret of configuredSecrets(
		c.env.MODULE_INTERNAL_TOKEN,
		c.env.MODULE_INTERNAL_TOKEN_PREVIOUS,
		c.env.INTERNAL_API_TOKEN,
	)) {
		if (await verifyPluginTaskRequest(c.req.raw, secret)) {
			verified = true;
			break;
		}
	}
	if (!verified) return c.json({ error: { code: "COLLECTION_AUTHENTICATION_REQUIRED" } }, 401);
	if (c.env.SUPERBOARD_PLUGIN_LIFECYCLE === "required") {
		const props: unknown = c.executionCtx.props;
		if (
			!props ||
			typeof props !== "object" ||
			!("superboard_plugin_id" in props) ||
			props.superboard_plugin_id !== plugin
		)
			return c.json({ error: { code: "COLLECTION_CONSUMER_FORBIDDEN" } }, 403);
	}
	if (plugin === "supbrd-core") {
		await next();
		return;
	}
	const result = await runPluginTask(
		c.env,
		plugin,
		{ kind: "runtime", task_id: `collection:${crypto.randomUUID()}` },
		async () => {
			await next();
			return c.res;
		},
	);
	return result.ran ? result.value : c.json({ error: { code: "PLUGIN_NOT_ACTIVE" } }, 404);
});

collection.get("/:plugin/projects", async (c) => {
	const after = integer(c.req.query("after") ?? "0");
	const rows = await c.env.DB.prepare(
		`SELECT id,instance_id,is_test FROM projects WHERE id>? AND EXISTS (SELECT 1 FROM core_collected_events e WHERE e.project_id=CAST(projects.id AS TEXT)) ORDER BY id LIMIT 101`,
	)
		.bind(after)
		.all<{ id: number; instance_id: number; is_test: number }>();
	const items = rows.results.slice(0, 100).map((row) => ({
		projectId: row.id,
		instanceId: row.instance_id,
		projectRef: `${row.instance_id}-${row.is_test === 1 ? "test" : "prod"}`,
		environment: row.is_test === 1 ? "test" : "production",
	}));
	return c.json(
		{
			data: {
				items,
				nextCursor: items.at(-1)?.projectId ?? after,
				hasMore: rows.results.length > 100,
			},
		},
		200,
		{ "Cache-Control": "no-store" },
	);
});

collection.get("/:plugin/events", async (c) => {
	const projectId = integer(c.req.query("project_id") ?? "", 1);
	const after = integer(c.req.query("after") ?? "0");
	const limit = integer(c.req.query("limit") ?? "100", 1);
	const eventNames = c.req.queries("event_name") ?? [];
	if (eventNames.length > 20 || eventNames.some((name) => !name || name.length > 128))
		return c.json({ error: { code: "COLLECTION_FILTER_INVALID" } }, 422);
	return c.json(
		{ data: await readCollectedEvents(c.env.DB, { projectId, after, limit, eventNames }) },
		200,
		{ "Cache-Control": "no-store" },
	);
});

collection.onError((error, c) => {
	if (error instanceof z.ZodError || error instanceof AnalyticsContractError)
		return c.json({ error: { code: "COLLECTION_REQUEST_INVALID" } }, 422);
	if (error instanceof RequestBodyError)
		return c.json({ error: { code: error.code } }, error.status);
	if (error instanceof PluginTaskUnavailable)
		return Response.json({ error: { code: error.code } }, { status: error.status });
	if (error instanceof Error && error.message === "COLLECTION_CURSOR_INVALID")
		return c.json({ error: { code: error.message } }, 422);
	console.error("[core-collection] read failed", error);
	return c.json({ error: { code: "COLLECTION_UNAVAILABLE" } }, 503);
});

function integer(value: string, minimum = 0): number {
	const parsed = Number(value);
	if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed) || parsed < minimum)
		throw new Error("COLLECTION_CURSOR_INVALID");
	return parsed;
}

export default collection;
