import { approveFrontReleaseCandidate } from "@superboard/supbrd-core";
import type { APIRoute } from "astro";

import {
	candidateEvidence,
	getFrontReleaseCandidate,
	persistReauthenticationReceipt,
} from "../../../../lib/front-workflow-repository.js";
import {
	jsonResponse,
	recentOperatorReauthentication,
	requireReleaseOperator,
} from "../../../../lib/operator-guard.js";
import { persistReleaseApproval } from "../../../../lib/release-repository.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const body: unknown = await context.request.json();
	if (!isRecord(body) || typeof body.candidate_id !== "string") {
		return jsonResponse({ error: { code: "INVALID_APPROVAL_REQUEST" } }, 422);
	}
	const candidate = await getFrontReleaseCandidate(env.DB, body.candidate_id);
	if (!candidate || candidate.release.payload.instance_id !== env.SUPERBOARD_INSTANCE_ID) {
		return jsonResponse({ error: { code: "CANDIDATE_NOT_FOUND" } }, 404);
	}
	const evidence = await candidateEvidence(env.DB, candidate);
	if (evidence.signing_key_status !== "active" || !evidence.verification.valid) {
		return jsonResponse(
			{ error: { code: "APPROVAL_VERIFICATION_FAILED", errors: evidence.verification.errors } },
			409,
		);
	}
	const approvedAt = new Date().toISOString();
	const receipt = await recentOperatorReauthentication(context, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		candidate_id: body.candidate_id,
		action: "front_release.approve",
		now: approvedAt,
	});
	if (!receipt) return jsonResponse({ error: { code: "STRONG_REAUTH_REQUIRED" } }, 403);
	const result = await approveFrontReleaseCandidate(candidate, {
		reauthentication: receipt,
		approved_at: approvedAt,
		warnings_acknowledged: stringArray(body.warnings_acknowledged),
	});
	if (result.status === "rejected") return jsonResponse({ error: result }, 409);
	await persistReauthenticationReceipt(env.DB, receipt, approvedAt);
	const persisted = await persistReleaseApproval(env.DB, result.approval, receipt.receipt_id);
	return persisted
		? jsonResponse(result, 201)
		: jsonResponse({ error: { code: "APPROVAL_PERSISTENCE_CONFLICT" } }, 409);
};

function stringArray(value: unknown): string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}
