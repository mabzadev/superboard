import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, requireDb, unwrapResult } from "#api/error.js";
import {
	handleBylineFieldDelete,
	handleBylineFieldGet,
	handleBylineFieldUpdate,
} from "#api/handlers/byline-fields.js";
import { isParseError, parseBody } from "#api/parse.js";
import { bylineFieldUpdateBody } from "#api/schemas.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const denied = requirePerm(user, "schema:read");
	if (denied) return denied;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const slug = params.slug;
	if (!slug) return apiError("MISSING_PARAM", "Field slug is required", 400);

	const result = await handleBylineFieldGet(emdash.db, slug);
	return unwrapResult(result);
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const denied = requirePerm(user, "schema:manage");
	if (denied) return denied;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const slug = params.slug;
	if (!slug) return apiError("MISSING_PARAM", "Field slug is required", 400);

	const body = await parseBody(request, bylineFieldUpdateBody);
	if (isParseError(body)) return body;

	const result = await handleBylineFieldUpdate(emdash.db, slug, {
		label: body.label,
		required: body.required,
		translatable: body.translatable,
		validation: body.validation,
		sortOrder: body.sortOrder,
	});
	return unwrapResult(result);
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const denied = requirePerm(user, "schema:manage");
	if (denied) return denied;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const slug = params.slug;
	if (!slug) return apiError("MISSING_PARAM", "Field slug is required", 400);

	const result = await handleBylineFieldDelete(emdash.db, slug);
	return unwrapResult(result);
};
