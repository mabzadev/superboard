import type { APIRoute } from "astro";

export const prerender = false;

import { apiError, apiSuccess } from "#api/error.js";

import { clearDevEmails, getDevEmails } from "../../../../plugins/email-console.js";

export const GET: APIRoute = async () => {
	if (!import.meta.env.DEV) {
		return apiError("FORBIDDEN", "Dev emails endpoint is only available in development mode", 403);
	}

	const emails = getDevEmails();
	return apiSuccess({ items: emails });
};

export const DELETE: APIRoute = async () => {
	if (!import.meta.env.DEV) {
		return apiError("FORBIDDEN", "Dev emails endpoint is only available in development mode", 403);
	}

	clearDevEmails();
	return apiSuccess({ success: true });
};
