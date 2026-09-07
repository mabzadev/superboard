import { verifyPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

import type { Env } from "./types";

export async function wakePluginWorkflow(request: Request, env: Env): Promise<Response> {
	if (!(await verifyPluginTaskRequest(request, env.INTERNAL_API_TOKEN ?? "")))
		return Response.json(
			{ error: { code: "PLUGIN_TASK_AUTHENTICATION_REQUIRED" } },
			{ status: 401 },
		);
	const body = await readJsonObjectLimited(request, 16384);
	if (
		body.instance_id !== env.SUPERBOARD_INSTANCE_ID ||
		body.plugin_id !== "supbrd-plugmod-flows" ||
		!["FLOW_DELAY_EXECUTION", "FLOW_MAINTENANCE_EXECUTION"].includes(
			String(body.workflow_binding),
		) ||
		typeof body.workflow_id !== "string" ||
		typeof body.event_type !== "string"
	)
		return Response.json({ error: { code: "PLUGIN_TASK_WAKE_INVALID" } }, { status: 422 });
	const binding =
		body.workflow_binding === "FLOW_DELAY_EXECUTION"
			? env.FLOW_DELAY_EXECUTION
			: env.FLOW_MAINTENANCE_EXECUTION;
	const instance = await binding.get(body.workflow_id);
	const status = await instance.status();
	if (status.status === "complete" || status.status === "terminated")
		return Response.json({ delivered: true });
	await instance.sendEvent({
		type: body.event_type,
		payload: { plugin_id: "supbrd-plugmod-flows" },
	});
	return Response.json({ delivered: true });
}
