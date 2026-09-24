import { canonicalFrontHref } from "@superboard/contracts/front-paths";
import { defineMiddleware } from "astro:middleware";

import { retiredFrontPageDestination } from "./lib/retired-front-pages.js";
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
	const retired = retiredFrontPageDestination(url.pathname);
	const requested = `${url.pathname}${url.search}`;
	const destination = canonicalFrontHref(retired ? `${retired}${url.search}` : requested);
	if (destination !== requested && (request.method === "GET" || request.method === "HEAD"))
		return Response.redirect(new URL(destination, url), 308);
	return next();
});
