import { AsyncLocalStorage } from "node:async_hooks";

import { readJsonObjectLimited, readBytesLimited } from "./request-body.js";

export type PluginTaskKind =
	| "scheduled"
	| "queue"
	| "alarm"
	| "tail"
	| "retention"
	| "workflow"
	| "runtime";
export interface PluginTaskCommand {
	action: "claim" | "check" | "finish" | "wakeups" | "wake_done";
	instance_id: string;
	plugin_id: string;
	lease_id: string;
	lease_token: string;
	task_id?: string;
	kind?: PluginTaskKind;
	duration_ms?: number;
	workflow_binding?: string;
	workflow_id?: string;
	resume_event?: string;
	waiter_id?: string;
}
export interface PluginTaskLease {
	lease_id: string;
	lease_token: string;
	deadline_at: string;
}
export interface PluginTaskBindings {
	SUPERBOARD_PLUGIN_LIFECYCLE?: string;
	SUPERBOARD_INSTANCE_ID?: string;
	ENVIRONMENT?: string;
	API_SERVICE?: { fetch(request: Request): Promise<Response> };
	SITE_SERVICE?: { fetch(request: Request): Promise<Response> };
	SITE_OPERATOR_BRIDGE_TOKEN?: string;
	INTERNAL_API_TOKEN?: string;
	MODULE_INTERNAL_TOKEN?: string;
	EMAIL_INTERNAL_TOKEN?: string;
	FLOWS_INTERNAL_TOKEN?: string;
	OBSERVABILITY_INTERNAL_TOKEN?: string;
}
const signatureHeader = "X-SuperBoard-Task-Signature";
const timestampHeader = "X-SuperBoard-Task-Timestamp";
const signaturePattern = /^[a-f0-9]{64}$/u;
const workflowIdentifierPattern = /^[A-Za-z0-9_-]{1,100}$/u;
const leasePattern = /^[A-Za-z0-9._:-]{8,200}$/u;
const pluginPattern = /^supbrd-(?:core|(?:plug|plugmod)-[a-z0-9]+(?:-[a-z0-9]+)*)$/u;
const kinds = new Set<PluginTaskKind>([
	"scheduled",
	"queue",
	"alarm",
	"tail",
	"retention",
	"workflow",
	"runtime",
]);
export const PLUGIN_TASK_AUTHORITY_PATH = "/superboard-system/plugin-task-authority";
export const PLUGIN_TASK_BROKER_PATH = "/internal/plugin-tasks";
export const DEFAULT_PLUGIN_TASK_DURATION_MS = 15 * 60 * 1000;

export class PluginTaskUnavailable extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}

export function parsePluginTaskCommand(value: unknown): PluginTaskCommand | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (
		!["claim", "check", "finish", "wakeups", "wake_done"].includes(String(row.action)) ||
		typeof row.instance_id !== "string" ||
		!row.instance_id ||
		row.instance_id.length > 128 ||
		typeof row.plugin_id !== "string" ||
		!pluginPattern.test(row.plugin_id) ||
		typeof row.lease_id !== "string" ||
		!leasePattern.test(row.lease_id) ||
		typeof row.lease_token !== "string" ||
		!leasePattern.test(row.lease_token)
	)
		return null;
	if (
		row.action === "claim" &&
		(typeof row.task_id !== "string" ||
			!row.task_id ||
			row.task_id.length > 512 ||
			!kinds.has(row.kind as PluginTaskKind) ||
			typeof row.duration_ms !== "number" ||
			!Number.isSafeInteger(row.duration_ms) ||
			row.duration_ms < 1000 ||
			row.duration_ms > DEFAULT_PLUGIN_TASK_DURATION_MS)
	)
		return null;
	if (
		row.kind === "workflow" &&
		(row.plugin_id !== "supbrd-plugmod-flows" ||
			!["FLOW_DELAY_EXECUTION", "FLOW_MAINTENANCE_EXECUTION"].includes(
				String(row.workflow_binding),
			) ||
			typeof row.workflow_id !== "string" ||
			!workflowIdentifierPattern.test(row.workflow_id) ||
			typeof row.resume_event !== "string" ||
			!workflowIdentifierPattern.test(row.resume_event))
	)
		return null;
	if ((row.action === "wakeups" || row.action === "wake_done") && row.plugin_id !== "supbrd-core")
		return null;
	if (
		row.action === "wake_done" &&
		(typeof row.waiter_id !== "string" || !leasePattern.test(row.waiter_id))
	)
		return null;
	return row as unknown as PluginTaskCommand;
}

