import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError, unwrapResult } from "#api/error.js";
import { parseOptionalBody, isParseError } from "#api/parse.js";
import { contentPreviewUrlBody } from "#api/schemas.js";
import { resolveSecretsCached } from "#config/secrets.js";
import { getPreviewUrl } from "#preview/index.js";

import { getI18nConfig } from "../../../../../../i18n/config.js";

export const prerender = false;

const DURATION_PATTERN = /^(\d+)([smhdw])$/;

export const POST: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	const denied = requirePerm(user, "content:read_drafts");
	if (denied) return denied;
	const collection = params.collection!;
	const id = params.id!;

	const { previewSecret } = await resolveSecretsCached(emdash.db);

	let entryLocale: string | null = null;
	if (emdash?.handleContentGet) {
		const result = await emdash.handleContentGet(collection, id);
		if (!result.success) return unwrapResult(result);
		entryLocale = result.data?.item?.locale ?? null;
	}

	const body = await parseOptionalBody(request, contentPreviewUrlBody, {});
	if (isParseError(body)) return body;

	const expiresIn = body.expiresIn || "1h";
	const defaultPathPattern = import.meta.env.EMDASH_PREVIEW_PATH_PATTERN || "/{collection}/{id}";
	const pathPattern = body.pathPattern || defaultPathPattern;

	const i18n = getI18nConfig();
	let localeSegment = "";
	if (entryLocale && i18n) {
		const isDefault = entryLocale === i18n.defaultLocale;
		localeSegment = isDefault && !i18n.prefixDefaultLocale ? "" : entryLocale;
	} else if (entryLocale) {
		localeSegment = entryLocale;
	}

	const expiresInSeconds = typeof expiresIn === "number" ? expiresIn : parseExpiresIn(expiresIn);
	const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

	try {
		const url = await getPreviewUrl({
			collection,
			id,
			secret: previewSecret,
			expiresIn,
			pathPattern,
			locale: localeSegment,
		});

		return apiSuccess({ url, expiresAt });
	} catch (error) {
		return handleError(error, "Failed to generate preview URL", "TOKEN_ERROR");
	}
};

function parseExpiresIn(duration: string): number {
	const match = duration.match(DURATION_PATTERN);
	if (!match) {
		return 3600;
	}

	const value = parseInt(match[1], 10);
	const unit = match[2];

	switch (unit) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 60 * 60;
		case "d":
			return value * 60 * 60 * 24;
		case "w":
			return value * 60 * 60 * 24 * 7;
		default:
			return 3600;
	}
}
