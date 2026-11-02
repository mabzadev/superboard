import type { APIRoute } from "astro";

export const prerender = false;

import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { generateRegistrationOptions } from "@emdash-cms/auth/passkey";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseOptionalBody } from "#api/parse.js";
import { getPublicOrigin } from "#api/public-url.js";
import { passkeyRegisterOptionsBody } from "#api/schemas.js";
import { createChallengeStore } from "#auth/challenge-store.js";
import { getPasskeyConfig } from "#auth/passkey-config.js";
import { OptionsRepository } from "#db/repositories/options.js";

const MAX_PASSKEYS = 10;

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	if (!emdash?.db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	if (!user) {
		return apiError("NOT_AUTHENTICATED", "Not authenticated", 401);
	}

	try {
		const adapter = createKyselyAdapter(emdash.db);

		const count = await adapter.countCredentialsByUserId(user.id);
		if (count >= MAX_PASSKEYS) {
			return apiError("PASSKEY_LIMIT", `Maximum of ${MAX_PASSKEYS} passkeys allowed`, 400);
		}

		const body = await parseOptionalBody(request, passkeyRegisterOptionsBody, {});
		if (isParseError(body)) return body;

		const existingCredentials = await adapter.getCredentialsByUserId(user.id);

		const url = new URL(request.url);
		const optionsRepo = new OptionsRepository(emdash.db);
		const siteName = (await optionsRepo.get<string>("emdash:site_title")) ?? undefined;
		const siteUrl = getPublicOrigin(url, emdash?.config);
		const passkeyConfig = getPasskeyConfig(url, siteName, siteUrl);

		const challengeStore = createChallengeStore(emdash.db);
		const registrationOptions = await generateRegistrationOptions(
			passkeyConfig,
			{ id: user.id, email: user.email, name: user.name },
			existingCredentials,
			challengeStore,
		);

		if (body.name) {
			await optionsRepo.set(`emdash:passkey_pending:${user.id}`, {
				name: body.name,
			});
		}

		return apiSuccess({
			options: registrationOptions,
		});
	} catch (error) {
		return handleError(
			error,
			"Failed to generate registration options",
			"PASSKEY_REGISTER_OPTIONS_ERROR",
		);
	}
};
