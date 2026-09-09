import { defineMiddleware } from "astro:middleware";

import { FRONT_LOCALE_COOKIE, isUserFrontLocale } from "./lib/user-front-i18n.js";

export const onRequest = defineMiddleware(({ request, url, cookies }, next) => {
	const locale = url.searchParams.get("lang");
	if (
		request.method === "GET" &&
		!url.pathname.startsWith("/_emdash/") &&
		!url.pathname.startsWith("/api/") &&
		isUserFrontLocale(locale)
	) {
		cookies.set(FRONT_LOCALE_COOKIE, locale, {
			path: "/",
			sameSite: "lax",
			secure: url.protocol === "https:",
			maxAge: 31536000,
		});
	}
	return next();
});
