import type { MiddlewareHandler } from "astro";

import { isMcpPath, proxyMcpRequest } from "./lib/mcp-proxy.js";
import { parsePublicEndpoints } from "./lib/public-endpoints.js";
import { getSiteEnv } from "./lib/site-env.js";

export const onRequest: MiddlewareHandler = async (context, next) => {
	if (!isMcpPath(context.url.pathname)) return next();
	const env = getSiteEnv();
	const endpoint = parsePublicEndpoints(env.SUPERBOARD_PUBLIC_ENDPOINTS_JSON).mcp;
	if (!endpoint) return Response.json({ error: "mcp_unconfigured" }, { status: 503 });
	return proxyMcpRequest(context.request, env.MCP_SERVICE, endpoint);
};
