import { hasPermission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseQuery } from "#api/parse.js";
import { searchQuery } from "#api/schemas.js";
import { searchWithDb } from "#search/index.js";

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	const query = parseQuery(url, searchQuery);
	if (isParseError(query)) return query;

	const collections = query.collections
		? query.collections.split(",").map((c: string) => c.trim())
		: undefined;

	const status =
		query.status && query.status !== "published" && hasPermission(user, "content:read_drafts")
			? query.status
			: "published";

	try {
		await emdash.ensureSearchHealthy?.();

		const result = await searchWithDb(emdash.db, query.q, {
			collections,
			status,
			locale: query.locale,
			limit: query.limit,
			cursor: query.cursor,
		});

		return apiSuccess(result);
	} catch (error) {
		return handleError(error, "Search failed", "SEARCH_ERROR");
	}
};
