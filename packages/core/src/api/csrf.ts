import { apiError } from "./error.js";

export function checkPublicCsrf(
	request: Request,
	url: URL,
	publicOrigin?: string,
): Response | null {
	const csrfHeader = request.headers.get("X-EmDash-Request");
	if (csrfHeader === "1") return null;

	const origin = request.headers.get("Origin");
	if (origin) {
		try {
			const originUrl = new URL(origin);
			if (originUrl.origin === url.origin) return null;
			if (publicOrigin && originUrl.origin === publicOrigin) return null;
		} catch {}

		return apiError("CSRF_REJECTED", "Cross-origin request blocked", 403);
	}

	return null;
}
