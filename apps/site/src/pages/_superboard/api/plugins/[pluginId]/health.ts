import type { APIRoute } from "astro";

import { jsonResponse, requirePluginOperator } from "../../../../../lib/operator-guard.js";
import {
	DiagnosticAuthorizationError,
	PluginDisabledError,
	PluginNotFoundError,
	resolvePluginDiagnostic,
} from "../../../../../lib/plugin-diagnostic.js";
import { getSiteEnv } from "../../../../../lib/site-env.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const denied = requirePluginOperator(context, { mutation: true });
	if (denied) return denied;

	const env = getSiteEnv();
	const pluginId = context.params.pluginId ?? "";

	try {
		const diagnostic = await resolvePluginDiagnostic(env, pluginId, context.locals.user, {
			recheckHealth: true,
			includeDisabled: context.url.searchParams.get("include_disabled") === "1",
		});
		if (context.url.searchParams.get("envelope") === "1") return jsonResponse({ data: diagnostic });
		return jsonResponse({
			status: diagnostic.health.status,
			checkedAt: diagnostic.health.checkedAt,
			health: diagnostic.health,
			diagnostic,
		});
	} catch (error) {
		if (error instanceof DiagnosticAuthorizationError) {
			return jsonResponse({ error: { code: error.code } }, error.status);
		}
		if (error instanceof PluginNotFoundError)
			return jsonResponse({ error: { code: "PLUGIN_NOT_FOUND" } }, 404);
		if (error instanceof PluginDisabledError) {
			return jsonResponse({ error: { code: "PLUGIN_NOT_ACTIVE" } }, 404);
		}
		console.error("[plugin-health] Failed to recheck health:", error);
		return jsonResponse({ error: { code: "HEALTH_CHECK_FAILED" } }, 500);
	}
};
