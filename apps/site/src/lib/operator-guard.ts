import type { APIContext } from "astro";

import type { SuperBoardSiteEnv } from "./site-env.js";

const ADMIN_ROLE = 50;

export function requireReleaseOperator(
	context: Pick<APIContext, "locals" | "request" | "url">,
	env: SuperBoardSiteEnv,
): Response | null {
	if (!context.locals.user) return errorResponse("AUTHENTICATION_REQUIRED", 401);
	if (context.locals.user.role < ADMIN_ROLE) return errorResponse("OPERATOR_REQUIRED", 403);
	if (String(env.SUPERBOARD_RELEASE_OPERATIONS) !== "enabled") {
		return errorResponse("RELEASE_OPERATIONS_DISABLED", 503);
	}
	if (context.request.headers.get("X-SuperBoard-Request") !== "1") {
		return errorResponse("CSRF_HEADER_REQUIRED", 403);
	}
	const origin = context.request.headers.get("Origin");
	if (origin !== context.url.origin) return errorResponse("CSRF_ORIGIN_REJECTED", 403);
	return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Cache-Control": "private, no-store",
			"Content-Type": "application/json; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

function errorResponse(code: string, status: number): Response {
	return jsonResponse({ error: { code } }, status);
}
