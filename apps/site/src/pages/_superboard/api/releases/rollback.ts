import { planPointerRollback, validateFrontReleaseCandidate } from "@superboard/supbrd-core";
import type { APIRoute } from "astro";

import {
	candidateEvidence,
	getCandidateByReleaseId,
	persistReauthenticationReceipt,
} from "../../../../lib/front-workflow-repository.js";
import {
	jsonResponse,
	recentOperatorReauthentication,
	requireReleaseOperator,
} from "../../../../lib/operator-guard.js";
import { createD1FrontReleaseRepository } from "../../../../lib/release-repository.js";
import { loadLastVerifiedFrontRelease } from "../../../../lib/release-source.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const body: unknown = await context.request.json();
	if (!isRecord(body) || typeof body.activation_id !== "string") {
		return jsonResponse({ error: { code: "INVALID_ROLLBACK_REQUEST" } }, 422);
	}
	const repository = createD1FrontReleaseRepository(env.DB);
	const active = await repository.getActive(env.SUPERBOARD_INSTANCE_ID);
	if (!active?.previous_release_id) {
		return jsonResponse({ error: { code: "ROLLBACK_TARGET_UNAVAILABLE" } }, 409);
	}
	const target = await getCandidateByReleaseId(env.DB, active.previous_release_id);
	if (!target || !target.approval) {
		return jsonResponse({ error: { code: "ROLLBACK_TARGET_UNAVAILABLE" } }, 409);
	}
	const now = new Date().toISOString();
	const receipt = await recentOperatorReauthentication(context, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		candidate_id: target.release.payload.candidate_id,
		action: "front_release.rollback",
		now,
	});
	if (!receipt) return jsonResponse({ error: { code: "STRONG_REAUTH_REQUIRED" } }, 403);
	const plan = await planPointerRollback(active, target, receipt, now);
	if (plan.status === "rejected") return jsonResponse({ error: plan }, 409);
	const verification = validateFrontReleaseCandidate(
		target,
		await candidateEvidence(env.DB, target),
	);
	if (!verification.valid) {
		return jsonResponse(
			{ error: { code: "ROLLBACK_PREFLIGHT_FAILED", errors: verification.errors } },
			409,
		);
	}
	await persistReauthenticationReceipt(env.DB, receipt, now);
	const result = await repository.compareAndSwapActive({
		candidate: target,
		command: {
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			candidate_id: target.release.payload.candidate_id,
			activation_id: body.activation_id,
			expected_active_release_id: plan.expected_active_release_id,
			approval: target.approval,
			activated_at: now,
		},
	});
	if (result.status !== "activated") return jsonResponse({ error: result }, 409);
	await env.RELEASE_CACHE.delete(`last_verified_release:${env.SUPERBOARD_INSTANCE_ID}`);
	await loadLastVerifiedFrontRelease(env, env.SUPERBOARD_INSTANCE_ID);
	return jsonResponse({ ...result, rollback: "pointer_only" }, 201);
};
