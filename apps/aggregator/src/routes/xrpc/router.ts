import { XRPCRouter } from "@atcute/xrpc-server";
import {
	AggregatorGetLatestRelease,
	AggregatorGetPackage,
	AggregatorListReleases,
	AggregatorResolvePackage,
	AggregatorSearchPackages,
} from "@emdash-cms/registry-lexicons";

import {
	getListingPolicy,
	InvalidAcceptedLabelersError,
	validateAcceptedLabelersHeader,
} from "../../listing-policy.js";
import { getLatestRelease } from "./getLatestRelease.js";
import { getPackage } from "./getPackage.js";
import { listReleases } from "./listReleases.js";
import { resolvePackage } from "./resolvePackage.js";
import { searchPackages } from "./searchPackages.js";
import { syncGetRecord } from "./sync-get-record.js";

const NO_STORE = "private, no-store";
const SYNC_GET_RECORD_PATH = "/xrpc/com.atproto.sync.getRecord";

const CORS_HEADERS: Record<string, string> = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-headers": "content-type, atproto-accept-labelers",
	"access-control-expose-headers": "atproto-accept-labelers, content-language",
	"access-control-max-age": "86400",
};

function applyCorsHeaders(headers: Headers): void {
	for (const [name, value] of Object.entries(CORS_HEADERS)) {
		headers.set(name, value);
	}
}

export async function handleXrpc(env: Env, request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith("/xrpc/")) return null;

	if (request.method === "OPTIONS") {
		const headers = new Headers();
		applyCorsHeaders(headers);
		return new Response(null, { status: 204, headers });
	}
	let acceptedLabelers: string | undefined;
	try {
		acceptedLabelers = validateAcceptedLabelersHeader(
			request.headers.get("atproto-accept-labelers"),
			await getListingPolicy(env),
		);
	} catch (error) {
		if (!(error instanceof InvalidAcceptedLabelersError)) throw error;
		const headers = new Headers({ "content-type": "application/json", "cache-control": NO_STORE });
		applyCorsHeaders(headers);
		return new Response(JSON.stringify({ error: "InvalidRequest", message: error.message }), {
			status: 400,
			headers,
		});
	}

	if (url.pathname === SYNC_GET_RECORD_PATH) {
		const response = await syncGetRecord(env, request);
		const headers = new Headers(response.headers);
		if (acceptedLabelers) headers.set("atproto-accept-labelers", acceptedLabelers);
		applyCorsHeaders(headers);
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}

	const router = getRouter(env);
	const response = await router.fetch(request);
	const headers = new Headers(response.headers);
	if (acceptedLabelers) headers.set("atproto-accept-labelers", acceptedLabelers);
	headers.set("cache-control", NO_STORE);
	applyCorsHeaders(headers);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

let cachedRouter: XRPCRouter | null = null;
let cachedEnvRef: Env | null = null;
function getRouter(env: Env): XRPCRouter {
	if (cachedRouter && cachedEnvRef === env) return cachedRouter;
	cachedRouter = createRouter(env);
	cachedEnvRef = env;
	return cachedRouter;
}

function createRouter(env: Env): XRPCRouter {
	const router = new XRPCRouter();
	router.addQuery(AggregatorGetPackage.mainSchema, {
		handler: ({ params }) => getPackage(env, params),
	});
	router.addQuery(AggregatorListReleases.mainSchema, {
		handler: ({ params }) => listReleases(env, params),
	});
	router.addQuery(AggregatorGetLatestRelease.mainSchema, {
		handler: ({ params }) => getLatestRelease(env, params),
	});
	router.addQuery(AggregatorSearchPackages.mainSchema, {
		handler: ({ params }) => searchPackages(env, params),
	});
	router.addQuery(AggregatorResolvePackage.mainSchema, {
		handler: ({ params }) => resolvePackage(env, params),
	});
	return router;
}
