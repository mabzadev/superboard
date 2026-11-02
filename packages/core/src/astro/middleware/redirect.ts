import { defineMiddleware } from "astro:middleware";

import { RedirectRepository } from "../../database/repositories/redirect.js";
import { getDb } from "../../loader.js";
import { loadCachedRedirects, matchCachedPatterns } from "../../redirects/cache.js";
import { isTerminalStatus } from "../../redirects/status.js";

const SKIP_PREFIXES = ["/_emdash", "/_image"];

const ASSET_EXTENSION = /\.\w{1,10}$/;

type RedirectCode = 301 | 302 | 303 | 307 | 308;

function isRedirectCode(code: number): code is RedirectCode {
	return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;

	if (SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		return next();
	}
	if (ASSET_EXTENSION.test(pathname)) {
		return next();
	}

	let db = context.locals.emdash?.db;
	if (!db) {
		try {
			db = await getDb();
		} catch {
			return next();
		}
	}

	try {
		const repo = new RedirectRepository(db);

		const cached = await loadCachedRedirects(() => repo.findAllEnabled());

		let exact = cached.exact.get(pathname);
		if (!exact && pathname.length > 1) {
			const alt = pathname.endsWith("/") ? pathname.slice(0, -1) : `${pathname}/`;
			exact = cached.exact.get(alt);
		}
		if (exact) {
			if (isTerminalStatus(exact.type)) {
				repo.recordHit(exact.id).catch(() => {});
				return new Response(null, { status: exact.type });
			}
			const dest = exact.destination;
			if (dest.startsWith("//") || dest.startsWith("/\\")) return next();
			repo.recordHit(exact.id).catch(() => {});
			const code = isRedirectCode(exact.type) ? exact.type : 301;
			return context.redirect(dest, code);
		}

		const patternMatch = matchCachedPatterns(cached.patterns, pathname);
		if (patternMatch) {
			const { redirect, destination } = patternMatch;
			if (isTerminalStatus(redirect.type)) {
				repo.recordHit(redirect.id).catch(() => {});
				return new Response(null, { status: redirect.type });
			}
			if (destination.startsWith("//") || destination.startsWith("/\\")) return next();
			repo.recordHit(redirect.id).catch(() => {});
			const code = isRedirectCode(redirect.type) ? redirect.type : 301;
			return context.redirect(destination, code);
		}

		const response = await next();

		const location = response.headers.get("location");
		const missedByRedirect =
			isRedirectCode(response.status) && (location === "/404" || location === "/404/");
		const missedDirectly = response.status === 404 && pathname !== "/404" && pathname !== "/404/";
		if (missedDirectly || missedByRedirect) {
			const referrer = context.request.headers.get("referer") ?? null;
			const userAgent = context.request.headers.get("user-agent") ?? null;
			repo
				.log404({
					path: pathname,
					referrer,
					userAgent,
				})
				.catch(() => {});
		}

		return response;
	} catch {
		return next();
	}
});