export async function signPluginTaskRequest(request: Request, secret: string): Promise<Headers> {
	if (!secret.trim()) throw new Error("PLUGIN_TASK_SECRET_REQUIRED");
	const timestamp = String(Math.floor(Date.now() / 1000));
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		await taskSignaturePayload(request, timestamp),
	);
	return new Headers({
		[timestampHeader]: timestamp,
		[signatureHeader]: hex(new Uint8Array(signature)),
		"Content-Type": "application/json",
	});
}

export async function verifyPluginTaskRequest(request: Request, secret: string): Promise<boolean> {
	const timestamp = request.headers.get(timestampHeader);
	const signature = request.headers.get(signatureHeader);
	if (!secret.trim() || !timestamp || !signature || !signaturePattern.test(signature)) return false;
	const issued = Number(timestamp);
	const now = Date.now() / 1000;
	if (!Number.isSafeInteger(issued) || issued > now + 5 || issued < now - 60) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify(
		"HMAC",
		key,
		Uint8Array.from(signature.match(/.{2}/gu)!, (pair) => Number.parseInt(pair, 16)),
		await taskSignaturePayload(request, timestamp),
	);
}

async function taskSignaturePayload(
	request: Request,
	timestamp: string,
): Promise<Uint8Array<ArrayBuffer>> {
	const url = new URL(request.url);
	const body = await readBytesLimited(request.clone(), 16384);
	const checksum = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
	return new Uint8Array(
		new TextEncoder().encode(
			[
				"superboard.plugin-task.v1",
				timestamp,
				request.method,
				url.pathname,
				url.search,
				checksum,
			].join("\n"),
		),
	);
}
function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function pluginTaskManagementRequired(env: PluginTaskBindings): boolean {
	if (env.SUPERBOARD_PLUGIN_LIFECYCLE === undefined && !env.SUPERBOARD_INSTANCE_ID) return false;
	if (env.SUPERBOARD_PLUGIN_LIFECYCLE !== "required" || !env.SUPERBOARD_INSTANCE_ID)
		throw new PluginTaskUnavailable("PLUGIN_TASK_CONFIGURATION_INVALID", 503);
	return true;
}

function pluginTaskAuthority(env: PluginTaskBindings, pluginId: string) {
	const direct = env.SITE_SERVICE;
	const service = direct ?? env.API_SERVICE;
	if (!service) throw new PluginTaskUnavailable("PLUGIN_TASK_AUTHORITY_UNAVAILABLE", 503);
	const url = direct
		? `https://site.internal${PLUGIN_TASK_AUTHORITY_PATH}`
		: `https://api.internal${PLUGIN_TASK_BROKER_PATH}`;
	const token = direct
		? env.SITE_OPERATOR_BRIDGE_TOKEN
		: pluginId === "supbrd-plugmod-email"
			? env.EMAIL_INTERNAL_TOKEN
			: pluginId === "supbrd-plugmod-observability"
				? env.OBSERVABILITY_INTERNAL_TOKEN
				: (env.INTERNAL_API_TOKEN ?? env.MODULE_INTERNAL_TOKEN);
	if (!token) throw new PluginTaskUnavailable("PLUGIN_TASK_SECRET_REQUIRED", 503);
	return { service, url, token };
}

export async function sendPluginTaskCommand(
	env: PluginTaskBindings,
	command: PluginTaskCommand,
): Promise<Record<string, unknown>> {
	const { service, url, token } = pluginTaskAuthority(env, command.plugin_id);
	const unsigned = new Request(url, { method: "POST", body: JSON.stringify(command) });
	const headers = await signPluginTaskRequest(unsigned, token);
	const response = await service.fetch(
		new Request(unsigned, { headers, signal: AbortSignal.timeout(10000) }),
	);
	const payload = await readJsonObjectLimited(response, 16384);
	if (!response.ok) {
		const code =
			payload.error &&
			typeof payload.error === "object" &&
			"code" in payload.error &&
			typeof payload.error.code === "string"
				? payload.error.code
				: "PLUGIN_TASK_AUTHORITY_UNAVAILABLE";
		throw new PluginTaskUnavailable(code, response.status);
	}
	return payload;
}

