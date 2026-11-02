import type { APIRoute } from "astro";
// @ts-ignore - virtual module
import virtualConfig from "virtual:emdash/config";

import { getPublicOrigin } from "#api/public-url.js";
import { VALID_SCOPES } from "#auth/api-tokens.js";

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
	const origin = getPublicOrigin(url, locals.emdash?.config ?? virtualConfig);

	return Response.json(
		{
			resource: `${origin}/_emdash/api/mcp`,
			authorization_servers: [`${origin}/_emdash`],
			scopes_supported: [...VALID_SCOPES],
			bearer_methods_supported: ["header"],
		},
		{
			headers: {
				"Cache-Control": "public, max-age=3600",
				"Access-Control-Allow-Origin": "*",
			},
		},
	);
};
