import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp, _ipRequests, _tokenCache } from "../app.js";

const app = createApp("https://api.grovs.io", "https://mcp.grovs.io");

// Build a Response-like object for mocking global fetch.
function mockFetchResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  _ipRequests.clear();
  _tokenCache.clear();
  // Default: Rails says token is valid. Individual tests override.
  vi.spyOn(global, "fetch").mockResolvedValue(
    mockFetchResponse(200, { valid: true }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /.well-known/oauth-protected-resource", () => {
  it("returns OAuth metadata with configured URLs", async () => {
    const res = await request(app).get("/.well-known/oauth-protected-resource");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      resource: "https://mcp.grovs.io",
      authorization_servers: ["https://api.grovs.io"],
      scopes_supported: ["mcp:full"],
    });
  });
});

describe("auth middleware", () => {
  it("returns 401 without Authorization header", async () => {
    const res = await request(app).post("/mcp").send({});

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 with non-Bearer Authorization header", async () => {
    const res = await request(app).post("/mcp").set("Authorization", "Basic abc123").send({});

    expect(res.status).toBe(401);
  });

  it("includes WWW-Authenticate header with resource_metadata URL", async () => {
    const res = await request(app).post("/mcp").send({});

    expect(res.headers["www-authenticate"]).toBe(
      'Bearer resource_metadata="https://mcp.grovs.io/.well-known/oauth-protected-resource"',
    );
  });

  it("passes with valid Bearer token (Rails says 200)", async () => {
    // With a valid token, the request reaches the MCP handler.
    // It won't return 401 — it will either process or fail with MCP error.
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer valid-token")
      .set("Content-Type", "application/json")
      .send({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "test", version: "1.0" }, protocolVersion: "2025-03-26" },
      });

    expect(res.status).not.toBe(401);
  });

  // The MCP TS server MUST validate the Bearer token against Rails upfront.
  // Otherwise, Rails' 401 (from the tool handler's API call) gets swallowed by runWithAuth
  // and wrapped in a successful MCP tool response — Claude Code never sees the 401,
  // so OAuthClientProvider.onUnauthorized() never fires and the token is never refreshed.
  it("forwards 401 from Rails when the token is invalid", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse(
        401,
        { error: "Invalid, revoked, or expired token" },
        {
          "WWW-Authenticate":
            'Bearer resource_metadata="https://api.grovs.io/.well-known/oauth-protected-resource", scope="mcp:full", error="invalid_token", error_description="Invalid, revoked, or expired token"',
        },
      ),
    );

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer stale-token")
      .set("Content-Type", "application/json")
      .send({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "test", version: "1.0" }, protocolVersion: "2025-03-26" },
      });

    expect(res.status).toBe(401);
    // Must forward error="invalid_token" so Claude Code's OAuth client triggers a refresh.
    expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');
  });

  it("calls Rails /api/v1/mcp/validate to verify the token", async () => {
    const fetchSpy = vi.mocked(global.fetch);

    await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer some-token")
      .set("Content-Type", "application/json")
      .send({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: { clientInfo: { name: "test", version: "1.0" }, protocolVersion: "2025-03-26" },
      });

    expect(fetchSpy).toHaveBeenCalled();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.grovs.io/api/v1/mcp/validate");
    expect((opts as RequestInit).headers).toMatchObject({ Authorization: "Bearer some-token" });
  });

  it("caches valid tokens so Rails is not called on every request", async () => {
    const fetchSpy = vi.mocked(global.fetch);

    // Two consecutive requests with the same token.
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post("/mcp")
        .set("Authorization", "Bearer cached-token")
        .set("Content-Type", "application/json")
        .send({
          jsonrpc: "2.0",
          method: "initialize",
          id: i + 1,
          params: { clientInfo: { name: "test", version: "1.0" }, protocolVersion: "2025-03-26" },
        });
    }

    // Rails should only have been called once — the second request hits the cache.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when Rails is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer some-token")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(502);
  });
});

describe("GET /mcp", () => {
  it("returns 405 — SSE resumption not supported in stateless mode", async () => {
    const res = await request(app).get("/mcp");

    expect(res.status).toBe(405);
    expect(res.body.error).toContain("not supported");
  });
});

describe("DELETE /mcp", () => {
  it("returns 405 — session cleanup not supported in stateless mode", async () => {
    const res = await request(app).delete("/mcp");

    expect(res.status).toBe(405);
    expect(res.body.error).toContain("not supported");
  });
});

describe("rate limiting", () => {
  it("returns 429 after exceeding 100 requests in a window", async () => {
    // Pre-fill the rate limit bucket for the test IP
    const ip = "::ffff:127.0.0.1";
    const now = Date.now();
    _ipRequests.set(ip, Array.from({ length: 100 }, () => now));

    const res = await request(app).post("/mcp").send({});

    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Too many requests");
  });

  it("allows requests under the limit", async () => {
    // First request should not be rate-limited (gets 401 from auth instead)
    const res = await request(app).post("/mcp").send({});

    expect(res.status).not.toBe(429);
  });
});
