import {
	pluginTaskManagementRequired,
	sendPluginTaskCommand,
	signPluginTaskRequest,
	type PluginTaskBindings,
	type PluginTaskCommand,
} from "@superboard/contracts/plugin-task";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

import type { Env } from "../types.js";
import { flowsInternalToken } from "./flows-internal-auth.js";

export async function drainPluginWorkflowWakeups(
	env: Env & PluginTaskBindings,
): Promise<{ delivered: number; pending: number }> {
	if (!pluginTaskManagementRequired(env)) return { delivered: 0, pending: 0 };
	const command: PluginTaskCommand = {
		action: "wakeups",
		instance_id: env.SUPERBOARD_INSTANCE_ID!,
		plugin_id: "supbrd-core",
		lease_id: crypto.randomUUID(),
		lease_token: crypto.randomUUID(),
	};
	const page = await sendPluginTaskCommand(env, command);
	if (!Array.isArray(page.waiters)) throw new Error("PLUGIN_TASK_WAKEUP_RESPONSE_INVALID");
	let delivered = 0;
	for (const value of page.waiters) {
		if (
			!value ||
			typeof value !== "object" ||
			!("waiter_id" in value) ||
			typeof value.waiter_id !== "string" ||
			!("plugin_id" in value) ||
			value.plugin_id !== "supbrd-plugmod-flows"
		)
			continue;
		const token = flowsInternalToken(env);
		if (!env.FLOWS_MODULE || !token) continue;
		try {
			const request = new Request("https://flows.internal/internal/system/plugin-task-wake", {
				method: "POST",
				body: JSON.stringify({ ...value, instance_id: env.SUPERBOARD_INSTANCE_ID }),
			});
			const headers = await signPluginTaskRequest(request, token);
			const response = await env.FLOWS_MODULE.fetch(new Request(request, { headers }));
			const result = await readJsonObjectLimited(response, 16384);
			if (!response.ok || result.delivered !== true) continue;
			await sendPluginTaskCommand(env, {
				...command,
				action: "wake_done",
				waiter_id: value.waiter_id,
			});
			delivered += 1;
		} catch (error) {
			console.error("[plugin-workflow-wake] delivery pending", {
				waiter_id: value.waiter_id,
				error,
			});
		}
	}
	return { delivered, pending: page.waiters.length - delivered };
}
