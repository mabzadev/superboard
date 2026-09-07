import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";

import { getSiteEnv } from "./site-env.js";

export async function wakePendingPluginWorkflows(): Promise<void> {
	const env = getSiteEnv();
	try {
		const request = new Request("https://api.internal/internal/plugin-tasks/wake", {
			method: "POST",
			body: JSON.stringify({ instance_id: env.SUPERBOARD_INSTANCE_ID }),
		});
		const headers = await signPluginTaskRequest(request, env.SITE_OPERATOR_BRIDGE_TOKEN ?? "");
		const response = await env.API_SERVICE.fetch(new Request(request, { headers }));
		if (!response.ok)
			console.warn(
				"[plugin-workflow-wake] pending deliveries await the next core maintenance pass",
			);
	} catch (error) {
		console.warn("[plugin-workflow-wake] delivery deferred", error);
	}
}
