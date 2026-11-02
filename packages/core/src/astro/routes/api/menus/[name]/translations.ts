import type { APIRoute } from "astro";
import { z } from "zod";

import { requirePerm } from "#api/authorize.js";
import { handleError, requireDb, unwrapResult } from "#api/error.js";
import { handleMenuCreate, handleMenuGet, handleMenuTranslations } from "#api/handlers/menus.js";
import { isParseError, parseBody, parseQuery } from "#api/parse.js";
import { localeFilterQuery } from "#api/schemas.js";

export const prerender = false;

const createTranslationBody = z
	.object({
		locale: z.string().min(1),
		label: z.string().min(1).optional(),
	})
	.meta({ id: "CreateMenuTranslationBody" });

export const GET: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const name = params.name!;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const denied = requirePerm(user, "menus:read");
	if (denied) return denied;

	const localeQ = parseQuery(new URL(request.url), localeFilterQuery);
	if (isParseError(localeQ)) return localeQ;

	try {
		const anchor = await handleMenuGet(emdash.db, name, { locale: localeQ.locale });
		if (!anchor.success) return unwrapResult(anchor);
		const result = await handleMenuTranslations(emdash.db, anchor.data.id);
		return unwrapResult(result);
	} catch (error) {
		return handleError(error, "Failed to fetch menu translations", "MENU_TRANSLATIONS_ERROR");
	}
};

export const POST: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const name = params.name!;

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	const denied = requirePerm(user, "menus:manage");
	if (denied) return denied;

	const localeQ = parseQuery(new URL(request.url), localeFilterQuery);
	if (isParseError(localeQ)) return localeQ;

	try {
		const body = await parseBody(request, createTranslationBody);
		if (isParseError(body)) return body;

		const source = await handleMenuGet(emdash.db, name, { locale: localeQ.locale });
		if (!source.success) return unwrapResult(source);

		const result = await handleMenuCreate(emdash.db, {
			name,
			label: body.label ?? source.data.label,
			locale: body.locale,
			translationOf: source.data.id,
		});
		return unwrapResult(result, 201);
	} catch (error) {
		return handleError(error, "Failed to create menu translation", "MENU_TRANSLATION_CREATE_ERROR");
	}
};
