import type { APIContext } from "astro";
import { defineMiddleware } from "astro:middleware";
// @ts-ignore - virtual module
import virtualConfig from "virtual:emdash/config";

import { resolveSecretsCached } from "#config/secrets.js";

import { verifyPreviewToken, parseContentId } from "../../preview/tokens.js";
import { getRequestContext, runWithContext } from "../../request-context.js";
import { EDIT_PARAM, renderToolbarBootstrap } from "../../visual-editing/toolbar-bootstrap.js";
import { renderToolbar } from "../../visual-editing/toolbar.js";

type ToolbarMode = "server" | "client" | false;

const toolbarMode: ToolbarMode = virtualConfig?.toolbar ?? "server";

type RouteCache = APIContext["cache"];

function optOutOfRouteCache(cache: RouteCache): void {
	cache.set(false);
}

async function injectBeforeBodyEnd(
	response: Response,
	htmlToInject: string,
): Promise<{ response: Response; injected: boolean }> {
	const contentType = response.headers.get("content-type");
	if (!contentType?.includes("text/html")) return { response, injected: false };

	const html = await response.text();
	if (!html.includes("</body>")) {
		return { response: new Response(html, response), injected: false };
	}

	const injected = html.replace("</body>", `${htmlToInject}</body>`);
	return {
		response: new Response(injected, {
			status: response.status,
			headers: response.headers,
		}),
		injected: true,
	};
}

async function injectToolbar(
	response: Response,
	toolbarHtml: string,
	routeCache: RouteCache,
): Promise<Response> {
	const result = await injectBeforeBodyEnd(response, toolbarHtml);
	if (result.injected) {
		result.response.headers.set("Cache-Control", "private, no-store");
		optOutOfRouteCache(routeCache);
	}
	return result.response;
}

async function injectBootstrap(response: Response): Promise<Response> {
	const result = await injectBeforeBodyEnd(response, renderToolbarBootstrap());
	return result.response;
}

function redirectToCanonical(url: URL): Response {
	const canonical = new URL(url);
	canonical.searchParams.delete(EDIT_PARAM);
	return new Response(null, {
		status: 302,
		headers: {
			Location: canonical.pathname + canonical.search + canonical.hash,
			"Cache-Control": "private, no-store",
		},
	});
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { cookies, url } = context;

	if (url.pathname.startsWith("/_emdash")) {
		return next();
	}

	const { user } = context.locals;
	const isEditor = !!user && user.role >= 30;

	const playgroundDb = context.locals.__playgroundDb;
	if (playgroundDb) {
		const hasEditCookie = cookies.get("emdash-edit-mode")?.value === "true";
		return runWithContext({ editMode: hasEditCookie, db: playgroundDb, dbIsIsolated: true }, () =>
			next(),
		);
	}

	const hasEditCookie = cookies.get("emdash-edit-mode")?.value === "true";
	const hasPreviewToken = url.searchParams.has("_preview");
	const hasEditParam = toolbarMode === "client" && url.searchParams.has(EDIT_PARAM);

	if (hasEditParam) {
		optOutOfRouteCache(context.cache);

		if (!isEditor) {
			return redirectToCanonical(url);
		}
	}

	if (!hasEditCookie && !hasPreviewToken && !isEditor) {
		if (toolbarMode === "client") {
			return injectBootstrap(await next());
		}
		return next();
	}

	const editMode = hasEditCookie && isEditor;

	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Astro context includes currentLocale when i18n is configured
	const locale = (context as { currentLocale?: string }).currentLocale;

	const routeCache = context.cache;

	let preview: { collection: string; id: string } | undefined;
	if (hasPreviewToken) {
		const db = context.locals.emdash?.db;
		if (db) {
			const { previewSecret } = await resolveSecretsCached(db);
			const result = await verifyPreviewToken({ url, secret: previewSecret });
			if (result.valid) {
				const { collection, id } = parseContentId(result.payload.cid);
				preview = { collection, id };
			}
		} else {
			console.warn(
				"[emdash] Preview token present but EmDash runtime not initialized; preview disabled.",
			);
		}
	}

	const needsContext = hasEditCookie || hasPreviewToken;

	if (needsContext) {
		const parent = getRequestContext();
		return runWithContext({ ...parent, editMode, preview, locale }, async () => {
			let response = await next();

			if (hasPreviewToken) {
				optOutOfRouteCache(routeCache);
			}
			if (preview) {
				response = new Response(response.body, response);
				response.headers.set("Cache-Control", "private, no-store");
			}

			if (isEditor && toolbarMode !== false) {
				const toolbarHtml = renderToolbar({
					editMode,
					isPreview: !!preview,
				});
				return injectToolbar(response, toolbarHtml, routeCache);
			}

			if (toolbarMode === "client" && !isEditor && !preview) {
				return injectBootstrap(response);
			}

			return response;
		});
	}

	if (isEditor) {
		if (toolbarMode === false) {
			return next();
		}

		if (toolbarMode === "client" && !hasEditParam) {
			return injectBootstrap(await next());
		}

		const response = await next();
		const toolbarHtml = renderToolbar({
			editMode: false,
			isPreview: false,
		});
		return injectToolbar(response, toolbarHtml, routeCache);
	}

	return next();
});

export default onRequest;
