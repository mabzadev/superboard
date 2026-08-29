import { composeUserFrontReleaseInput } from "@superboard/supbrd-plug-user";
import type { APIRoute } from "astro";
import { handleError } from "emdash/api/error";

import {
	createFrontDraftWithSnapshot,
} from "../../../../lib/front-workflow-repository.js";
import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	try {
		const body: unknown = await context.request.json();
		if (!isRecord(body)) return jsonResponse({ error: { code: "INVALID_USER_SLICE_REQUEST" } }, 422);
		const identifiers = {
			front_draft_id: stringField(body.front_draft_id),
			draft_snapshot_id: stringField(body.draft_snapshot_id),
			compilation_id: stringField(body.compilation_id),
			candidate_id: stringField(body.candidate_id),
			release_id: stringField(body.release_id),
		};
		const now = new Date().toISOString();
		const input = await composeUserFrontReleaseInput({
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			...identifiers,
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
				next: "/superboard-system/api/releases/compile",
			},
			201,
		);
	} catch (error) {
		return handleError(error, "User Front slice creation failed", "USER_SLICE_CREATE_FAILED");
	}
};

function stringField(value: unknown): string {
	if (typeof value !== "string" || value === "") throw new Error("A release identifier is required");
	return value;
}
