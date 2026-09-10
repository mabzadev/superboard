import {
	runPluginTask,
	PluginTaskUnavailable,
	verifyPluginTaskRequest,
} from "@superboard/contracts/plugin-task";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import type { Context } from "hono";
import { z } from "zod";

import { getRequestAuthContext } from "../lib/auth.js";
import type { Env } from "../types.js";

const pluginId = "supbrd-plugmod-observability";
const observation = z.object({
	instance_id: z.string().min(1).max(128),
	observation_id: z.string().uuid(),
	service: z.string().min(1).max(96),
	event_type: z.string().min(1).max(32),
	outcome: z.string().min(1).max(64),
	status: z.number().int().min(0).max(599),
	exceptions: z.number().int().nonnegative().max(100000),
	cpu_ms: z.number().finite().nonnegative(),
	wall_ms: z.number().finite().nonnegative(),
	observed_at: z.string().datetime(),
});
type Incident = {
	incident_id: string;
	status: string;
	last_observed_at: string;
	occurrences: number;
	resolution: string | null;
};

export async function receiveObservabilityObservation(
	c: Context<{ Bindings: Env }>,
): Promise<Response> {
	try {
		const props: unknown = c.executionCtx.props;
		if (
			!props ||
			typeof props !== "object" ||
			!("superboard_plugin_id" in props) ||
			props.superboard_plugin_id !== pluginId
		)
			return fail(403, "OBSERVABILITY_PRODUCER_FORBIDDEN");
		if (!(await verifyPluginTaskRequest(c.req.raw, c.env.OBSERVABILITY_INTERNAL_TOKEN ?? "")))
			return fail(401, "OBSERVABILITY_SIGNATURE_INVALID");
		const value = observation.parse(await readJsonObjectLimited(c.req.raw, 16384));
		if (value.instance_id !== c.env.SUPERBOARD_INSTANCE_ID)
			return fail(403, "OBSERVABILITY_INSTANCE_FORBIDDEN");
		if (Math.abs(Date.now() - Date.parse(value.observed_at)) > 86400000)
			return fail(422, "OBSERVABILITY_TIMESTAMP_INVALID");
		const admitted = await runPluginTask(
			c.env,
			pluginId,
			{ kind: "runtime", task_id: `observation:${value.observation_id}`, duration_ms: 30000 },
			async () => {
				const failed =
					value.exceptions > 0 ||
					value.status >= 500 ||
					!["ok", "canceled"].includes(value.outcome);
				const incidentId = failed
					? await hash(
							JSON.stringify([value.service, value.event_type, value.outcome, value.status]),
						)
					: null;
				const statements: D1PreparedStatement[] = [];
				if (incidentId)
					statements.push(
						c.env.DB.prepare(`INSERT INTO observability_incidents(instance_id,incident_id,service,event_type,outcome,http_status,status,occurrences,first_observed_at,last_observed_at)
				SELECT ?,?,?,?,?,?,'open',1,?,? WHERE NOT EXISTS (SELECT 1 FROM observability_observations WHERE instance_id=? AND observation_id=?)
				ON CONFLICT(instance_id,incident_id) DO UPDATE SET occurrences=observability_incidents.occurrences+1,
				first_observed_at=MIN(observability_incidents.first_observed_at,excluded.first_observed_at),last_observed_at=MAX(observability_incidents.last_observed_at,excluded.last_observed_at),
				status=CASE WHEN observability_incidents.status='resolved' AND excluded.last_observed_at>observability_incidents.resolved_at THEN 'open' ELSE observability_incidents.status END`).bind(
							value.instance_id,
							incidentId,
							value.service,
							value.event_type,
							value.outcome,
							value.status,
							value.observed_at,
							value.observed_at,
							value.instance_id,
							value.observation_id,
						),
					);
				statements.push(
					c.env.DB.prepare(
						"INSERT OR IGNORE INTO observability_observations(instance_id,observation_id,service,event_type,outcome,http_status,exceptions,cpu_ms,wall_ms,observed_at,incident_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
					).bind(
						value.instance_id,
						value.observation_id,
						value.service,
						value.event_type,
						value.outcome,
						value.status,
						value.exceptions,
						value.cpu_ms,
						value.wall_ms,
						value.observed_at,
						incidentId,
					),
				);
				await c.env.DB.batch(statements);
				return json({ observation_id: value.observation_id, incident_id: incidentId }, 201);
			},
		);
		return admitted.ran ? admitted.value : fail(404, "PLUGIN_NOT_ACTIVE");
	} catch (error) {
		return failure(error);
	}
}

