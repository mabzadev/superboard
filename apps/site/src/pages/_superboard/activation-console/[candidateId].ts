import { hasPermission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { getFrontReleaseCandidate } from "../../../lib/front-workflow-repository.js";
import { recentOperatorReauthentication } from "../../../lib/operator-guard.js";
import { createD1FrontReleaseRepository } from "../../../lib/release-repository.js";
import { renderReleaseActivationConsole } from "../../../lib/release-activation-console.js";
import { isUlid } from "../../../lib/request-validation.js";
import { getSiteEnv } from "../../../lib/site-env.js";

export const prerender = false;

export const GET: APIRoute = async (context) => {
	const env = getSiteEnv();
	if (!context.locals.user) return textResponse("Authentication required", 401);
	if (!hasPermission(context.locals.user, "settings:manage")) {
		return textResponse("Release operator required", 403);
	}
	if (String(env.SUPERBOARD_RELEASE_OPERATIONS) !== "enabled") {
		return textResponse("Release operations disabled", 503);
	}
	const candidateId = context.params.candidateId;
	if (!isUlid(candidateId)) return textResponse("Candidate not found", 404);
	const candidate = await getFrontReleaseCandidate(env.DB, candidateId);
	if (!candidate || candidate.release.payload.instance_id !== env.SUPERBOARD_INSTANCE_ID) {
		return textResponse("Candidate not found", 404);
	}
	const active = await createD1FrontReleaseRepository(env.DB).getActive(
		env.SUPERBOARD_INSTANCE_ID,
	);
	const now = new Date().toISOString();
	const reauthentication = await recentOperatorReauthentication(context, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		candidate_id: candidateId,
		action: "front_release.activate",
		now,
	});
	return new Response(
		renderReleaseActivationConsole({
			activation_id: crypto.randomUUID(),
			candidate_id: candidateId,
			release_id: candidate.release.payload.release_id,
			content_checksum: candidate.release.content_checksum,
			validation_set_checksum: candidate.release.validation_set_checksum,
			expected_active_release_id: active?.active_release_id ?? null,
			next_pointer_revision: (active?.pointer_revision ?? 0) + 1,
			status: candidate.status,
			reauthentication_ready: reauthentication !== null,
		}),
		{
			status: 200,
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Security-Policy":
					"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
				"Content-Type": "text/html; charset=utf-8",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
};

function textResponse(message: string, status: number): Response {
	return new Response(message, {
		status,
		headers: {
			"Cache-Control": "private, no-store",
			"Content-Type": "text/plain; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