interface PluginTaskExecutionContext {
	checkpoint: () => Promise<void>;
	signal: AbortSignal;
}
const taskContextKey = Symbol.for("superboard:plugin-task-context");
const taskRoot = globalThis as typeof globalThis & {
	[taskContextKey]?: AsyncLocalStorage<PluginTaskExecutionContext>;
};
const taskContext = (taskRoot[taskContextKey] ??=
	new AsyncLocalStorage<PluginTaskExecutionContext>());
export async function checkpointPluginTask(): Promise<void> {
	await taskContext.getStore()?.checkpoint();
}

export async function runPluginTask<T>(
	env: PluginTaskBindings,
	pluginId: string,
	input: {
		kind: PluginTaskKind;
		task_id: string;
		duration_ms?: number;
		workflow_binding?: string;
		workflow_id?: string;
		resume_event?: string;
	},
	work: (checkpoint: () => Promise<void>, signal: AbortSignal) => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
	if (!pluginTaskManagementRequired(env))
		return { ran: true, value: await work(async () => undefined, new AbortController().signal) };
	const command: PluginTaskCommand = {
		action: "claim",
		instance_id: env.SUPERBOARD_INSTANCE_ID!,
		plugin_id: pluginId,
		lease_id: crypto.randomUUID(),
		lease_token: crypto.randomUUID(),
		task_id: input.task_id,
		kind: input.kind,
		duration_ms: input.duration_ms ?? DEFAULT_PLUGIN_TASK_DURATION_MS,
		...(input.workflow_binding
			? {
					workflow_binding: input.workflow_binding,
					workflow_id: input.workflow_id,
					resume_event: input.resume_event,
				}
			: {}),
	};
	try {
		await sendPluginTaskCommand(env, command);
	} catch (error) {
		if (error instanceof PluginTaskUnavailable && error.code === "PLUGIN_NOT_ACTIVE")
			return { ran: false };
		throw error;
	}
	const signal = AbortSignal.timeout(command.duration_ms!);
	const checkpoint = async () => {
		signal.throwIfAborted();
		await sendPluginTaskCommand(env, { ...command, action: "check" });
	};
	try {
		await checkpoint();
		return {
			ran: true,
			value: await taskContext.run({ checkpoint, signal }, () => work(checkpoint, signal)),
		};
	} finally {
		// Completion is reported only after work settles; a deadline is not proof that execution stopped.
		await sendPluginTaskCommand(env, { ...command, action: "finish" });
	}
}

