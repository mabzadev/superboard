import express, { type Express } from "express";
import type { Request as ExpressRequest } from "express";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { createServer } from "./server.js";

// --- Per-IP rate limiting ---
// Sliding window: track request timestamps per IP, reject when over the limit.
// The backend also rate-limits per OAuth token, but this protects the Express layer
// from unauthenticated floods (e.g., repeated invalid-token requests).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;

const ipRequests = new Map<string, number[]>();

// Clean up stale entries every 5 minutes to keep memory use bounded
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, timestamps] of ipRequests) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) ipRequests.delete(ip);
    else ipRequests.set(ip, recent);
  }
}, 300_000).unref();

// --- Token validation cache ---
// Maps plain Bearer token → expiresAt (ms). Tokens cached for TOKEN_CACHE_TTL_MS
// after successful Rails validation, avoiding a /validate call on every MCP request.
// Trade-off: a revoked token will still work for up to TOKEN_CACHE_TTL_MS after revocation.
// 60s is an acceptable window for interactive token revocation.
const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_VALIDATE_TIMEOUT_MS = 5_000;

const tokenCache = new Map<string, number>();

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, exp] of tokenCache) {
    if (exp <= now) tokenCache.delete(token);
  }
}, 60_000).unref();

function rateLimit(req: ExpressRequest, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  const timestamps = ipRequests.get(ip) ?? [];
  const recent = timestamps.filter((t) => t > cutoff);

  if (recent.length >= RATE_LIMIT_MAX) {
    res.status(429).json({ error: "Too many requests. Try again later." });
    return;
  }

  recent.push(now);
  ipRequests.set(ip, recent);
  next();
}

/** Exported for tests — clear to reset rate limit state between test suites. */
export { ipRequests as _ipRequests };
/** Exported for tests — clear to reset token validation cache between test suites. */
export { tokenCache as _tokenCache };

