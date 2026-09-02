import type { APIRoute } from "astro";
import { handleError } from "emdash/api/error";

import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";
import {
	installSuperBoardPluginCatalog,
	resolveSuperBoardPluginTarget,
	resolveSuperBoardTargetPluginIds,
} from "../../../../lib/superboard-plugin-catalog.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	try {
		const body: unknown = await context.request.json();
		if (!isRecord(body)) {
			return jsonResponse({ error: { code: "INVALID_PLUGIN_CATALOG_SYNC_REQUEST" } }, 422);
		}
		const expiresInHours = body.expires_in_hours;
		if (
			typeof expiresInHours !== "number" ||
			!Number.isSafeInteger(expiresInHours) ||
			expiresInHours < 1 ||
			expiresInHours > 24 ||
			body.activate !== undefined ||
			(body.plan_id !== undefined && (typeof body.plan_id !== "string" || !body.plan_id.trim()))
		) {
			return jsonResponse({ error: { code: "INVALID_PLUGIN_CATALOG_SYNC_REQUEST" } }, 422);
		}
		const checkedAt = new Date().toISOString();
		const operatorId = context.locals.user?.id;
		if (!operatorId) return jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401);
		const target = resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT ?? "local");
		const plan = await installSuperBoardPluginCatalog(env.DB, {
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target,
			plan_id:
				typeof body.plan_id === "string" ? body.plan_id : `plugin-plan-${crypto.randomUUID()}`,
			approved_by: operatorId,
			target_artifact_checksum: env.TARGET_ARTIFACT_CHECKSUM,
			target_plugin_ids: resolveSuperBoardTargetPluginIds(env.SUPERBOARD_PLUGIN_IDS),
			checked_at: checkedAt,
			expires_at: new Date(Date.parse(checkedAt) + expiresInHours * 60 * 60 * 1_000).toISOString(),
		});
		return jsonResponse({ plan }, 201);
	} catch (error) {
		return handleError(
			error,
			"SuperBoard plugin catalogue synchronization failed",
			"PLUGIN_CATALOG_SYNC_FAILED",
		);
	}
};