export async function observabilityAdmin(c: Context<{ Bindings: Env }>): Promise<Response> {
	try {
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator) return fail(401, "OPERATOR_REQUIRED");
		const instance = auth.siteOperator.instance_id;
		const actor = auth.siteOperator.operator_id;
		const url = new URL(c.req.url);
		const path = url.pathname.slice("/api/v1/observability".length);
		const key = c.req.header("Idempotency-Key") ?? "";
		if (c.req.method !== "GET" && (key.length < 8 || key.length > 200))
			return fail(400, "IDEMPOTENCY_KEY_REQUIRED");
		const admitted = await runPluginTask(
			c.env,
			pluginId,
			{
				kind: "runtime",
				task_id: `observability:${key || crypto.randomUUID()}`,
				duration_ms: 30000,
			},
			async () => {
				if (path === "/runtime-metrics" && c.req.method === "GET") {
					const minutes = z.coerce
						.number()
						.int()
						.min(1)
						.max(1440)
						.parse(url.searchParams.get("window") ?? 60);
					const rows = await c.env.DB.prepare(
						"SELECT service,outcome,event_type AS eventType,COUNT(*) AS invocations,SUM(exceptions) AS exceptions,AVG(cpu_ms) AS averageCpuMs,AVG(wall_ms) AS averageWallMs,MAX(cpu_ms) AS maximumCpuMs,MAX(wall_ms) AS maximumWallMs FROM observability_observations WHERE instance_id=? AND observed_at>=? GROUP BY service,outcome,event_type ORDER BY service,outcome,event_type LIMIT 1000",
					)
						.bind(instance, new Date(Date.now() - minutes * 60000).toISOString())
						.all();
					return json({
						status: rows.results.length ? "ok" : "no_observations",
						source: "worker_tail",
						windowMinutes: minutes,
						generatedAt: new Date().toISOString(),
						rows: rows.results,
					});
				}
				if (path === "/service-health" && c.req.method === "GET") {
					const rows = await c.env.DB.prepare(
						"SELECT service,outcome,http_status,exceptions,observed_at FROM (SELECT service,outcome,http_status,exceptions,observed_at,ROW_NUMBER() OVER (PARTITION BY service ORDER BY observed_at DESC,observation_id DESC) AS position FROM observability_observations WHERE instance_id=?) WHERE position=1 ORDER BY service LIMIT 1000",
					)
						.bind(instance)
						.all<{
							service: string;
							outcome: string;
							http_status: number;
							exceptions: number;
							observed_at: string;
						}>();
					return json({
						source: "last_observed_invocation",
						stale_after_seconds: 300,
						items: rows.results.map((row) => ({
							...row,
							status:
								Date.now() - Date.parse(row.observed_at) > 300000
									? "unknown"
									: row.exceptions > 0 ||
										  row.http_status >= 500 ||
										  !["ok", "canceled"].includes(row.outcome)
										? "unhealthy"
										: "healthy",
						})),
					});
				}
				if (path === "/incidents" && c.req.method === "GET") {
					const status = z
						.enum(["open", "acknowledged", "resolved", "all"])
						.parse(url.searchParams.get("status") ?? "all");
					const cursor = url.searchParams.get("cursor") ?? "";
					const rows = await c.env.DB.prepare(
						"SELECT * FROM observability_incidents WHERE instance_id=? AND (?='all' OR status=?) AND incident_id>? ORDER BY incident_id LIMIT 51",
					)
						.bind(instance, status, status, cursor)
						.all<Incident>();
					return json({
						items: rows.results.slice(0, 50),
						...(rows.results.length > 50 ? { nextCursor: rows.results[49]!.incident_id } : {}),
					});
				}
				const match = /^\/incidents\/([a-f0-9]{64})\/(acknowledge|resolve)$/u.exec(path);
				if (match && c.req.method === "POST") {
					const incident = match[1]!;
					const action = match[2]!;
					const input = z
						.object({ resolution: z.string().trim().min(1).max(2000).optional() })
						.parse(await readJsonObjectLimited(c.req.raw, 16384));
					if (action === "resolve" && !input.resolution)
						return fail(422, "INCIDENT_RESOLUTION_REQUIRED");
					const resolution = action === "resolve" ? input.resolution! : null;
					const prior = await c.env.DB.prepare(
						"SELECT * FROM observability_incident_transitions WHERE instance_id=? AND operation_id=?",
					)
						.bind(instance, key)
						.first<{ incident_id: string; action: string; resolution: string | null }>();
					if (prior)
						return prior.incident_id === incident &&
							prior.action === action &&
							prior.resolution === resolution
							? json(prior)
							: fail(409, "IDEMPOTENCY_CONFLICT");
					const now = new Date().toISOString();
					const mutation =
						action === "acknowledge"
							? c.env.DB.prepare(
									"UPDATE observability_incidents SET status='acknowledged',acknowledged_by=?,acknowledged_at=? WHERE instance_id=? AND incident_id=? AND status='open' AND NOT EXISTS (SELECT 1 FROM observability_incident_transitions WHERE instance_id=? AND operation_id=?)",
								).bind(actor, now, instance, incident, instance, key)
							: c.env.DB.prepare(
									"UPDATE observability_incidents SET status='resolved',resolved_by=?,resolved_at=?,resolution=? WHERE instance_id=? AND incident_id=? AND status IN ('open','acknowledged') AND NOT EXISTS (SELECT 1 FROM observability_incident_transitions WHERE instance_id=? AND operation_id=?)",
								).bind(actor, now, resolution, instance, incident, instance, key);
					await c.env.DB.batch([
						mutation,
						c.env.DB.prepare(
							"INSERT INTO observability_incident_transitions(instance_id,operation_id,incident_id,action,operator_id,resolution,changed_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
						).bind(instance, key, incident, action, actor, resolution, now),
					]);
					const transition = await c.env.DB.prepare(
						"SELECT * FROM observability_incident_transitions WHERE instance_id=? AND operation_id=?",
					)
						.bind(instance, key)
						.first();
					if (transition) return json(transition);
					const current = await c.env.DB.prepare(
						"SELECT status FROM observability_incidents WHERE instance_id=? AND incident_id=?",
					)
						.bind(instance, incident)
						.first();
					return fail(
						current ? 409 : 404,
						current ? "INCIDENT_TRANSITION_CONFLICT" : "INCIDENT_NOT_FOUND",
					);
				}
				return fail(404, "NOT_FOUND");
			},
		);
		return admitted.ran ? admitted.value : fail(404, "PLUGIN_NOT_ACTIVE");
	} catch (error) {
		return failure(error);
	}
}
function json(data: unknown, status = 200) {
	return Response.json({ data }, { status, headers: { "Cache-Control": "private, no-store" } });
}
function fail(status: number, code: string) {
	return Response.json({ error: { code, message: code } }, { status });
}
function failure(error: unknown) {
	if (error instanceof z.ZodError) return fail(422, "OBSERVABILITY_INPUT_INVALID");
	if (error instanceof RequestBodyError) return fail(error.status, "OBSERVABILITY_INPUT_INVALID");
	if (error instanceof PluginTaskUnavailable) return fail(error.status, error.code);
	console.error("[observability] request failed", error);
	return fail(503, "OBSERVABILITY_UNAVAILABLE");
}
async function hash(value: string) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
