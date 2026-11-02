import type { APIRoute } from "astro";

export const prerender = false;

import { apiSuccess, handleError } from "#api/error.js";
import { isSafeRedirect } from "#api/redirect.js";

export const POST: APIRoute = async ({ session, url }) => {
	try {
		if (session) {
			session.destroy();
		}

		const redirect = url.searchParams.get("redirect");

		if (isSafeRedirect(redirect)) {
			return new Response(null, {
				status: 302,
				headers: { Location: redirect },
			});
		}

		return apiSuccess({
			success: true,
			message: "Logged out successfully",
		});
	} catch (error) {
		return handleError(error, "Logout failed", "LOGOUT_ERROR");
	}
};
