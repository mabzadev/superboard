import { defineMiddleware } from "astro:middleware";

import { ensureSuperBoardViews } from "./lib/superboard-views.js";

export const onRequest = defineMiddleware(async (context, next) => {
	if (context.locals.user && context.url.pathname.startsWith("/_emdash/admin")) {
		await ensureSuperBoardViews(context.locals.emdash.db);
	}
	return next();
});
