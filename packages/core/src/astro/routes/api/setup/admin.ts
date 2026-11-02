import type { APIRoute } from "astro";

export const prerender = false;

import { generateToken } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { generateRegistrationOptions } from "@emdash-cms/auth/passkey";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { getPublicOrigin } from "#api/public-url.js";
import { setupAdminBody } from "#api/schemas.js";
import { createChallengeStore } from "#auth/challenge-store.js";
import { getPasskeyConfig } from "#auth/passkey-config.js";
import { SETUP_NONCE_COOKIE, SETUP_NONCE_MAX_AGE_SECONDS } from "#auth/setup-nonce.js";
import { OptionsRepository } from "#db/repositories/options.js";

export const POST: APIRoute = async ({ cookies, request, locals }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	try {
		const options = new OptionsRepository(emdash.db);
		const setupComplete = await options.get("emdash:setup_complete");
		const isComplete = setupComplete === true || setupComplete === "true";

		const adapter = createKyselyAdapter(emdash.db);
		const userCount = await adapter.countUsers();

		if (userCount > 0) {
			if (isComplete) {
				return apiError("SETUP_COMPLETE", "Setup already complete", 400);
			}
			return apiError("ADMIN_EXISTS", "Admin user already exists", 400);
		}

		const body = await parseBody(request, setupAdminBody);
		if (isParseError(body)) return body;

		const existingState = await options.get<Record<string, unknown>>("emdash:setup_state");

		const nonce = generateToken();

		const url = new URL(request.url);
		const siteName = (await options.get<string>("emdash:site_title")) ?? undefined;
		const siteUrl = getPublicOrigin(url, emdash?.config);
		const passkeyConfig = getPasskeyConfig(url, siteName, siteUrl);

		const challengeStore = createChallengeStore(emdash.db);

		const tempUser = {
			id: `setup-${Date.now()}`,
			email: body.email.toLowerCase(),
			name: body.name || null,
		};

		const registrationOptions = await generateRegistrationOptions(
			passkeyConfig,
			tempUser,
			[],
			challengeStore,
		);

		await options.set("emdash:setup_state", {
			...existingState,
			step: "admin",
			email: body.email.toLowerCase(),
			name: body.name || null,
			tempUserId: tempUser.id,
			nonce,
		});

		const publicOrigin = new URL(siteUrl);
		cookies.set(SETUP_NONCE_COOKIE, nonce, {
			path: "/_emdash/",
			httpOnly: true,
			sameSite: "strict",
			secure: publicOrigin.protocol === "https:",
			maxAge: SETUP_NONCE_MAX_AGE_SECONDS,
		});

		return apiSuccess({
			success: true,
			options: registrationOptions,
		});
	} catch (error) {
		return handleError(error, "Failed to create admin", "SETUP_ADMIN_ERROR");
	}
};
