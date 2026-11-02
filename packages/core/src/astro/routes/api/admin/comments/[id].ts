import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, handleError, requireDb, unwrapResult } from "#api/error.js";
import { handleCommentGet, handleCommentDelete } from "#api/handlers/comments.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const { id } = params;

	if (!id) {
		return apiError("VALIDATION_ERROR", "Comment ID required", 400);
	}

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const denied = requirePerm(user, "comments:moderate");
	if (denied) return denied;

	try {
		const result = await handleCommentGet(emdash.db, id);
		return unwrapResult(result);
	} catch (error) {
		return handleError(error, "Failed to get comment", "COMMENT_GET_ERROR");
	}
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const { id } = params;

	if (!id) {
		return apiError("VALIDATION_ERROR", "Comment ID required", 400);
	}

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const denied = requirePerm(user, "comments:delete");
	if (denied) return denied;

	try {
		const result = await handleCommentDelete(emdash.db, id);
		return unwrapResult(result);
	} catch (error) {
		return handleError(error, "Failed to delete comment", "COMMENT_DELETE_ERROR");
	}
};
