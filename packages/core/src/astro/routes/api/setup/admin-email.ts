import type { APIRoute } from "astro";

export const prerender = false;

import { requestAdminEmailSetup } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { getSiteBaseUrl } from "#api/site-url.js";
import { setupAdminBody } from "#api/schemas.js";
import { checkRateLimit, getClientIp } from "#auth/rate-limit.js";
import { getTrustedProxyHeaders } from "#auth/trusted-proxy.js";
import { OptionsRepository } from "#db/repositories/options.js";

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	try {
		const adapter = createKyselyAdapter(emdash.db);
		if ((await adapter.countUsers()) > 0) {
			return apiError("SETUP_COMPLETE", "Setup already has an administrator", 400);
		}
		if (!emdash.email?.isAvailable()) {
			return apiError("EMAIL_NOT_CONFIGURED", "Email is not configured", 503);
		}
		const body = await parseBody(request, setupAdminBody);
		if (isParseError(body)) return body;
		const ip = getClientIp(request, getTrustedProxyHeaders(emdash.config));
		const rateLimit = await checkRateLimit(emdash.db, ip, "setup/admin/email", 3, 300);
		if (!rateLimit.allowed) {
			return apiError("SETUP_EMAIL_RATE_LIMITED", "Try again later", 429);
		}
		const email = body.email.trim().toLowerCase();
		const options = new OptionsRepository(emdash.db);
		const existingState = await options.get<Record<string, unknown>>("emdash:setup_state");
		await options.set("emdash:setup_state", {
			...existingState,
			step: "admin_email",
			email,
			name: body.name?.trim() || null,
		});
		const baseUrl = await getSiteBaseUrl(emdash.db, request, emdash.config);
		const siteName = (await options.get<string>("emdash:site_title")) ?? "EmDash";
		await requestAdminEmailSetup(
			{
				baseUrl,
				siteName,
				email: (message) => emdash.email!.send(message, "system"),
			},
			adapter,
			email,
		);
		return apiSuccess({ success: true, emailSent: true });
	} catch (error) {
		return handleError(error, "Failed to send setup email", "SETUP_EMAIL_ERROR");
	}
};
