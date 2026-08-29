import { activateFrontRelease, validateFrontReleaseCandidate } from "@superboard/supbrd-core";
import type { APIRoute } from "astro";

import {
	candidateEvidence,
	getFrontReleaseCandidate,
} from "../../../../lib/front-workflow-repository.js";
import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { createD1FrontReleaseRepository } from "../../../../lib/release-repository.js";
import { loadLastVerifiedFrontRelease } from "../../../../lib/release-source.js";
import { getSiteEnv } from "../../../../lib/site-env.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const body: unknown = await context.request.json();
	if (!isRecord(body) || typeof body.candidate_id !== "string" || typeof body.activation_id !== "string") {
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
		return jsonResponse({ error: { code: "ACTIVATION_PREFLIGHT_FAILED", errors: verification.errors } }, 409);
	}
	const activatedAt = new Date().toISOString();
	const result = await activateFrontRelease(createD1FrontReleaseRepository(env.DB), {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		candidate_id: body.candidate_id,
		activation_id: body.activation_id,
		expected_active_release_id:
			typeof body.expected_active_release_id === "string" ? body.expected_active_release_id : null,
		approval: candidate.approval,
		activated_at: activatedAt,
	});
	if (result.status !== "activated") return jsonResponse({ error: result }, 409);
	await env.RELEASE_CACHE.delete(`last_verified_release:${env.SUPERBOARD_INSTANCE_ID}`);
	const loaded = await loadLastVerifiedFrontRelease(env, env.SUPERBOARD_INSTANCE_ID);
	if (!loaded || loaded.release.payload.release_id !== result.active_release_id) {
		return jsonResponse({ error: { code: "LAST_VERIFIED_CACHE_RELOAD_FAILED" } }, 500);
	}
	return jsonResponse(result, 201);
};
