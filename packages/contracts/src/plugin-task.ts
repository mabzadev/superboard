import { signPluginTaskRequest } from "./internal-request-signature.js";
export { signPluginTaskRequest, verifyPluginTaskRequest } from "./internal-request-signature.js";
import { AsyncLocalStorage } from "node:async_hooks";

import { readJsonObjectLimited } from "./request-body.js";

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
const workflowIdentifierPattern = /^[A-Za-z0-9_-]{1,100}$/u;
const leasePattern = /^[A-Za-z0-9._:-]{8,200}$/u;
const pluginPattern =
	/^(?:supbrd-(?:core|(?:plug|plugmod)-[a-z0-9]+(?:-[a-z0-9]+)*)|superboard-[a-z0-9]+(?:-[a-z0-9]+)*)$/u;
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
		(row.plugin_id !== "superboard-flows" ||
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
		: pluginId === "superboard-email"
			? env.EMAIL_INTERNAL_TOKEN
			: pluginId === "superboard-observability"
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
	let response: Response;
	try {
		response = await service.fetch(
			new Request(unsigned, { headers, signal: AbortSignal.timeout(10000) }),
		);
	} catch {
		throw new PluginTaskUnavailable("PLUGIN_TASK_AUTHORITY_UNAVAILABLE", 503);
	}
	let payload: Record<string, unknown>;
	try {
		payload = await readJsonObjectLimited(response, 16384);
	} catch {
		throw new PluginTaskUnavailable(
			"PLUGIN_TASK_AUTHORITY_UNAVAILABLE",
			response.status >= 400 ? response.status : 502,
		);
	}
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
	const valid =
		command.action === "wakeups"
			? Array.isArray(payload.waiters)
			: command.action === "wake_done"
				? payload.notified === true
				: payload.lease_id === command.lease_id &&
					(command.action === "finish"
						? payload.state === "finished"
						: payload.state === "running" &&
							typeof payload.deadline_at === "string" &&
							Number.isFinite(Date.parse(payload.deadline_at)));
	if (!valid) throw new PluginTaskUnavailable("PLUGIN_TASK_AUTHORITY_UNAVAILABLE", 502);
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
	options: { release?: (finish: () => Promise<void>) => Promise<void> | void } = {},
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
	const finish = async () => {
		await sendPluginTaskCommand(env, { ...command, action: "finish" });
	};
	// A successful claim already proves a running lease, so work starts without an extra check.
	try {
		return {
			ran: true,
			value: await taskContext.run({ checkpoint, signal }, () => work(checkpoint, signal)),
		};
	} finally {
		// Completion is reported only after work settles; a deadline is not proof that execution stopped.
		await (options.release ? options.release(finish) : finish());
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
							const tracked = trackWaitUntil(context);
							// Background work keeps the lease until it settles without delaying the response.
							const result = await runPluginTask(
								env,
								pluginId,
								{
									kind: "runtime",
									task_id: `worker-http:${crypto.randomUUID()}`,
									duration_ms: 60000,
								},
								async () => fetchHandler(request, env, tracked.context),
								{
									release: (finish) => {
										if (!tracked.pending()) return finish();
										context.waitUntil(
											tracked
												.settle()
												.then(async (failures) => {
													for (const error of failures)
														console.error("[plugin-task] background work failed", {
															plugin_id: pluginId,
															error,
														});
													await finish();
												})
												.catch((error: unknown) => {
													console.error("[plugin-task] lease finish failed", {
														plugin_id: pluginId,
														error,
													});
												}),
										);
									},
								},
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
							async () => {
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
						if (!batch.messages.length) return;
						const retention = Object.entries(env).some(
							([key, value]) => key.endsWith("DLQ_NAME") && value === batch.queue,
						);
						const failed = (message: Message<TBody>, error: unknown) => {
							console.error("[plugin-task] queue admission or execution failed", {
								plugin_id: pluginId,
								message_id: message.id,
								error,
							});
							message.retry({ delaySeconds: 60 });
						};
						// One lease covers the batch; each message keeps its own ack and retry outcome.
						try {
							const result = await runPluginTask(
								env,
								pluginId,
								{
									kind: retention ? "retention" : "queue",
									task_id: `queue:${batch.queue}:${batch.messages[0]?.id}:${batch.messages.length}`,
								},
								async (_checkpoint, signal) => {
									for (const message of batch.messages) {
										const single: MessageBatch<TBody> = {
											queue: batch.queue,
											metadata: batch.metadata,
											messages: [message],
											ackAll: () => message.ack(),
											retryAll: (options) => message.retry(options),
										};
										try {
											signal.throwIfAborted();
											await withTaskWaitUntil(ctx, (context) =>
												handler.queue?.(single, env, context),
											);
										} catch (error) {
											failed(message, error);
										}
									}
								},
							);
							if (!result.ran)
								for (const message of batch.messages) message.retry({ delaySeconds: 60 });
						} catch (error) {
							for (const message of batch.messages) failed(message, error);
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
							async () => {
								await withTaskWaitUntil(ctx, (context) => handler.tail!(events, env, context));
							},
						);
					},
				}
			: {}),
	};
}

export function trackWaitUntil(ctx: ExecutionContext): {
	context: ExecutionContext;
	pending: () => number;
	settle: () => Promise<unknown[]>;
} {
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
	return {
		context,
		pending: () => pending.length,
		settle: async () => {
			const failures: unknown[] = [];
			for (let index = 0; index < pending.length;) {
				const current = pending.slice(index);
				index = pending.length;
				const results = await Promise.allSettled(current);
				for (const result of results)
					if (result.status === "rejected") failures.push(result.reason);
			}
			return failures;
		},
	};
}

export async function withTaskWaitUntil<T>(
	ctx: ExecutionContext,
	work: (context: ExecutionContext) => T | Promise<T>,
): Promise<T> {
	const tracked = trackWaitUntil(ctx);
	const failures: unknown[] = [];
	let outcome: { value: T } | undefined;
	try {
		outcome = { value: await work(tracked.context) };
	} catch (error) {
		failures.push(error);
	}
	failures.push(...(await tracked.settle()));
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
