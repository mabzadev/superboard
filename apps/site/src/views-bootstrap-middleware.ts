import { defineMiddleware } from "astro:middleware";

import { onRequest as configurationRequest } from "./instance-configuration-middleware.js";
import { getSiteEnv } from "./lib/site-env.js";
import { resolveSuperBoardPluginTarget } from "./lib/superboard-plugin-catalog.js";
import { ensureSuperBoardViews, restrictSuperBoardViewFilters } from "./lib/superboard-views.js";
import { onRequest as packageRequest } from "./plugin-packages-middleware.js";

const viewListPathPattern = /^\/_emdash\/api\/content\/views\/?$/u;

export const onRequest = defineMiddleware(async (context, next) => {
	if (context.locals.user && context.url.pathname.startsWith("/_emdash/admin")) {
		await ensureSuperBoardViews(context.locals.emdash.db);
	}
	if (
		context.locals.user &&
		context.request.method === "GET" &&
		viewListPathPattern.test(context.url.pathname)
	) {
		const env = getSiteEnv();
		const active = await env.DB.prepare(
			"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE instance_id = ? AND target = ? AND state = 'active'",
		)
			.bind(env.SUPERBOARD_INSTANCE_ID, resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT))
			.all<{ plugin_id: string }>();
		restrictSuperBoardViewFilters(
			context.url,
			active.results.map((row) => row.plugin_id),
		);
	}
	return packageRequest(context, () => configurationRequest(context, next));
});
