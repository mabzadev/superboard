import type { APIContext, APIRoute } from "astro";
import * as document from "emdash/routes/api/content/_collection_/_id_";
import * as publish from "emdash/routes/api/content/_collection_/_id_/publish";
import * as revisions from "emdash/routes/api/content/_collection_/_id_/revisions";
import * as documents from "emdash/routes/api/content/_collection_/index";
import * as taxonomies from "emdash/routes/api/taxonomies/index";

const documentPath =
	/^\/_emdash\/api\/content\/([a-z][a-z0-9_]*)(?:\/([^/]+)(?:\/(publish|revisions))?)?$/u;

export async function dispatchContentPluginApi(
	context: APIContext,
	request: Request,
): Promise<Response> {
	const url = new URL(request.url);
	const match = documentPath.exec(url.pathname);
	let params: Record<string, string | undefined> = {};
	let routes: Partial<Record<string, APIRoute>>;
	if (url.pathname === "/_emdash/api/taxonomies") routes = { GET: taxonomies.GET };
	else if (match && match[1] !== "views") {
		params = { collection: match[1], id: match[2] ? decodeURIComponent(match[2]) : undefined };
		routes =
			match[3] === "publish"
				? { POST: publish.POST }
				: match[3] === "revisions"
					? { GET: revisions.GET }
					: match[2]
						? { GET: document.GET, PUT: document.PUT }
						: { GET: documents.GET, POST: documents.POST };
	} else return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	const handler = routes[request.method];
	if (!handler) return Response.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
	return handler({ ...context, params, request, url });
}
