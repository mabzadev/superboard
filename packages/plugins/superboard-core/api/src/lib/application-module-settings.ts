import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

import type { Env } from "../types.js";

export async function applicationModuleSettings(env: Env): Promise<Record<string, unknown>> {
	if (!env.CUSTOM_WORKER_PLUGIN_ID) return {};
	if (!env.SITE_SERVICE || !env.SITE_OPERATOR_BRIDGE_TOKEN)
		throw new Error("PLUGIN_SETTINGS_UNAVAILABLE");
	const query = new URLSearchParams({
		instance_id: env.SUPERBOARD_INSTANCE_ID ?? "",
		environment: env.ENVIRONMENT,
	});
	const request = new Request(
		`https://site.internal/superboard-system/plugin-settings/${encodeURIComponent(env.CUSTOM_WORKER_PLUGIN_ID)}?${query}`,
	);
	const headers = await signPluginTaskRequest(request, env.SITE_OPERATOR_BRIDGE_TOKEN);
	const response = await env.SITE_SERVICE.fetch(
		new Request(request, { headers, signal: AbortSignal.timeout(10000) }),
	);
	if (!response.ok) throw new Error("PLUGIN_SETTINGS_UNAVAILABLE");
	const result = await readJsonObjectLimited(response, 16384);
	if (!result.values || typeof result.values !== "object" || Array.isArray(result.values))
		throw new Error("PLUGIN_SETTINGS_INVALID");
	return result.values as Record<string, unknown>;
}
