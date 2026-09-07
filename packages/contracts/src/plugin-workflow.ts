import type { WorkflowStep, WorkflowStepConfig, WorkflowStepContext } from "cloudflare:workers";

import {
	DEFAULT_PLUGIN_TASK_DURATION_MS,
	pluginTaskManagementRequired,
	runPluginTask,
	type PluginTaskBindings,
} from "./plugin-task.js";

type WorkflowValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| WorkflowValue[]
	| { [key: string]: WorkflowValue };
type Checkpoint =
	| { __plugin_task_workflow: "v1"; outcome: "paused"; event_type: string }
	| { __plugin_task_workflow: "v1"; outcome: "completed"; value: WorkflowValue };
const waitTimeoutPattern = /timed? ?out|timeout/iu;
const durationPattern = /^(\d+(?:\.\d+)?)\s*(milliseconds?|seconds?|minutes?|hours?)$/u;

export function withPluginWorkflowLifecycle(
	env: PluginTaskBindings,
	step: WorkflowStep,
	workflowBinding: "FLOW_DELAY_EXECUTION" | "FLOW_MAINTENANCE_EXECUTION",
	workflowId: string,
): WorkflowStep {
	if (!pluginTaskManagementRequired(env)) return step;
	return new Proxy(step, {
		get(target, property) {
			if (property === "do")
				return async (
					name: string,
					configOrWork:
						| WorkflowStepConfig
						| ((context: WorkflowStepContext) => Promise<WorkflowValue>),
					maybeWork?: (context: WorkflowStepContext) => Promise<WorkflowValue>,
				) => {
					const config = typeof configOrWork === "function" ? {} : configOrWork;
					const work = typeof configOrWork === "function" ? configOrWork : maybeWork;
					if (!work) throw new TypeError("Workflow callback required");
					for (let attempt = 0; ; attempt += 1) {
						const stepName =
							attempt === 0 ? name : `${name.slice(0, 180)}:plugin-resume:${attempt}`;
						const eventType = `plugin-${await digest(`${workflowId}:${name}:${attempt}`)}`;
						const result: unknown = await Reflect.apply(target.do, target, [
							stepName,
							config,
							async (context: WorkflowStepContext): Promise<Checkpoint> => {
								const task = await runPluginTask(
									env,
									"supbrd-plugmod-flows",
									{
										kind: "workflow",
										task_id: `${workflowId}:${name}:${attempt}`,
										workflow_binding: workflowBinding,
										workflow_id: workflowId,
										resume_event: eventType,
										duration_ms: duration(config.timeout),
									},
									async (checkpoint) => {
										await checkpoint();
										return work(context);
									},
								);
								return task.ran
									? { __plugin_task_workflow: "v1", outcome: "completed", value: task.value }
									: { __plugin_task_workflow: "v1", outcome: "paused", event_type: eventType };
							},
						]);
						if (!isCheckpoint(result)) return result;
						if (result.outcome === "completed") return result.value;
						try {
							await target.waitForEvent(`${stepName.slice(0, 220)}:plugin-active`, {
								type: result.event_type,
								timeout: "1 year",
							});
						} catch (error) {
							if (!(error instanceof Error) || !waitTimeoutPattern.test(error.message)) throw error;
						}
					}
				};
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
function isCheckpoint(value: unknown): value is Checkpoint {
	return Boolean(
		value &&
		typeof value === "object" &&
		"__plugin_task_workflow" in value &&
		value.__plugin_task_workflow === "v1" &&
		"outcome" in value &&
		(value.outcome === "completed" || value.outcome === "paused"),
	);
}
function duration(value: WorkflowStepConfig["timeout"]): number {
	if (value === undefined) return 10 * 60 * 1000;
	if (typeof value === "number")
		return Math.min(DEFAULT_PLUGIN_TASK_DURATION_MS, Math.max(1000, value));
	const match = durationPattern.exec(value);
	if (!match) throw new Error("PLUGIN_TASK_WORKFLOW_TIMEOUT_INVALID");
	const unit = match[2]!;
	const multiplier = unit.startsWith("millisecond")
		? 1
		: unit.startsWith("second")
			? 1000
			: unit.startsWith("minute")
				? 60000
				: 3600000;
	return Math.min(DEFAULT_PLUGIN_TASK_DURATION_MS, Math.max(1000, Number(match[1]) * multiplier));
}
async function digest(value: string): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
