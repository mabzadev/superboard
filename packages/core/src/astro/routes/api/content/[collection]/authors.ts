import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const collection = params.collection!;

	if (!emdash?.handleContentAuthors) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:read_drafts");
	if (denied) return denied;

	const result = await emdash.handleContentAuthors(collection);

	return unwrapResult(result);
};
