import type { APIRoute } from "astro";
import { handleError } from "emdash/api/error";

import { saveFrontDraft } from "../../../../lib/front-workflow-repository.js";
import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import { isRecord } from "../../../../lib/request-validation.js";
import { getSiteEnv } from "../../../../lib/site-env.js";

export const prerender = false;

export const PUT: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	try {
		const body = await context.request.json();
		if (!isRecord(body)) return jsonResponse({ error: { code: "INVALID_DRAFT" } }, 422);
		const result = await saveFrontDraft(env.DB, {
			front_draft_id: requiredString(body.front_draft_id),
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			expected_draft_revision: requiredInteger(body.expected_draft_revision),
			value: body.input,
			updated_at: new Date().toISOString(),
		});
		return result.status === "conflict"
			? jsonResponse({ error: { code: "STALE_DRAFT_REVISION", ...result } }, 409)
			: jsonResponse(result.draft, 200);
	} catch (error) {
		return handleError(error, "Front draft update failed", "DRAFT_UPDATE_FAILED");
	}
};

function requiredString(value: unknown): string {
	if (typeof value !== "string" || value === "") throw new Error("string field is required");
	return value;
}

function requiredInteger(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		throw new Error("revision must be non-negative");
	return Number(value);
}
