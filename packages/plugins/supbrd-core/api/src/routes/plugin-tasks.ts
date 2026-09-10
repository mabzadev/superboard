import {
	parsePluginTaskCommand,
	PLUGIN_TASK_AUTHORITY_PATH,
	signPluginTaskRequest,
	verifyPluginTaskRequest,
	type PluginTaskBindings,
} from "@superboard/contracts/plugin-task";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import { configuredSecrets } from "@superboard/contracts/secret";
import { Hono } from "hono";

import { flowsInternalToken } from "../lib/flows-internal-auth.js";
import { drainPluginWorkflowWakeups } from "../lib/plugin-workflow-wake.js";
import type { Env, AppVariables } from "../types.js";

const pluginTasks = new Hono<{ Bindings: Env & PluginTaskBindings; Variables: AppVariables }>();
pluginTasks.post("/", async (c) => {
	try {
		const command = parsePluginTaskCommand(await readJsonObjectLimited(c.req.raw.clone(), 16384));
		if (!command || command.plugin_id === "supbrd-core")
			return c.json({ error: { code: "PLUGIN_TASK_REQUEST_INVALID" } }, 422);
		const props: unknown = c.executionCtx.props;
		if (
			c.env.SUPERBOARD_PLUGIN_LIFECYCLE === "required" &&
			(!props ||
				typeof props !== "object" ||
				!("superboard_plugin_id" in props) ||
				props.superboard_plugin_id !== command.plugin_id)
		)
			return c.json({ error: { code: "PLUGIN_TASK_SCOPE_FORBIDDEN" } }, 403);
		if (command.instance_id !== c.env.SUPERBOARD_INSTANCE_ID)
			return c.json({ error: { code: "PLUGIN_TASK_INSTANCE_FORBIDDEN" } }, 403);
		const secrets =
			command.plugin_id === "supbrd-plugmod-email"
				? configuredSecrets(c.env.EMAIL_INTERNAL_TOKEN)
				: command.plugin_id === "supbrd-plugmod-flows"
					? configuredSecrets(flowsInternalToken(c.env))
					: command.plugin_id === "supbrd-plugmod-observability"
						? configuredSecrets(c.env.OBSERVABILITY_INTERNAL_TOKEN)
						: configuredSecrets(
								c.env.MODULE_INTERNAL_TOKEN,
								c.env.MODULE_INTERNAL_TOKEN_PREVIOUS,
								c.env.INTERNAL_API_TOKEN,
							);
		let verified = false;
		for (const secret of secrets)
			if (await verifyPluginTaskRequest(c.req.raw, secret)) {
				verified = true;
				break;
			}
		if (!verified) return c.json({ error: { code: "PLUGIN_TASK_AUTHENTICATION_REQUIRED" } }, 401);
		if (!c.env.SITE_SERVICE || !c.env.SITE_OPERATOR_BRIDGE_TOKEN)
			return c.json({ error: { code: "PLUGIN_TASK_AUTHORITY_UNAVAILABLE" } }, 503);
		const request = new Request(`https://site.internal${PLUGIN_TASK_AUTHORITY_PATH}`, {
			method: "POST",
			body: JSON.stringify(command),
		});
		const headers = await signPluginTaskRequest(request, c.env.SITE_OPERATOR_BRIDGE_TOKEN);
		const response = await c.env.SITE_SERVICE.fetch(new Request(request, { headers }));
		return new Response(response.body, {
			status: response.status,
			headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
		});
	} catch (error) {
		if (error instanceof RequestBodyError)
			return c.json({ error: { code: "PLUGIN_TASK_REQUEST_INVALID" } }, error.status);
		console.error("[plugin-task-broker] request failed", error);
		return c.json({ error: { code: "PLUGIN_TASK_AUTHORITY_UNAVAILABLE" } }, 503);
	}
});
pluginTasks.post("/wake", async (c) => {
	if (!(await verifyPluginTaskRequest(c.req.raw, c.env.SITE_OPERATOR_BRIDGE_TOKEN ?? "")))
		return c.json({ error: { code: "PLUGIN_TASK_AUTHENTICATION_REQUIRED" } }, 401);
	const body = await readJsonObjectLimited(c.req.raw, 16384);
	if (body.instance_id !== c.env.SUPERBOARD_INSTANCE_ID)
		return c.json({ error: { code: "PLUGIN_TASK_INSTANCE_FORBIDDEN" } }, 403);
	return c.json(await drainPluginWorkflowWakeups(c.env));
});
export default pluginTasks;
