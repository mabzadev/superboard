export const prerender = false;

import { SignupError, validateSignupToken } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { generateRegistrationOptions } from "@emdash-cms/auth/passkey";
import type { APIRoute } from "astro";
import { ulid } from "ulidx";

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { getPublicOrigin } from "#api/public-url.js";
import { signupRegisterOptionsBody } from "#api/schemas.js";
import { createChallengeStore } from "#auth/challenge-store.js";
import { getPasskeyConfig } from "#auth/passkey-config.js";
import { OptionsRepository } from "#db/repositories/options.js";

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash } = locals;
	if (!emdash?.db) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	try {
		const body = await parseBody(request, signupRegisterOptionsBody);
		if (isParseError(body)) return body;
		const adapter = createKyselyAdapter(emdash.db);
		const signup = await validateSignupToken(adapter, body.token);
		if (await adapter.getUserByEmail(signup.email)) {
			return apiError("USER_EXISTS", "An account with this email already exists", 409);
		}
		const url = new URL(request.url);
		const options = new OptionsRepository(emdash.db);
		const siteName = (await options.get<string>("emdash:site_title")) ?? undefined;
		const registrationOptions = await generateRegistrationOptions(
			getPasskeyConfig(url, siteName, getPublicOrigin(url, emdash.config)),
			{ id: ulid(), email: signup.email, name: body.name || null },
			[],
			createChallengeStore(emdash.db),
		);
		return apiSuccess({ options: registrationOptions });
	} catch (error) {
		if (error instanceof SignupError) {
			return apiError(
				error.code.toUpperCase(),
				error.message,
				error.code === "token_expired" ? 410 : 404,
			);
		}
		return handleError(
			error,
			"Failed to generate registration options",
			"SIGNUP_REGISTER_OPTIONS_ERROR",
		);
	}
};
