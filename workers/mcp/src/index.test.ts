import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";

function env(validateStatus = 200): Env {
  return {
    ENVIRONMENT: "development",
    OPENGROW_TARGET: "reference",
    MCP_DOMAIN: "mcp.example.test",
    PUBLIC_API_URL: "https://api.example.test",
    PUBLIC_MCP_URL: "https://mcp.example.test",
    API_SERVICE: {
      fetch: vi.fn(async () => Response.json(
        validateStatus === 200 ? { valid: true } : { error: "invalid_token" },
        { status: validateStatus },
      )),
      connect: vi.fn(),
    } as unknown as Fetcher,
  };
}

function mcpRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://mcp.example.test${path}`, {
    ...init,
    headers: { host: "mcp.example.test", ...init.headers },
  });
}

describe("SuperBoard MCP Worker", () => {
  it("publishes target-aware health without authentication", async () => {
    const response = await worker.fetch(mcpRequest("/health"), env());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "mcp",
      transport: "streamable-http",
      stateless: true,
      api: "https://api.example.test",
    });
  });

  it("publishes OAuth protected-resource discovery for the API authorization server", async () => {
    const response = await worker.fetch(
      mcpRequest("/.well-known/oauth-protected-resource"),
      env(),
    );
    await expect(response.json()).resolves.toEqual({
      resource: "https://mcp.example.test",
      authorization_servers: ["https://api.example.test"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:full"],
      resource_documentation: "https://api.example.test/api/v1/mcp/status",
    });
  });

  it("challenges unauthenticated MCP requests with this resource's metadata", async () => {
    const response = await worker.fetch(
      mcpRequest("/mcp", { method: "POST" }),
      env(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"',
    );
  });

  it("rejects an invalid token before protocol dispatch", async () => {
    const runtime = env(401);
    const response = await worker.fetch(
      mcpRequest("/mcp", {
        method: "POST",
        headers: { authorization: "Bearer expired" },
      }),
      runtime,
    );
    expect(response.status).toBe(401);
    expect(runtime.API_SERVICE.fetch).toHaveBeenCalledOnce();
  });

  it("passes a validated token to the current stateless MCP handler", async () => {
    const runtime = env();
    const response = await worker.fetch(
      mcpRequest("/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer valid",
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      }),
      runtime,
    );
    expect(response.status).toBe(200);
    expect(runtime.API_SERVICE.fetch).toHaveBeenCalledOnce();
    expect(await response.text()).toContain('"name":"superboard-mcp"');
  });

  it("rejects a hostile Host before authentication", async () => {
    const runtime = env();
    const response = await worker.fetch(
      new Request("https://attacker.example/mcp", {
        method: "POST",
        headers: { host: "attacker.example", authorization: "Bearer valid" },
      }),
      runtime,
    );
    expect(response.status).toBe(403);
    expect(runtime.API_SERVICE.fetch).not.toHaveBeenCalled();
  });
});
