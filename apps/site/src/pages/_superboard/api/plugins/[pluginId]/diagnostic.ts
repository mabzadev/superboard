import type { APIRoute } from "astro";

import { jsonResponse } from "../../../../../lib/operator-guard.js";
import {
	DiagnosticAuthorizationError,
	PluginDisabledError,
	PluginNotFoundError,
	resolvePluginDiagnostic,
} from "../../../../../lib/plugin-diagnostic.js";
import { getSiteEnv } from "../../../../../lib/site-env.js";

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const env = getSiteEnv();
	const pluginId = context.params.pluginId ?? "";

	try {
		const diagnostic = await resolvePluginDiagnostic(env, pluginId, context.locals.user, {
			includeDisabled: context.url.searchParams.get("include_disabled") === "1",
		});
		return jsonResponse(
			context.url.searchParams.get("envelope") === "1" ? { data: diagnostic } : diagnostic,
		);
	} catch (error) {
		if (error instanceof DiagnosticAuthorizationError) {
			return jsonResponse({ error: { code: error.code } }, error.status);
		}
		if (error instanceof PluginNotFoundError)
			return jsonResponse({ error: { code: "PLUGIN_NOT_FOUND" } }, 404);
		if (error instanceof PluginDisabledError) {
			return jsonResponse({ error: { code: "PLUGIN_NOT_ACTIVE" } }, 404);
		}
		console.error("[plugin-diagnostic] Failed to resolve diagnostic:", error);
		return jsonResponse({ error: { code: "DIAGNOSTIC_RESOLVE_FAILED" } }, 500);
	}
};
