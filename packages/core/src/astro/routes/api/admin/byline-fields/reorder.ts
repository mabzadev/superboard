import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { requireDb, unwrapResult } from "#api/error.js";
import { handleBylineFieldReorder } from "#api/handlers/byline-fields.js";
import { isParseError, parseBody } from "#api/parse.js";
import { bylineFieldReorderBody } from "#api/schemas.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;
	const denied = requirePerm(user, "schema:manage");
	if (denied) return denied;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const body = await parseBody(request, bylineFieldReorderBody);
	if (isParseError(body)) return body;

	const result = await handleBylineFieldReorder(emdash.db, body.slugs);
	return unwrapResult(result);
};