export function createApp(opengrowApiUrl: string, publicUrl: string): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const publicHostname = new URL(publicUrl).hostname;
  const allowedHostnames = new Set([publicHostname, "localhost", "127.0.0.1", "[::1]"]);

  app.use((req, res, next) => {
    const hostname = hostnameFromAuthority(req.headers.host);
    const origin = req.headers.origin;
    const originHostname = origin ? hostnameFromOrigin(origin) : null;
    if (!hostname || !allowedHostnames.has(hostname) || (origin && (!originHostname || !allowedHostnames.has(originHostname)))) {
      res.status(403).json({ error: "request_origin_not_allowed" });
      return;
    }
    next();
  });

  // --- Request logging ---
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      console.log(
        JSON.stringify({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - start,
        }),
      );
    });
    next();
  });

  // --- OAuth Protected Resource Metadata ---
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: publicUrl,
      authorization_servers: [opengrowApiUrl],
      scopes_supported: ["mcp:full"],
    });
  });

  // --- Health check ---
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  /** Extract Bearer token from Authorization header */
  function getToken(req: ExpressRequest): string | undefined {
    const authHeader = req.headers.authorization;
    return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  }

  /**
   * Require Bearer token on /mcp.
   *
   * Validates the token against the selected OpenGrow API on cache miss.
   * This is CRITICAL: without upfront validation, a stale/expired token would
   * reach a tool handler, which would call the API, receive a 401, throw ApiError,
   * and `runWithAuth` would wrap it as a successful MCP tool response (HTTP 200 with
   * `isError: true`). Claude Code's OAuth client would never see the 401 and never
   * trigger refresh. Validating upfront lets us forward Rails' 401 + WWW-Authenticate
   * header (with `error="invalid_token"`) directly to the client.
   */
  async function requireAuth(
    req: ExpressRequest & { auth?: AuthInfo },
    res: express.Response,
    next: express.NextFunction,
  ) {
    const token = getToken(req);
    if (!token) {
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`,
        )
        .json({ error: "Unauthorized" });
      return;
    }

    // Check cache: tokens validated within TOKEN_CACHE_TTL_MS are trusted.
    const cachedExp = tokenCache.get(token);
    if (cachedExp && cachedExp > Date.now()) {
      req.auth = { token, clientId: "mcp-client", scopes: [] };
      next();
      return;
    }

    // Validate with the selected OpenGrow API.
    let validateRes: Response;
    try {
      validateRes = await fetch(`${opengrowApiUrl}/api/v1/mcp/validate`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TOKEN_VALIDATE_TIMEOUT_MS),
      });
    } catch (err) {
      // Network error, timeout, DNS failure, etc. Return 502 so the client
      // retries later rather than treating it as an auth failure.
      res.status(502).json({
        error: "bad_gateway",
        error_description: `Failed to validate token with backend: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    if (validateRes.ok) {
      tokenCache.set(token, Date.now() + TOKEN_CACHE_TTL_MS);
      req.auth = { token, clientId: "mcp-client", scopes: [] };
      next();
      return;
    }

    if (validateRes.status === 401) {
      // Forward the API's WWW-Authenticate header verbatim (includes error="invalid_token"
      // so Claude Code's OAuth client triggers refresh).
      const wwwAuth = validateRes.headers.get("WWW-Authenticate");
      if (wwwAuth) {
        res.set("WWW-Authenticate", wwwAuth);
      } else {
        res.set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`,
        );
      }
      const body = (await validateRes.json().catch(() => ({ error: "Unauthorized" }))) as unknown;
      res.status(401).json(body);
      return;
    }

    // Other non-2xx from the API (500, 503, ...). Surface as 502 to the client.
    res.status(502).json({
      error: "bad_gateway",
      error_description: `Backend returned unexpected status ${validateRes.status}`,
    });
  }

  // --- MCP Streamable HTTP endpoint ---
  // SDK v2 owns protocol-version negotiation and creates a fresh server per request.
  // The default legacy posture keeps existing 2025 clients stateless while serving the
  // current 2026 protocol from the same tool factory.
  const mcpHandler = createMcpHandler(() => createServer(), {
    legacy: "stateless",
    responseMode: "auto",
    onerror: (error) => console.error(JSON.stringify({ event: "mcp_protocol_error", error: error.message })),
  });
  app.post("/mcp", rateLimit, requireAuth, async (req, res) => {
    await handleMcpRequest(req, res, publicUrl, mcpHandler);
  });

  app.get("/mcp", rateLimit, requireAuth, async (req, res) => {
    await handleMcpRequest(req, res, publicUrl, mcpHandler);
  });

  app.delete("/mcp", rateLimit, requireAuth, async (req, res) => {
    await handleMcpRequest(req, res, publicUrl, mcpHandler);
  });

  return app;
}

async function handleMcpRequest(
  req: ExpressRequest & { auth?: AuthInfo },
  res: express.Response,
  publicUrl: string,
  handler: ReturnType<typeof createMcpHandler>,
): Promise<void> {
  try {
    const request = toWebRequest(req, publicUrl);
    const response = await handler.fetch(request, { authInfo: req.auth });
    res.status(response.status);
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (!response.body) {
      res.end();
      return;
    }
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (error) {
    console.error(JSON.stringify({
      event: "mcp_node_adapter_error",
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!res.headersSent) res.status(500).json({ error: "mcp_transport_error" });
    else res.end();
  }
}

function toWebRequest(req: ExpressRequest, publicUrl: string): globalThis.Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const method = req.method.toUpperCase();
  return new globalThis.Request(new URL(req.originalUrl || req.url, publicUrl), {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" || req.body === undefined
      ? {}
      : { body: JSON.stringify(req.body) }),
  });
}

function hostnameFromAuthority(authority: string | undefined): string | null {
  if (!authority) return null;
  try {
    return new URL(`http://${authority}`).hostname;
  } catch {
    return null;
  }
}

function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}
