import { customHeadersInterceptor, resolveCustomHeaders } from "../client/cf-access.js";
import { EmDashClient } from "../client/index.js";
import type { Interceptor } from "../client/transport.js";
import { getCredentials, saveCredentials } from "./credentials.js";

export interface ClientArgs {
	url?: string;
	token?: string;
}

export const connectionArgs = {
	url: {
		type: "string" as const,
		alias: "u",
		description: "EmDash instance URL",
	},
	token: {
		type: "string" as const,
		alias: "t",
		description: "Auth token",
	},
	header: {
		type: "string" as const,
		alias: "H",
		description: 'Custom header "Name: Value" (repeatable, or use EMDASH_HEADERS env)',
	},
	json: {
		type: "boolean" as const,
		description: "Output as JSON",
	},
};

export function createClientFromArgs(args: ClientArgs): EmDashClient {
	const baseUrl = args.url || process.env["EMDASH_URL"] || "http://localhost:4321";
	let token = args.token || process.env["EMDASH_TOKEN"];

	const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
	const cred = !token ? getCredentials(baseUrl) : null;

	const customHeaders = {
		...cred?.customHeaders,
		...resolveCustomHeaders(),
	};

	const extraInterceptors: Interceptor[] = [];
	if (Object.keys(customHeaders).length > 0) {
		extraInterceptors.push(customHeadersInterceptor(customHeaders));
	}

	if (!token && cred) {
		if (new Date(cred.expiresAt) > new Date()) {
			token = cred.accessToken;
		} else {
			return new EmDashClient({
				baseUrl,
				token: cred.accessToken,
				refreshToken: cred.refreshToken,
				onTokenRefresh: (newAccessToken, expiresIn) => {
					saveCredentials(baseUrl, {
						...cred,
						accessToken: newAccessToken,
						expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
					});
				},
				interceptors: extraInterceptors,
			});
		}
	}

	return new EmDashClient({
		baseUrl,
		token,
		devBypass: !token && isLocal,
		interceptors: extraInterceptors,
	});
}
