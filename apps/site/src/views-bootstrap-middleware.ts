import { defineMiddleware } from "astro:middleware";

import { resolveLocale } from "../../../packages/admin/src/locales/config.js";
import { onRequest as configurationRequest } from "./instance-configuration-middleware.js";
import { loadLastVerifiedFrontRelease } from "./lib/release-source.js";
import { getSiteEnv } from "./lib/site-env.js";
import { resolveSuperBoardPluginTarget } from "./lib/superboard-plugin-catalog.js";
import { ensureSuperBoardViews, restrictSuperBoardViewFilters } from "./lib/superboard-views.js";
import { withViewConnections } from "./lib/view-connections.js";
import { withViewPluginLabels } from "./lib/view-plugin-labels.js";
import { saveViewPluginSelection } from "./lib/view-plugin-selection.js";
import { onRequest as packageRequest } from "./plugin-packages-middleware.js";

const viewListPathPattern = /^\/_emdash\/api\/content\/views\/?$/u;
const viewItemPathPattern = /^\/_emdash\/api\/content\/views\/([^/]+)\/?$/u;
const viewContentPathPattern =
	/^\/_emdash\/api\/content\/views(?:\/[^/]+(?:\/(?:publish|unpublish|discard-draft|duplicate|restore))?)?\/?$/u;

export const onRequest = defineMiddleware(async (context, next) => {
	const viewItem = context.url.pathname.match(viewItemPathPattern);
	if (context.locals.user && context.request.method === "PUT" && viewItem) {
		const env = getSiteEnv();
		const release = await loadLastVerifiedFrontRelease(env, env.SUPERBOARD_INSTANCE_ID);
		const response = await saveViewPluginSelection(
			{ ...context, params: { ...context.params, collection: "views", id: viewItem[1] } },
			release?.release.payload ?? null,
		);
		if (response) return withViewConnections(response, release?.release.payload ?? null);
	}
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
	const response = await packageRequest(context, () => configurationRequest(context, next));
	if (
		context.locals.user &&
		response.ok &&
		response.headers.get("Content-Type")?.includes("application/json") &&
		viewContentPathPattern.test(context.url.pathname)
	) {
		const env = getSiteEnv();
		const release = await loadLastVerifiedFrontRelease(env, env.SUPERBOARD_INSTANCE_ID);
		return withViewConnections(response, release?.release.payload ?? null);
	}
	if (
		context.locals.user &&
		context.request.method === "GET" &&
		context.url.pathname === "/_emdash/api/manifest"
	)
		return withViewPluginLabels(response, resolveLocale(context.request));
	return response;
});
