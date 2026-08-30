import type { APIRoute } from "astro";
import { handleError } from "emdash/api/error";

import {
	createFrontDraftWithSnapshot,
	getCandidateByReleaseId,
} from "../../../../lib/front-workflow-repository.js";
import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import { createD1FrontReleaseRepository } from "../../../../lib/release-repository.js";
import { isRecord, isUlid } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";
import { loadActiveSuperBoardPluginLock } from "../../../../lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../../../../lib/user-front-release.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	try {
		const body: unknown = await context.request.json();
		if (
			!isRecord(body) ||
			!isUlid(body.front_draft_id) ||
			!isUlid(body.draft_snapshot_id) ||
			!isUlid(body.compilation_id) ||
			!isUlid(body.candidate_id) ||
			!isUlid(body.release_id)
		)
			return jsonResponse({ error: { code: "INVALID_USER_SLICE_REQUEST" } }, 422);
		const identifiers = {
			front_draft_id: body.front_draft_id,
			draft_snapshot_id: body.draft_snapshot_id,
			compilation_id: body.compilation_id,
			candidate_id: body.candidate_id,
			release_id: body.release_id,
		};
		const now = new Date().toISOString();
		const active = await createD1FrontReleaseRepository(env.DB).getActive(
			env.SUPERBOARD_INSTANCE_ID,
		);
		const predecessor = active
			? await getCandidateByReleaseId(env.DB, active.active_release_id)
			: null;
		if (active && !predecessor) {
			return jsonResponse({ error: { code: "ACTIVE_RELEASE_PREDECESSOR_MISSING" } }, 409);
		}
		const releaseSequence = (predecessor?.release.payload.release_sequence ?? 0) + 1;
		const previousReleaseId = active?.active_release_id ?? null;
		const pluginLock = await loadActiveSuperBoardPluginLock(env.DB);
		const input = await composeUserFrontReleaseInput({
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			...identifiers,
			release_sequence: releaseSequence,
			previous_release_id: previousReleaseId,
			plugin_lock: pluginLock,
			created_at: now,
		});
		await createFrontDraftWithSnapshot(env.DB, {
			front_draft_id: identifiers.front_draft_id,
			draft_snapshot_id: identifiers.draft_snapshot_id,
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			value: input,
			created_at: now,
		});
		return jsonResponse(
			{
				front_draft_id: identifiers.front_draft_id,
				draft_snapshot_id: identifiers.draft_snapshot_id,
				draft_revision: 1,
				release_sequence: releaseSequence,
				previous_release_id: previousReleaseId,
				next: "/superboard-system/api/releases/compile",
			},
			201,
		);
	} catch (error) {
		return handleError(error, "User Front slice creation failed", "USER_SLICE_CREATE_FAILED");
	}
};
