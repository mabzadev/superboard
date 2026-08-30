import { createFrontPreview } from "@superboard/supbrd-core";
import type { APIRoute } from "astro";

import {
	candidateEvidence,
	getFrontReleaseCandidate,
	persistFrontPreview,
} from "../../../../lib/front-workflow-repository.js";
import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const body: unknown = await context.request.json();
	if (!isRecord(body) || typeof body.candidate_id !== "string") {
		return jsonResponse({ error: { code: "INVALID_PREVIEW_REQUEST" } }, 422);
	}
	const candidate = await getFrontReleaseCandidate(env.DB, body.candidate_id);
	if (!candidate || candidate.release.payload.instance_id !== env.SUPERBOARD_INSTANCE_ID) {
		return jsonResponse({ error: { code: "CANDIDATE_NOT_FOUND" } }, 404);
	}
	const evidence = await candidateEvidence(env.DB, candidate);
	if (evidence.signing_key_status !== "active" || !evidence.verification.valid) {
		return jsonResponse(
			{ error: { code: "PREVIEW_VERIFICATION_FAILED", errors: evidence.verification.errors } },
			409,
		);
	}
	const issuedAt = new Date().toISOString();
	const requestedHours = typeof body.expires_in_hours === "number" ? body.expires_in_hours : 1;
	const preview = createFrontPreview(candidate, {
		preview_id: crypto.randomUUID(),
		issued_at: issuedAt,
		expires_at: new Date(Date.parse(issuedAt) + requestedHours * 60 * 60 * 1_000).toISOString(),
	});
	await persistFrontPreview(env.DB, preview);
	return jsonResponse(
		{
			...preview,
			preview_url: `/superboard-preview/${encodeURIComponent(preview.preview_id)}/`,
		},
		201,
	);
};
