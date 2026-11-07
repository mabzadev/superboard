import type { Caller } from "../platform/caller.js";
import type { DataEnv, Deferral } from "../platform/env.js";
import { DataError } from "../platform/http.js";
import { allows } from "../platform/policy.js";
import { publicOrigin } from "../platform/signing.js";
import { nextRun } from "./cron.js";
import { activeSource, requireFunction } from "./registry.js";
import { decryptSecrets } from "./secrets.js";

export type Trigger = "http" | "schedule" | "test";

const COMPATIBILITY_DATE = "2026-08-08";
const LOG_HEADER = "x-superboard-logs";
const ERROR_HEADER = "x-superboard-function-error";
const RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SHIM = String.raw`
import { AsyncLocalStorage } from "node:async_hooks";
import * as module from "user.js";

const handler = module.default ?? module;
const storage = new AsyncLocalStorage();
const MAX_ENTRIES = 100;
const MAX_LOG_BYTES = 6000;

for (const level of ["log", "info", "warn", "error", "debug"]) {
	const original = console[level].bind(console);
	console[level] = (...values) => {
		const logs = storage.getStore();
		if (logs && logs.length < MAX_ENTRIES) {
			const message = values
				.map((value) => {
					if (typeof value === "string") return value;
					try { return JSON.stringify(value); } catch { return String(value); }
				})
				.join(" ")
				.slice(0, 2000);
			logs.push({ level, message, at: new Date().toISOString() });
		}
		original(...values);
	};
}

function encodeLogs(logs) {
	let entries = logs;
	let json = JSON.stringify(entries);
	while (json.length > MAX_LOG_BYTES && entries.length > 0) {
		entries = entries.slice(1);
		json = JSON.stringify(entries);
	}
	const bytes = new TextEncoder().encode(json);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function finish(response, logs, failed) {
	const headers = new Headers(response.headers);
	headers.set("${LOG_HEADER}", encodeLogs(logs));
	if (failed) headers.set("${ERROR_HEADER}", "1");
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
	async fetch(request, env, ctx) {
		const logs = [];
		return storage.run(logs, async () => {
			try {
				if (request.headers.get("x-superboard-trigger") === "schedule") {
					if (typeof handler.scheduled !== "function")
						return finish(new Response("This function does not export scheduled()", { status: 501 }), logs, true);
					await handler.scheduled(
						{ cron: request.headers.get("x-superboard-cron") ?? "", scheduledTime: Date.now() },
						env,
						ctx,
					);
					return finish(new Response(null, { status: 204 }), logs, false);
				}
				if (typeof handler.fetch !== "function")
					return finish(new Response("This function does not export fetch()", { status: 501 }), logs, true);
				const response = await handler.fetch(request, env, ctx);
				if (!(response instanceof Response))
					return finish(new Response("fetch() must return a Response", { status: 500 }), logs, true);
				return finish(response, logs, false);
			} catch (error) {
				logs.push({ level: "error", message: String(error && error.stack ? error.stack : error).slice(0, 4000), at: new Date().toISOString() });
				return finish(new Response("Function failed", { status: 500 }), logs, true);
			}
		});
	},
};
`;

export interface InvocationResult {
	response: Response;
	runId: string;
	logs: unknown[];
	durationMs: number;
}

export async function invokeFunction(
	env: DataEnv,
	deferral: Deferral,
	options: {
		projectId: number;
		name: string;
		caller: Caller | null;
		trigger: Trigger;
		request: Request;
		path: string;
		cron?: string;
	},
): Promise<InvocationResult> {
	const definition = await requireFunction(env, options.projectId, options.name);
	if (options.caller && options.trigger === "http" && !allows(definition.access, options.caller)) {
		if (options.caller.role === "anon")
			throw new DataError(401, "authentication_required", "Sign in to call this function");
		throw new DataError(403, "access_denied", "This key cannot call this function");
	}
	if (!env.LOADER)
		throw new DataError(
			503,
			"functions_unavailable",
			"Functions are not configured for this environment",
		);
	const active = await activeSource(
		env,
		options.projectId,
		options.name,
		definition.active_version,
	);
	if (!active)
		throw new DataError(409, "function_not_deployed", "This function has no deployed version");
	const worker = env.LOADER.get(
		`${options.projectId}:${options.name}:${definition.active_version}:${active.source_hash.slice(0, 16)}:${definition.updated_at}`,
		async () => ({
			compatibilityDate: COMPATIBILITY_DATE,
			compatibilityFlags: ["nodejs_compat"],
			mainModule: "superboard-shim.js",
			modules: { "superboard-shim.js": SHIM, "user.js": active.source },
			env: {
				...definition.vars,
				...(await decryptSecrets(env, definition.secretsCiphertext)),
				SUPERBOARD_API_URL: publicOrigin(env),
				SUPERBOARD_PROJECT_ID: String(options.projectId),
			},
		}),
	);
	const request = functionRequest(options);
	const started = Date.now();
	const runId = crypto.randomUUID();
	let response: Response;
	let outcome: "ok" | "error" | "timeout" = "ok";
	let failure: string | null = null;
	try {
		response = await withTimeout(worker.getEntrypoint().fetch(request), definition.timeout_ms);
		if (response.headers.get(ERROR_HEADER) || response.status >= 500) outcome = "error";
	} catch (cause) {
		outcome = cause instanceof TimeoutError ? "timeout" : "error";
		failure = cause instanceof Error ? cause.message.slice(0, 2000) : String(cause);
		response = new Response(
			JSON.stringify({
				error: {
					code: outcome === "timeout" ? "function_timeout" : "function_failed",
					message: outcome === "timeout" ? "Function exceeded its time limit" : "Function failed",
					retryable: outcome === "timeout",
				},
			}),
			{
				status: outcome === "timeout" ? 504 : 502,
				headers: { "content-type": "application/json" },
			},
		);
	}
	const logs = decodeLogs(response.headers.get(LOG_HEADER));
	const headers = new Headers(response.headers);
	headers.delete(LOG_HEADER);
	headers.delete(ERROR_HEADER);
	headers.set("x-superboard-run-id", runId);
	const durationMs = Date.now() - started;
	deferral.waitUntil(
		recordRun(env, {
			id: runId,
			projectId: options.projectId,
			name: options.name,
			version: definition.active_version ?? 0,
			trigger: options.trigger,
			status: response.status,
			outcome,
			durationMs,
			logs,
			error: failure,
			startedAt: new Date(started).toISOString(),
		}),
	);
	return {
		response: new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		}),
		runId,
		logs,
		durationMs,
	};
}

