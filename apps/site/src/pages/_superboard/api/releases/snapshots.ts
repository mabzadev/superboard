import type { APIRoute } from "astro";

import { createDraftSnapshotCas } from "../../../../lib/front-workflow-repository.js";
import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	const body: unknown = await context.request.json();
	if (!isRecord(body) || typeof body.front_draft_id !== "string" || typeof body.draft_snapshot_id !== "string") {
		return jsonResponse({ error: { code: "INVALID_SNAPSHOT_REQUEST" } }, 422);
	}
	if (!Number.isSafeInteger(body.expected_draft_revision)) {
		return jsonResponse({ error: { code: "INVALID_SNAPSHOT_REQUEST" } }, 422);
	}
	const result = await createDraftSnapshotCas(env.DB, {
		draft_snapshot_id: body.draft_snapshot_id,
		front_draft_id: body.front_draft_id,
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		expected_draft_revision: Number(body.expected_draft_revision),
		created_at: new Date().toISOString(),
	});
	if (result.status === "conflict") {
		return jsonResponse(
			{ error: { code: "STALE_DRAFT_REVISION", current_revision: result.current_revision } },
			409,
		);
	}
	return jsonResponse(result.snapshot, 201);
};
