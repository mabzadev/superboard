import type { APIRoute } from "astro";

export const prerender = false;

import { apiError, apiSuccess, handleError } from "#api/error.js";
import { isParseError, parseBody } from "#api/parse.js";
import { authMeActionBody } from "#api/schemas.js";
import { UserRepository } from "#db/repositories/user.js";

export const GET: APIRoute = async ({ locals }) => {
	const { user, emdash } = locals;

	if (!user) {
		return apiError("NOT_AUTHENTICATED", "Not authenticated", 401);
	}

	let userData = user.data;
	if (locals.__playgroundDb) {
		if (!emdash) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

		try {
			const persistedUser = await new UserRepository(emdash.db).findById(user.id);
			if (persistedUser) userData = persistedUser.data;
		} catch (error) {
			return handleError(error, "Failed to fetch current user", "CURRENT_USER_ERROR");
		}
	}

	const isFirstLogin = !userData?.welcomeDismissed;

	return apiSuccess({
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		avatarUrl: user.avatarUrl,
		isFirstLogin,
	});
};

export const POST: APIRoute = async ({ request, locals }) => {
	const { user, emdash } = locals;

	if (!user) {
		return apiError("NOT_AUTHENTICATED", "Not authenticated", 401);
	}

	if (!emdash) return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);

	const body = await parseBody(request, authMeActionBody);
	if (isParseError(body)) return body;

	if (body.action === "dismissWelcome") {
		try {
			const userRepo = new UserRepository(emdash.db);
			await userRepo.update(user.id, {
				data: { ...user.data, welcomeDismissed: true },
			});
			return apiSuccess({ success: true });
		} catch (error) {
			return handleError(error, "Failed to dismiss welcome", "WELCOME_DISMISS_ERROR");
		}
	}

	return apiError("UNKNOWN_ACTION", "Unknown action", 400);
};
