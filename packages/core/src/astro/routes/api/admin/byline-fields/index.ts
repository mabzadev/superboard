import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { requireDb, unwrapResult } from "#api/error.js";
import { handleBylineFieldCreate, handleBylineFieldList } from "#api/handlers/byline-fields.js";
import { isParseError, parseBody } from "#api/parse.js";
import { bylineFieldCreateBody } from "#api/schemas.js";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = locals;
	const denied = requirePerm(user, "schema:read");
	if (denied) return denied;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const result = await handleBylineFieldList(emdash.db);
	return unwrapResult(result);
};

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;
	const denied = requirePerm(user, "schema:manage");
	if (denied) return denied;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const body = await parseBody(request, bylineFieldCreateBody);
	if (isParseError(body)) return body;

	const result = await handleBylineFieldCreate(emdash.db, {
		slug: body.slug,
		label: body.label,
		type: body.type,
		required: body.required,
		translatable: body.translatable,
		validation: body.validation ?? null,
		sortOrder: body.sortOrder,
	});
	return unwrapResult(result, 201);
};
