import type { APIRoute } from "astro";
import { handleError } from "emdash/api/error";

import { jsonResponse, requireReleaseOperator } from "../../../../../lib/operator-guard.js";
import { isRecord } from "../../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../../lib/site-env.js";
import {
	resolveSuperBoardPluginLifecycleState,
	resolveSuperBoardPluginTarget,
	transitionSuperBoardPluginLifecycle,
} from "../../../../../lib/superboard-plugin-catalog.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	try {
		const body: unknown = await context.request.json();
		const pluginId = context.params.pluginId;
		if (!isRecord(body) || !pluginId || typeof body.reason !== "string" || !body.reason.trim()) {
			return jsonResponse({ error: { code: "INVALID_PLUGIN_LIFECYCLE_REQUEST" } }, 422);
		}
		const result = await transitionSuperBoardPluginLifecycle(env.DB, {
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT ?? "local"),
			plugin_id: pluginId,
			to_state: resolveSuperBoardPluginLifecycleState(body.state),
			changed_at: new Date().toISOString(),
			reason: body.reason,
		});
		await context.locals.emdash.setPluginStatus(
			pluginId,
			result.state === "active" ? "active" : "inactive",
		);
		return jsonResponse(result, 200);
	} catch (error) {
		return handleError(
			error,
			"SuperBoard plugin lifecycle transition failed",
			"PLUGIN_LIFECYCLE_TRANSITION_FAILED",
		);
	}
};