export function withPluginTaskLifecycle<TEnv extends PluginTaskBindings, TBody>(
	pluginId: string,
	handler: ExportedHandler<TEnv, TBody>,
	options: { fetch?: boolean } = {},
): ExportedHandler<TEnv, TBody> {
	const fetchHandler = handler.fetch;
	return {
		...handler,
		...(options.fetch && fetchHandler
			? {
					fetch: async (
						request: Parameters<NonNullable<ExportedHandler<TEnv, TBody>["fetch"]>>[0],
						env: TEnv,
						context: ExecutionContext,
					) => {
						try {
							const managed = pluginTaskManagementRequired(env);
							if (managed) pluginTaskAuthority(env, pluginId);
							const path = new URL(request.url).pathname;
							if (!managed || path === "/health" || path === "/internal/v1/health")
								return await fetchHandler(request, env, context);
							const result = await runPluginTask(
								env,
								pluginId,
								{
									kind: "runtime",
									task_id: `worker-http:${crypto.randomUUID()}`,
									duration_ms: 60000,
								},
								async () =>
									withTaskWaitUntil(context, async (scoped) => fetchHandler(request, env, scoped)),
							);
							return result.ran
								? result.value
								: Response.json(
										{ error: { code: "PLUGIN_NOT_ACTIVE", message: "Plugin is not active" } },
										{ status: 404, headers: { "Cache-Control": "no-store" } },
									);
						} catch (error) {
							if (error instanceof PluginTaskUnavailable)
								return Response.json(
									{ error: { code: error.code, message: error.code } },
									{ status: error.status, headers: { "Cache-Control": "no-store" } },
								);
							throw error;
						}
					},
				}
			: {}),
		...(handler.scheduled
			? {
					scheduled: async (controller: ScheduledController, env: TEnv, ctx: ExecutionContext) => {
						await runPluginTask(
							env,
							pluginId,
							{
								kind: "scheduled",
								task_id: `scheduled:${controller.cron}:${controller.scheduledTime}`,
							},
							async (checkpoint) => {
								await checkpoint();
								await withTaskWaitUntil(ctx, (context) =>
									handler.scheduled!(controller, env, context),
								);
							},
						);
					},
				}
			: {}),
		...(handler.queue
			? {
					queue: async (batch: MessageBatch<TBody>, env: TEnv, ctx: ExecutionContext) => {
						for (const message of batch.messages) {
							const retention = Object.entries(env).some(
								([key, value]) => key.endsWith("DLQ_NAME") && value === batch.queue,
							);
							const single: MessageBatch<TBody> = {
								queue: batch.queue,
								metadata: batch.metadata,
								messages: [message],
								ackAll: () => message.ack(),
								retryAll: (options) => message.retry(options),
							};
							try {
								const result = await runPluginTask(
									env,
									pluginId,
									{
										kind: retention ? "retention" : "queue",
										task_id: `queue:${batch.queue}:${message.id}`,
									},
									async (checkpoint) => {
										await checkpoint();
										await withTaskWaitUntil(ctx, (context) => handler.queue!(single, env, context));
									},
								);
								if (!result.ran) message.retry({ delaySeconds: 60 });
							} catch (error) {
								console.error("[plugin-task] queue admission or execution failed", {
									plugin_id: pluginId,
									message_id: message.id,
									error,
								});
								message.retry({ delaySeconds: 60 });
							}
						}
					},
				}
			: {}),
		...(handler.tail
			? {
					tail: async (events: TraceItem[], env: TEnv, ctx: ExecutionContext) => {
						events = events.filter((event) => !isPluginTaskTrace(event));
						if (!events.length) return;
						await runPluginTask(
							env,
							pluginId,
							{ kind: "tail", task_id: `tail:${crypto.randomUUID()}` },
							async (checkpoint) => {
								await checkpoint();
								await withTaskWaitUntil(ctx, (context) => handler.tail!(events, env, context));
							},
						);
					},
				}
			: {}),
	};
}

export async function withTaskWaitUntil<T>(
	ctx: ExecutionContext,
	work: (context: ExecutionContext) => T | Promise<T>,
): Promise<T> {
	const pending: Promise<unknown>[] = [];
	const context = new Proxy(ctx, {
		get(target, property) {
			if (property === "waitUntil")
				return (promise: Promise<unknown>) => {
					pending.push(Promise.resolve(promise));
					target.waitUntil(promise);
				};
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	const failures: unknown[] = [];
	let outcome: { value: T } | undefined;
	try {
		outcome = { value: await work(context) };
	} catch (error) {
		failures.push(error);
	}
	for (let index = 0; index < pending.length;) {
		const current = pending.slice(index);
		index = pending.length;
		const results = await Promise.allSettled(current);
		for (const result of results) if (result.status === "rejected") failures.push(result.reason);
	}
	if (failures.length) throw failures[0];
	if (!outcome) throw new Error("PLUGIN_TASK_RESULT_MISSING");
	return outcome.value;
}

function isPluginTaskTrace(trace: TraceItem): boolean {
	const event: unknown = trace.event;
	if (
		!event ||
		typeof event !== "object" ||
		!("request" in event) ||
		!event.request ||
		typeof event.request !== "object" ||
		!("url" in event.request) ||
		typeof event.request.url !== "string"
	)
		return false;
	try {
		const path = new URL(event.request.url).pathname;
		return (
			path === PLUGIN_TASK_AUTHORITY_PATH ||
			path === PLUGIN_TASK_BROKER_PATH ||
			path === `${PLUGIN_TASK_BROKER_PATH}/`
		);
	} catch {
		return false;
	}
}
