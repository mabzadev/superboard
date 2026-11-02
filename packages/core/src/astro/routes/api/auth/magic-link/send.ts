import type { APIRoute } from "astro";

export const prerender = false;

import { sendMagicLink, type MagicLinkConfig } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";

import { apiError, apiSuccess } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { magicLinkSendBody } from "#api/schemas.js";
import { getSiteBaseUrl } from "#api/site-url.js";
import { checkRateLimit, getClientIp } from "#auth/rate-limit.js";
import { getTrustedProxyHeaders } from "#auth/trusted-proxy.js";
import { OptionsRepository } from "#db/repositories/options.js";

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	try {
		const body = await parseBody(request, magicLinkSendBody);
		if (isParseError(body)) return body;

		const ip = getClientIp(request, getTrustedProxyHeaders(emdash.config));
		const rateLimit = await checkRateLimit(emdash.db, ip, "magic-link/send", 3, 300);
		if (!rateLimit.allowed) {
			return apiSuccess({
				success: true,
				message: "If an account exists for this email, a magic link has been sent.",
			});
		}

		if (!emdash.email?.isAvailable()) {
			return apiError(
				"EMAIL_NOT_CONFIGURED",
				"Email is not configured. Magic link authentication requires an email provider.",
				503,
			);
		}

		const options = new OptionsRepository(emdash.db);
		const baseUrl = await getSiteBaseUrl(emdash.db, request, emdash.config);
		const siteName = (await options.get<string>("emdash:site_title")) ?? "EmDash";

		const config: MagicLinkConfig = {
			baseUrl,
			siteName,
			email: (message) => emdash.email!.send(message, "system"),
		};

		const adapter = createKyselyAdapter(emdash.db);
		await sendMagicLink(config, adapter, body.email.toLowerCase());

		return apiSuccess({
			success: true,
			message: "If an account exists for this email, a magic link has been sent.",
		});
	} catch (error) {
		console.error("Magic link send error:", error);

		return apiSuccess({
			success: true,
			message: "If an account exists for this email, a magic link has been sent.",
		});
	}
};
