import type { APIRoute } from "astro";

export const prerender = false;

import { requestSignup } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { apiError, apiSuccess } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { signupRequestBody } from "#api/schemas.js";
import { getSiteBaseUrl } from "#api/site-url.js";
import { checkRateLimit, getClientIp } from "#auth/rate-limit.js";
import { getTrustedProxyHeaders } from "#auth/trusted-proxy.js";
import { OptionsRepository } from "#db/repositories/options.js";

const GENERIC_SUCCESS = {
	success: true,
	message: "If your email domain is allowed, you'll receive a verification email.",
};

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	if (!emdash.email?.isAvailable()) {
		return apiError(
			"EMAIL_NOT_CONFIGURED",
			"Email not configured. Self-signup is unavailable.",
			503,
		);
	}

	try {
		const body = await parseBody(request, signupRequestBody);
		if (isParseError(body)) return body;

		const ip = getClientIp(request, getTrustedProxyHeaders(emdash.config));
		const rateLimit = await checkRateLimit(emdash.db, ip, "signup/request", 3, 300);
		if (!rateLimit.allowed) {
			return apiSuccess(GENERIC_SUCCESS);
		}

		const adapter = createKyselyAdapter(emdash.db);

		const options = new OptionsRepository(emdash.db);
		const siteName = (await options.get<string>("emdash:site_title")) || "EmDash";

		const baseUrl = await getSiteBaseUrl(emdash.db, request, emdash.config);

		await requestSignup(
			{
				baseUrl,
				siteName,
				email: (message) => emdash.email!.send(message, "system"),
			},
			adapter,
			body.email.toLowerCase().trim(),
		);

		return apiSuccess(GENERIC_SUCCESS);
	} catch (error) {
		console.error("Signup request error:", error);

		return apiSuccess(GENERIC_SUCCESS);
	}
};
