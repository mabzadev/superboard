import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { searchEnableBody } from "#api/schemas.js";
import { FTSManager } from "#search/index.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	const denied = requirePerm(user, "search:manage");
	if (denied) return denied;

	const body = await parseBody(request, searchEnableBody);
	if (isParseError(body)) return body;

	const ftsManager = new FTSManager(emdash.db);

	try {
		if (body.enabled) {
			await ftsManager.enableSearch(body.collection, {
				weights: body.weights,
				tokenize: body.tokenize,
			});

			const stats = await ftsManager.getIndexStats(body.collection);

			return apiSuccess({
				collection: body.collection,
				enabled: true,
				indexed: stats?.indexed ?? 0,
			});
		} else {
			await ftsManager.disableSearch(body.collection);

			return apiSuccess({
				collection: body.collection,
				enabled: false,
			});
		}
	} catch (error) {
		return handleError(error, "Failed to update search config", "SEARCH_ERROR");
	}
};
