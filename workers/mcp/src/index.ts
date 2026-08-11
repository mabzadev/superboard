import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  preloadSchemas,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { createApiClient, normalizeApiBaseUrl } from "../../../apps/mcp/src/api-client.js";
import { createServer } from "../../../apps/mcp/src/server.js";

preloadSchemas();

export type Env = Omit<Cloudflare.Env, "SUPERBOARD_TARGET"> & {
  SUPERBOARD_TARGET?: string;
};

function deploymentTarget(env: Env): string {
  return env.SUPERBOARD_TARGET || env.OPENGROW_TARGET || "unknown";
}

const MCP_ROUTE = "/mcp";
const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtime = validateRuntime(env);
    const rejected = validateRequestSource(request, runtime.mcpDomain);
    if (rejected) return rejected;

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json(
        {
          status: "ok",
          service: "mcp",
          target: deploymentTarget(env),
          environment: env.ENVIRONMENT,
          transport: "streamable-http",
          stateless: true,
          api: runtime.apiUrl,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (url.pathname === RESOURCE_METADATA_PATH && request.method === "GET") {
      return Response.json(
        {
          resource: runtime.mcpUrl,
          authorization_servers: [runtime.apiUrl],
          bearer_methods_supported: ["header"],
          scopes_supported: ["mcp:full"],
          resource_documentation: `${runtime.apiUrl}/api/v1/mcp/status`,
        },
        { headers: { "cache-control": "public, max-age=300" } },
      );
    }

    if (url.pathname !== MCP_ROUTE) return Response.json({ error: "not_found" }, { status: 404 });
    if (request.method === "OPTIONS") return preflightResponse(request, runtime.mcpDomain);

    const auth = await validateBearer(request, env, runtime);
    if (auth instanceof Response) return auth;

    const apiClient = createApiClient({
      baseUrl: runtime.apiUrl,
      fetcher: (input, init) => env.API_SERVICE.fetch(input, init),
    });
    const handler = createMcpHandler(() => createServer(apiClient), {
      legacy: "stateless",
      responseMode: "auto",
      onerror: (error) => {
        console.error(JSON.stringify({
          event: "mcp_protocol_error",
          target: deploymentTarget(env),
          environment: env.ENVIRONMENT,
          error: error.message,
        }));
      },
    });
    return handler.fetch(request, { authInfo: auth });
  },
};

type RuntimeConfig = {
  apiUrl: string;
  mcpUrl: string;
  mcpDomain: string;
};

function validateRuntime(env: Env): RuntimeConfig {
  const apiUrl = normalizeApiBaseUrl(env.PUBLIC_API_URL, "PUBLIC_API_URL");
  const mcpUrl = normalizeApiBaseUrl(env.PUBLIC_MCP_URL, "PUBLIC_MCP_URL");
  const mcpDomain = String(env.MCP_DOMAIN || "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/u.test(mcpDomain) || mcpDomain.includes("..")) {
    throw new Error("MCP_DOMAIN must be a valid hostname");
  }
  if (new URL(mcpUrl).hostname !== mcpDomain) {
    throw new Error("PUBLIC_MCP_URL and MCP_DOMAIN must identify the same host");
  }
  return { apiUrl, mcpUrl, mcpDomain };
}

function validateRequestSource(request: Request, mcpDomain: string): Response | undefined {
  const allowedHosts = [
    mcpDomain,
    ...LOCAL_HOSTS,
  ];
  return (
    hostHeaderValidationResponse(request, allowedHosts) ??
    originValidationResponse(request, [mcpDomain, ...LOCAL_HOSTS])
  );
}

async function validateBearer(
  request: Request,
  env: Env,
  runtime: RuntimeConfig,
): Promise<AuthInfo | Response> {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/iu.exec(authorization);
  if (!match?.[1]?.trim()) return bearerChallenge(runtime, "invalid_token", "A Bearer token is required");
  const token = match[1].trim();

  let response: Response;
  try {
    response = await env.API_SERVICE.fetch(
      new Request(`${runtime.apiUrl}/api/v1/mcp/validate`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: request.signal,
      }),
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "mcp_token_validation_unavailable",
      target: deploymentTarget(env),
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json(
      { error: "bad_gateway", error_description: "Token validation is temporarily unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  await response.body?.cancel().catch(() => undefined);
  if (response.ok) {
    return {
      token,
      clientId: "opengrow-mcp",
      scopes: ["mcp:full"],
      resource: new URL(runtime.mcpUrl),
    };
  }
  if (response.status === 401 || response.status === 403) {
    return bearerChallenge(runtime, "invalid_token", "The access token is invalid, expired, or revoked");
  }
  return Response.json(
    { error: "bad_gateway", error_description: "Token validation returned an unexpected response" },
    { status: 502, headers: { "cache-control": "no-store" } },
  );
}

function bearerChallenge(runtime: RuntimeConfig, error: string, description: string): Response {
  const metadataUrl = `${runtime.mcpUrl}${RESOURCE_METADATA_PATH}`;
  return Response.json(
    { error, error_description: description },
    {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": `Bearer resource_metadata="${metadataUrl}", scope="mcp:full", error="${error}"`,
      },
    },
  );
}

function preflightResponse(request: Request, mcpDomain: string): Response {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).hostname !== mcpDomain) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "Authorization,Content-Type,MCP-Protocol-Version,MCP-Session-Id",
      vary: "Origin",
    },
  });
}
