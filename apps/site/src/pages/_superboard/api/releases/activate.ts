import { activateFrontRelease, validateFrontReleaseCandidate } from "@superboard/supbrd-core";
import type { APIRoute } from "astro";

import {
	candidateEvidence,
	getFrontReleaseCandidate,
} from "../../../../lib/front-workflow-repository.js";
import {
	jsonResponse,
	recentOperatorReauthentication,
	requireReleaseOperator,
} from "../../../../lib/operator-guard.js";
import {
	createD1FrontReleaseRepository,
	verifyActivationReceipts,
} from "../../../../lib/release-repository.js";
import { loadLastVerifiedFrontRelease } from "../../../../lib/release-source.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";
import {
	reconcileSuperBoardPluginLifecycleForRelease,
	resolveSuperBoardPluginTarget,
} from "../../../../lib/superboard-plugin-catalog.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const body: unknown = await context.request.json();
	if (
		!isRecord(body) ||
		typeof body.candidate_id !== "string" ||
		typeof body.activation_id !== "string"
	) {
		return jsonResponse({ error: { code: "INVALID_ACTIVATION_REQUEST" } }, 422);
	}
	const candidate = await getFrontReleaseCandidate(env.DB, body.candidate_id);
	if (!candidate || !candidate.approval) {
		return jsonResponse({ error: { code: "CANDIDATE_NOT_APPROVED" } }, 409);
	}
	const verification = validateFrontReleaseCandidate(
		candidate,
		await candidateEvidence(env.DB, candidate),
	);
	if (!verification.valid) {
		return jsonResponse(
			{ error: { code: "ACTIVATION_PREFLIGHT_FAILED", errors: verification.errors } },
			409,
		);
	}
	const activatedAt = new Date().toISOString();
	const reauthentication = await recentOperatorReauthentication(context, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		candidate_id: body.candidate_id,
		action: "front_release.activate",
		now: activatedAt,
	});
	if (!reauthentication) {
		return jsonResponse({ error: { code: "STRONG_REAUTH_REQUIRED" } }, 403);
	}
	const result = await activateFrontRelease(createD1FrontReleaseRepository(env.DB), {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		candidate_id: body.candidate_id,
		activation_id: body.activation_id,
		expected_active_release_id:
			typeof body.expected_active_release_id === "string" ? body.expected_active_release_id : null,
		approval: candidate.approval,
		reauthentication,
		activated_at: activatedAt,
	});
	if (result.status !== "activated") return jsonResponse({ error: result }, 409);
	if (
		!(await verifyActivationReceipts(env.DB, {
			activation_id: result.activation_id,
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			active_release_id: result.active_release_id,
			pointer_revision: result.pointer_revision,
		}))
	) {
		return jsonResponse({ error: { code: "ACTIVATION_RECEIPT_VERIFICATION_FAILED" } }, 500);
	}
	await env.RELEASE_CACHE.delete(`last_verified_release:${env.SUPERBOARD_INSTANCE_ID}`);
	const loaded = await loadLastVerifiedFrontRelease(env, env.SUPERBOARD_INSTANCE_ID);
	if (!loaded || loaded.release.payload.release_id !== result.active_release_id) {
		return jsonResponse({ error: { code: "LAST_VERIFIED_CACHE_RELOAD_FAILED" } }, 500);
	}
	const pluginLifecycle = await reconcileSuperBoardPluginLifecycleForRelease(env.DB, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
		release_id: loaded.release.payload.release_id,
		plugin_lock: loaded.release.payload.plugin_lock,
		activated_at: activatedAt,
	});
	for (const pluginId of pluginLifecycle.activated_plugin_ids) {
		await context.locals.emdash.setPluginStatus(pluginId, "active");
	}
	for (const pluginId of pluginLifecycle.disabled_plugin_ids) {
		await context.locals.emdash.setPluginStatus(pluginId, "inactive");
	}
	return jsonResponse({ ...result, plugin_lifecycle: pluginLifecycle }, 201);
};
