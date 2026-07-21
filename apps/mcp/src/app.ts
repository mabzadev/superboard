import express, { type Express } from "express";
import type { Request } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createServer } from "./server.js";

// --- Per-IP rate limiting ---
// Sliding window: track request timestamps per IP, reject when over the limit.
// The backend also rate-limits per OAuth token, but this protects the Express layer
// from unauthenticated floods (e.g., repeated invalid-token requests).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;

const ipRequests = new Map<string, number[]>();

// Clean up stale entries every 5 minutes to prevent memory growth
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

function rateLimit(req: Request, res: express.Response, next: express.NextFunction) {
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

export function createApp(grovsApiUrl: string, publicUrl: string): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

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
      authorization_servers: [grovsApiUrl],
      scopes_supported: ["mcp:full"],
    });
  });

  // --- Health check ---
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  /** Extract Bearer token from Authorization header */
  function getToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  }

  /**
   * Require Bearer token on /mcp.
   *
   * Validates the token against Rails `/api/v1/mcp/validate` on cache miss.
   * This is CRITICAL: without upfront validation, a stale/expired token would
   * reach a tool handler, which would call Rails, receive a 401, throw ApiError,
   * and `runWithAuth` would wrap it as a successful MCP tool response (HTTP 200 with
   * `isError: true`). Claude Code's OAuth client would never see the 401 and never
   * trigger refresh. Validating upfront lets us forward Rails' 401 + WWW-Authenticate
   * header (with `error="invalid_token"`) directly to the client.
   */
  async function requireAuth(
    req: Request & { auth?: AuthInfo },
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

    // Validate with Rails.
    let validateRes: Response;
    try {
      validateRes = await fetch(`${grovsApiUrl}/api/v1/mcp/validate`, {
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
      // Forward Rails' WWW-Authenticate header verbatim (includes error="invalid_token"
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

    // Other non-2xx from Rails (500, 503, ...). Surface as 502 to the client.
    res.status(502).json({
      error: "bad_gateway",
      error_description: `Backend returned unexpected status ${validateRes.status}`,
    });
  }

  // --- MCP StreamableHTTP endpoint ---
  // A new McpServer is created per request (stateless). This re-registers all tools each
  // time, but with 16 tools the cost is negligible. The alternative — a shared server
  // instance — would require session management and can't extract per-request auth cleanly.
  app.post("/mcp", rateLimit, requireAuth, async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // --- GET and DELETE are session features, not supported in stateless mode ---
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "SSE session resumption not supported in stateless mode" });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Session management not supported in stateless mode" });
  });

  return app;
}
