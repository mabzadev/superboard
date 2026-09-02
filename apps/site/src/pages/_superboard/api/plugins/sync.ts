import type { APIRoute } from "astro";
import { handleError } from "emdash/api/error";

import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";
import {
	activateSuperBoardPluginInstallationPlan,
	installSuperBoardPluginCatalog,
	resolveSuperBoardPluginTarget,
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
			(body.activate !== undefined && typeof body.activate !== "boolean") ||
			(body.plan_id !== undefined && (typeof body.plan_id !== "string" || !body.plan_id.trim()))
		) {
			return jsonResponse({ error: { code: "INVALID_PLUGIN_CATALOG_SYNC_REQUEST" } }, 422);
		}
		const checkedAt = new Date().toISOString();
		const target = resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT ?? "local");
		const plan = await installSuperBoardPluginCatalog(env.DB, {
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			target,
			plan_id:
				typeof body.plan_id === "string" ? body.plan_id : `plugin-plan-${crypto.randomUUID()}`,
			checked_at: checkedAt,
			expires_at: new Date(Date.parse(checkedAt) + expiresInHours * 60 * 60 * 1_000).toISOString(),
		});
		const activation =
			body.activate === true
				? await activateSuperBoardPluginInstallationPlan(env.DB, {
						instance_id: env.SUPERBOARD_INSTANCE_ID,
						target,
						plan_id: plan.plan_id,
						changed_at: checkedAt,
					})
				: null;
		if (activation) {
			for (const plugin of plan.plugins) {
				await context.locals.emdash.setPluginStatus(plugin.plugin_id, "active");
			}
		}
		return jsonResponse({ plan, activation }, 201);
	} catch (error) {
		return handleError(
			error,
			"SuperBoard plugin catalogue synchronization failed",
			"PLUGIN_CATALOG_SYNC_FAILED",
		);
	}
};
