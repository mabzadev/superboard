import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";
import type { AppVariables, Env } from "../types";
import customSdk from "./custom-sdk";

describe("custom SDK jobs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("derives project, subject and scoped idempotency while stripping client identity fields", async () => {
    const fixture = await identityFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [fixture.publicJwk] })),
    );
    const response = await probe().request(
      "/jobs",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await fixture.token("user-42")}`,
          "content-type": "application/json",
          "idempotency-key": "mobile-request-1",
          "x-request-id": "request-1",
        },
        body: JSON.stringify({
          capability: "vocostar.media.convert",
          payload: { userId: "attacker", mediaType: "text" },
        }),
      },
      fixture.env,
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(fixture.custom.fetch).toHaveBeenCalledOnce();
    const [url, init] = fixture.custom.fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://custom.internal/internal/v1/jobs");
    const headers = new Headers(init.headers);
    expect(headers.get("x-custom-worker-token")).toBe("custom-secret");
    expect(headers.get("x-custom-worker-project")).toBe("10-prod");
    expect(headers.get("x-custom-worker-subject")).toBe("user-42");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      projectRef: "10-prod",
      capability: "vocostar.media.convert",
      payload: { mediaType: "text" },
    });
    expect(body.payload).not.toHaveProperty("userId");
    expect(body.idempotencyKey).toMatch(/^sdk:v1:[a-f0-9]{64}$/);
    expect(body.idempotencyKey).not.toContain("mobile-request-1");
  });

  it("requires a verified application identity and never reaches the custom Worker on failure", async () => {
    const fixture = await identityFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [fixture.publicJwk] })),
    );
    const response = await probe().request(
      "/jobs",
      {
        method: "POST",
        headers: {
          authorization: "Bearer invalid",
          "content-type": "application/json",
          "idempotency-key": "mobile-request-2",
        },
        body: JSON.stringify({
          capability: "vocostar.voice.clone",
          payload: {},
        }),
      },
      fixture.env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "identity_invalid" },
    });
    expect(fixture.custom.fetch).not.toHaveBeenCalled();
  });

  it("reports Identity key outages as retryable dependency failures", async () => {
    const fixture = await identityFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    const response = await probe().request(
      "/jobs",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${await fixture.token("user-42")}`,
          "content-type": "application/json",
          "idempotency-key": "mobile-request-3",
        },
        body: JSON.stringify({
          capability: "vocostar.voice.clone",
          payload: {},
        }),
      },
      fixture.env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "identity_unavailable", retryable: true },
    });
    expect(fixture.custom.fetch).not.toHaveBeenCalled();
  });

  it("scopes reads to the verified subject and only forwards documented filters", async () => {
    const fixture = await identityFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [fixture.publicJwk] })),
    );
    const response = await probe().request(
      "/jobs?status=failed&limit=10&admin=true",
      {
        headers: { authorization: `Bearer ${await fixture.token("user-43")}` },
      },
      fixture.env,
    );

    expect(response.status).toBe(200);
    const [url, init] = fixture.custom.fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://custom.internal/internal/v1/jobs?limit=10&status=failed",
    );
    expect(new Headers(init.headers).get("x-custom-worker-subject")).toBe(
      "user-43",
    );
    expect(new Headers(init.headers).get("x-custom-worker-project")).toBe(
      "10-prod",
    );
  });

  it("scopes job detail to the verified subject and validates opaque identifiers", async () => {
    const fixture = await identityFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [fixture.publicJwk] })),
    );
    const authorization = `Bearer ${await fixture.token("user-44")}`;
    const response = await probe().request(
      "/jobs/job-1",
      { headers: { authorization } },
      fixture.env,
    );

    expect(response.status).toBe(200);
    const [url, init] = fixture.custom.fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://custom.internal/internal/v1/jobs/job-1");
    expect(new Headers(init.headers).get("x-custom-worker-subject")).toBe(
      "user-44",
    );
    expect(new Headers(init.headers).get("x-custom-worker-project")).toBe(
      "10-prod",
    );

    fixture.custom.fetch.mockClear();
    const invalid = await probe().request(
      "/jobs/-admin",
      { headers: { authorization } },
      fixture.env,
    );
    expect(invalid.status).toBe(422);
    expect(fixture.custom.fetch).not.toHaveBeenCalled();
  });

  it("scopes cancellation to the verified subject and project", async () => {
    const fixture = await identityFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [fixture.publicJwk] })),
    );
    fixture.custom.fetch.mockResolvedValueOnce(
      Response.json({ id: "job-1", status: "cancelled" }, { status: 202 }),
    );
    const response = await probe().request(
      "/jobs/job-1/cancel",
      {
        method: "POST",
        headers: { authorization: `Bearer ${await fixture.token("user-45")}` },
      },
      fixture.env,
    );

    expect(response.status).toBe(202);
    const [url, init] = fixture.custom.fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://custom.internal/internal/v1/jobs/job-1/cancel");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("x-custom-worker-subject")).toBe("user-45");
    expect(headers.get("x-custom-worker-project")).toBe("10-prod");

    fixture.custom.fetch.mockClear();
    const invalid = await probe().request(
      "/jobs/-admin/cancel",
      {
        method: "POST",
        headers: { authorization: `Bearer ${await fixture.token("user-45")}` },
      },
      fixture.env,
    );
    expect(invalid.status).toBe(422);
    expect(fixture.custom.fetch).not.toHaveBeenCalled();
  });
});

function probe() {
  const app = new Hono<{
    Bindings: Env;
    Variables: AppVariables & { customRequestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("projectId", 11);
    c.set("instanceId", 10);
    await next();
  });
  app.route("/", customSdk);
  return app;
}

async function identityFixture() {
  const issuer = "https://identity.example.test";
  const audience = "opengrow";
  const jwksUrl = "https://identity.example.test/.well-known/jwks.json";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: "identity-1", alg: "RS256", use: "sig" });
  const cache = new Map<string, unknown>();
  const custom = {
    fetch: vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json(
        init?.method === "POST"
          ? { id: "job-1", status: "queued" }
          : { jobs: [], nextCursor: null },
        { status: init?.method === "POST" ? 202 : 200 },
      ),
    ),
  };
  const db = {
    prepare(sql: string) {
      const statement = {
        bind: (..._values: unknown[]) => statement,
        async first() {
          if (sql.includes("FROM projects WHERE id")) {
            return { id: 11, instance_id: 10, is_test: 0 };
          }
          if (sql.includes("FROM billing_oidc_configs")) return null;
          return null;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  const env = {
    DB: db,
    KV: {
      get: async (key: string) => cache.get(key) || null,
      put: async (key: string, value: string) => {
        cache.set(key, JSON.parse(value));
      },
    } as unknown as KVNamespace,
    CUSTOM_WORKER: custom,
    CUSTOM_WORKER_TOKEN: "custom-secret",
    AUTH_GATEWAY_ISSUER: issuer,
    AUTH_GATEWAY_AUDIENCE: audience,
    AUTH_GATEWAY_JWKS_URL: jwksUrl,
  } as unknown as Env;
  const token = (subject: string) =>
    new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "identity-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  return { env, custom, publicJwk, token };
}
