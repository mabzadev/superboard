import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, handleError, unwrapResult } from "#api/error.js";
import { handleSettingsGet, handleSettingsUpdate } from "#api/handlers/settings.js";
import { isParseError, parseBody } from "#api/parse.js";
import { settingsUpdateBody } from "#api/schemas.js";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "settings:read");
	if (denied) return denied;

	try {
		const result = await handleSettingsGet(emdash.db, emdash.storage);
		return unwrapResult(result);
	} catch (error) {
		return handleError(error, "Failed to get settings", "SETTINGS_READ_ERROR");
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const denied = requirePerm(user, "settings:manage");
	if (denied) return denied;

	try {
		const body = await parseBody(request, settingsUpdateBody);
		if (isParseError(body)) return body;

		const result = await handleSettingsUpdate(emdash.db, emdash.storage, body);
		return unwrapResult(result);
	} catch (error) {
		return handleError(error, "Failed to update settings", "SETTINGS_UPDATE_ERROR");
	}
};