export async function runDueSchedules(
	env: DataEnv,
	deferral: Deferral,
	now = new Date(),
): Promise<number> {
	const { results } = await env.DB.prepare(
		`SELECT project_id, name, cron, next_run_at FROM data_function_schedules
		 WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at LIMIT 25`,
	)
		.bind(now.toISOString())
		.all<{ project_id: number; name: string; cron: string; next_run_at: string }>();
	let started = 0;
	for (const schedule of results) {
		let next: string;
		try {
			next = nextRun(schedule.cron, now).toISOString();
		} catch {
			await env.DB.prepare(
				"UPDATE data_function_schedules SET enabled = 0 WHERE project_id = ? AND name = ?",
			)
				.bind(schedule.project_id, schedule.name)
				.run();
			continue;
		}
		const claimed = await env.DB.prepare(
			`UPDATE data_function_schedules SET next_run_at = ?, last_run_at = ?
			 WHERE project_id = ? AND name = ? AND next_run_at = ?`,
		)
			.bind(next, now.toISOString(), schedule.project_id, schedule.name, schedule.next_run_at)
			.run();
		if (!claimed.meta.changes) continue;
		started += 1;
		deferral.waitUntil(
			invokeFunction(env, deferral, {
				projectId: Number(schedule.project_id),
				name: schedule.name,
				caller: null,
				trigger: "schedule",
				request: new Request("https://functions.internal/", { method: "POST" }),
				path: "/",
				cron: schedule.cron,
			})
				.then((result) => result.response.body?.cancel())
				.catch((cause: unknown) => {
					console.error("[data-functions] scheduled run failed", schedule.name, cause);
				}),
		);
	}
	return started;
}

export async function pruneRuns(env: DataEnv, now = new Date()): Promise<void> {
	await env.DB.prepare(
		"DELETE FROM data_function_runs WHERE id IN (SELECT id FROM data_function_runs WHERE started_at < ? LIMIT 1000)",
	)
		.bind(new Date(now.getTime() - RUN_RETENTION_MS).toISOString())
		.run();
}

function functionRequest(options: {
	projectId: number;
	caller: Caller | null;
	trigger: Trigger;
	request: Request;
	path: string;
	cron?: string;
}): Request {
	const source = new URL(options.request.url);
	const url = new URL(
		`https://function.superboard${options.path.startsWith("/") ? options.path : `/${options.path}`}`,
	);
	url.search = source.search;
	const headers = new Headers(options.request.headers);
	for (const name of Array.from(headers.keys()))
		if (
			/^x-(superboard-|internal|project|context|instance|environment|actor|operator|role)/u.test(
				name,
			)
		)
			headers.delete(name);
	headers.set("x-superboard-project-id", String(options.projectId));
	headers.set("x-superboard-role", options.caller?.role ?? "service");
	if (options.caller?.userId) headers.set("x-superboard-user-id", options.caller.userId);
	if (options.trigger === "schedule") {
		headers.set("x-superboard-trigger", "schedule");
		headers.set("x-superboard-cron", options.cron ?? "");
	}
	const method = options.request.method.toUpperCase();
	return new Request(url, {
		method,
		headers,
		body: method === "GET" || method === "HEAD" ? null : options.request.body,
	});
}

class TimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new TimeoutError("timeout")), milliseconds);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function decodeLogs(value: string | null): unknown[] {
	if (!value) return [];
	try {
		const binary = atob(value);
		const parsed = JSON.parse(
			new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
		) as unknown;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function recordRun(
	env: DataEnv,
	run: {
		id: string;
		projectId: number;
		name: string;
		version: number;
		trigger: Trigger;
		status: number;
		outcome: "ok" | "error" | "timeout";
		durationMs: number;
		logs: unknown[];
		error: string | null;
		startedAt: string;
	},
): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO data_function_runs (id, project_id, name, version, trigger, status, outcome, duration_ms, logs_json, error, started_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			run.id,
			run.projectId,
			run.name,
			run.version,
			run.trigger,
			run.status,
			run.outcome,
			run.durationMs,
			JSON.stringify(run.logs),
			run.error,
			run.startedAt,
		)
		.run();
}
