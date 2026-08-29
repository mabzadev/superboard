import { snapshotFrontDraft } from "@superboard/supbrd-core";
import type { APIRoute } from "astro";

import {
	loadFrontDraft,
	persistDraftSnapshot,
} from "../../../../lib/front-workflow-repository.js";
import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
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
	const draft = await loadFrontDraft(env.DB, body.front_draft_id);
	if (!draft || draft.instance_id !== env.SUPERBOARD_INSTANCE_ID) {
		return jsonResponse({ error: { code: "FRONT_DRAFT_NOT_FOUND" } }, 404);
	}
	if (body.expected_draft_revision !== draft.revision) {
		return jsonResponse(
			{ error: { code: "STALE_DRAFT_REVISION", current_revision: draft.revision } },
			409,
		);
	}
	const snapshot = snapshotFrontDraft(draft, body.draft_snapshot_id, new Date().toISOString());
	await persistDraftSnapshot(env.DB, snapshot);
	return jsonResponse(snapshot, 201);
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
