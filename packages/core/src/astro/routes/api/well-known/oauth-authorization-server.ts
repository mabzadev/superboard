import type { APIRoute } from "astro";
// @ts-ignore - virtual module
import virtualConfig from "virtual:emdash/config";

import { getPublicOrigin } from "#api/public-url.js";
import { VALID_SCOPES } from "#auth/api-tokens.js";

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
	const origin = getPublicOrigin(url, locals.emdash?.config ?? virtualConfig);
	const issuer = `${origin}/_emdash`;

	return Response.json(
		{
			issuer,
			authorization_endpoint: `${origin}/_emdash/oauth/authorize`,
			token_endpoint: `${origin}/_emdash/api/oauth/token`,
			scopes_supported: [...VALID_SCOPES],
			response_types_supported: ["code"],
			grant_types_supported: [
				"authorization_code",
				"refresh_token",
				"urn:ietf:params:oauth:grant-type:device_code",
			],
			code_challenge_methods_supported: ["S256"],
			registration_endpoint: `${origin}/_emdash/api/oauth/register`,
			token_endpoint_auth_methods_supported: ["none"],
			device_authorization_endpoint: `${origin}/_emdash/api/oauth/device/code`,
		},
		{
			headers: {
				"Cache-Control": "public, max-age=3600",
				"Access-Control-Allow-Origin": "*",
			},
		},
	);
};
