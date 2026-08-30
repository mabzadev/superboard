import { hasPermission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { getCandidateByReleaseId } from "../../lib/front-workflow-repository.js";
import { recentOperatorReauthentication } from "../../lib/operator-guard.js";
import { createD1FrontReleaseRepository } from "../../lib/release-repository.js";
import { renderReleaseRollbackConsole } from "../../lib/release-rollback-console.js";
import { getSiteEnv } from "../../lib/site-env.js";

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
	const active = await createD1FrontReleaseRepository(env.DB).getActive(
		env.SUPERBOARD_INSTANCE_ID,
	);
	if (!active?.previous_release_id) return textResponse("Rollback target unavailable", 409);
	const target = await getCandidateByReleaseId(env.DB, active.previous_release_id);
	if (!target?.approval) return textResponse("Rollback target unavailable", 409);
	const now = new Date().toISOString();
	const reauthentication = await recentOperatorReauthentication(context, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		candidate_id: target.release.payload.candidate_id,
		action: "front_release.rollback",
		now,
	});
	return new Response(
		renderReleaseRollbackConsole({
			rollback_activation_id: crypto.randomUUID(),
			current_release_id: active.active_release_id,
			target_candidate_id: target.release.payload.candidate_id,
			target_release_id: target.release.payload.release_id,
			target_content_checksum: target.release.content_checksum,
			target_validation_set_checksum: target.release.validation_set_checksum,
			next_pointer_revision: active.pointer_revision + 1,
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
