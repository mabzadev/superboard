import { describe, expect, it, vi } from "vitest";
import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import worker, { allowedEmbeddableSdkOrigin } from "./index";
import { Env } from "./types";
import { createFakeD1, FakeD1Call } from "./test/fake-d1";

function env(overrides: Partial<Env> = {}): Env {
  const db = createFakeD1((call: FakeD1Call) => {
    if (call.op === "first" && call.sql.includes("FROM instances i")) {
      return call.args[0] === "project-two-key"
        ? { project_id: 202, instance_id: 20, is_test: 0 }
        : { project_id: 101, instance_id: 10, is_test: 0 };
    }
    if (call.op === "first" && call.sql.includes("FROM applications a")) {
      return { id: 1 };
    }
    if (
      call.op === "all" &&
      call.sql.includes("FROM application_account_erasures")
    )
      return [];
    if (
      call.op === "all" &&
      call.sql.includes("FROM analytics_fact_outbox")
    )
      return [];
    if (call.op === "all" && call.sql.includes("FROM projects production"))
      return [];
    if (
      call.op === "all" &&
      call.sql.includes("FROM rpush_notifications rn JOIN rpush_apps ra")
    )
      return [];
    if (call.op === "all" && call.sql.includes("encrypted_")) return [];
    if (
      call.op === "first" &&
      call.sql.includes("FROM instances WHERE api_key = ?")
    )
      return { id: 10 };
    if (
      call.op === "first" &&
      call.sql.includes("FROM projects WHERE instance_id = ? AND is_test = ?")
    )
      return { id: 101 };
    if (call.op === "first" && call.sql.includes("JOIN android_configurations"))
      return { id: 1 };
    if (
      call.op === "first" &&
      call.sql.includes("FROM projects WHERE id = ? AND instance_id = ?")
    ) {
      return {
        id: 101,
        instance_id: 10,
        identifier: "mobile-prod-key",
        is_test: 0,
      };
    }
    if (
      call.op === "first" &&
      call.sql.includes("FROM devices WHERE vendor = ?")
    )
      return null;
    return undefined;
  });
  return {
    DB: db,
    KV: { get: async () => null, put: async () => undefined } as any,
    ENVIRONMENT: "test",
    D1_EXPECTED_MIGRATION: "0057_application_account_erasure.sql",
    SHORTLINK_DOMAIN: "go.test",
    API_DOMAIN: "api.test",
    AUTH_DOMAIN: "auth.test",
    SDK_DOMAIN: "sdk.test",
    CORS_ORIGIN: "*",
    JWT_SECRET: "index-secret",
    ...overrides,
  };
}

describe("Flows SDK CORS", () => {
  it("allows exact HTTP(S) embedding origins and rejects malformed origins", () => {
    expect(allowedEmbeddableSdkOrigin("https://customer.example")).toBe(
      "https://customer.example",
    );
    expect(allowedEmbeddableSdkOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(allowedEmbeddableSdkOrigin("https://customer.example/")).toBe(
      "https://customer.example",
    );
    expect(
      allowedEmbeddableSdkOrigin("https://customer.example/path"),
    ).toBeUndefined();
    expect(allowedEmbeddableSdkOrigin("null")).toBeUndefined();
    expect(allowedEmbeddableSdkOrigin("javascript:alert(1)")).toBeUndefined();
  });
});

describe("Worker scheduled and queue handlers", () => {
  it("reports real API dependency readiness and fails closed when D1 is unavailable", async () => {
    const readyDb = createFakeD1((call) => {
      if (call.op === "first" && call.sql === "SELECT 1 AS ready")
        return { ready: 1 };
      if (call.op === "first" && call.sql.includes("FROM d1_migrations")) {
        return {
          applied_migration_count: 57,
          expected_migration_applied: 1,
          latest_migration: "0057_application_account_erasure.sql",
        };
      }
      return undefined;
    });
    const ready = await worker.fetch?.(
      new Request("https://api.test/health"),
      env({ DB: readyDb }),
      {} as ExecutionContext,
    );
    expect(ready?.status).toBe(200);
    await expect(ready?.json()).resolves.toMatchObject({
      status: "ok",
      dependencies: { d1: "ok", kv: "ok", publicDomains: "configured" },
      schema: {
        status: "current",
        expectedMigration: "0057_application_account_erasure.sql",
        latestMigration: "0057_application_account_erasure.sql",
        appliedMigrationCount: 57,
      },
    });

    const behindDb = createFakeD1((call) => {
      if (call.op === "first" && call.sql === "SELECT 1 AS ready")
        return { ready: 1 };
      if (call.op === "first" && call.sql.includes("FROM d1_migrations")) {
        return {
          applied_migration_count: 55,
          expected_migration_applied: 0,
          latest_migration: "0055_dashboard_auth_rate_limits.sql",
        };
      }
      return undefined;
    });
    const behind = await worker.fetch?.(
      new Request("https://api.test/health"),
      env({ DB: behindDb }),
      {} as ExecutionContext,
    );
    expect(behind?.status).toBe(503);
    await expect(behind?.json()).resolves.toMatchObject({
      status: "degraded",
      reason: "database_schema_not_current",
      schema: { status: "behind" },
      dependencies: { d1: "schema_not_current", kv: "ok" },
    });

    const unavailableDb = createFakeD1(() => undefined);
    const degraded = await worker.fetch?.(
      new Request("https://api.test/health"),
      env({ DB: unavailableDb }),
      {} as ExecutionContext,
    );
    expect(degraded?.status).toBe(503);
    await expect(degraded?.json()).resolves.toMatchObject({
      status: "degraded",
    });
  });

  it.each([
    "/device_for_vendor_id?vendor_id=config-check",
    "/api/v1/sdk/device_for_vendor_id?vendor_id=config-check",
  ])("serves mobile SDK routes on the SDK domain at %s", async (pathname) => {
    const response = await worker.fetch?.(
      new Request(`https://sdk.test${pathname}`, {
        headers: {
          Host: "sdk.test",
          "PROJECT-KEY": "server-api-key",
          PLATFORM: "android",
          IDENTIFIER: "com.opengrow.android",
        },
      }),
      env(),
      {} as ExecutionContext,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ last_seen: null });
  });

  it("returns 404 for SSO routes when the target disables SSO", async () => {
    const response = await worker.fetch?.(
      new Request("https://go.test/api/v1/identity/sso/auth/google_oauth2", {
        method: "POST",
      }),
      env({ SSO_ENABLED: "false" }),
      {} as ExecutionContext,
    );

    expect(response?.status).toBe(404);
  });

  it("proxies the common application identity contract without exposing its Worker", async () => {
    let forwardedUrl = "";
    let forwardedHeaders = new Headers();
    let forwardedBody: unknown;
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        forwardedUrl = String(input);
        forwardedHeaders = new Headers(init?.headers);
        forwardedBody = await new Response(init?.body).json();
        await expect(
          verifyInternalProjectContextRequest(
            new Request(input, {
              method: init?.method,
              headers: init?.headers,
            }),
            "module-secret",
            "identity",
          ),
        ).resolves.toMatchObject({
          ok: true,
          context: {
            projectId: 101,
            projectRef: "10-prod",
            instanceId: 10,
          },
        });
        return Response.json({ path: new URL(forwardedUrl).pathname });
      },
    );
    const response = await worker.fetch?.(
      new Request("https://api.test/auth/signin/apple", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.10",
          "PROJECT-KEY": "project-one-key",
          PLATFORM: "ios",
          IDENTIFIER: "com.example.one",
        },
        body: JSON.stringify({ token: "provider-token" }),
      }),
      env({
        IDENTITY_SERVICE: { fetch } as unknown as Fetcher,
        MODULE_INTERNAL_TOKEN: "module-secret",
      }),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(200);
    expect(new URL(forwardedUrl).pathname).toBe("/auth/signin/apple");
    expect(forwardedHeaders.get("cf-connecting-ip")).toBe("192.0.2.10");
    expect(forwardedHeaders.get("x-project-id")).toBe("101");
    expect(forwardedBody).toEqual({ token: "provider-token" });
  });

  it("fails closed before Identity when initial auth lacks project credentials", async () => {
    const fetch = vi.fn(async () => Response.json({ unexpected: true }));
    const response = await worker.fetch?.(
      new Request("https://api.test/auth/signin/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.test",
          password: "secret",
        }),
      }),
      env({
        IDENTITY_SERVICE: { fetch } as unknown as Fetcher,
        MODULE_INTERNAL_TOKEN: "module-secret",
      }),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "sdk_credentials_required", retryable: false },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves and signs a distinct Identity context for each SDK project", async () => {
    const contexts: Array<{ projectId: number; projectRef: string }> = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const verified = await verifyInternalProjectContextRequest(
          new Request(input, {
            method: init?.method,
            headers: init?.headers,
          }),
          "module-secret",
          "identity",
        );
        expect(verified.ok).toBe(true);
        if (verified.ok) {
          contexts.push({
            projectId: verified.context.projectId,
            projectRef: verified.context.projectRef,
          });
        }
        return Response.json({ accepted: true });
      },
    );
    const testEnv = env({
      IDENTITY_SERVICE: { fetch } as unknown as Fetcher,
      MODULE_INTERNAL_TOKEN: "module-secret",
    });
    for (const projectKey of ["project-one-key", "project-two-key"]) {
      const response = await worker.fetch?.(
        new Request("https://api.test/auth/anonymous", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "PROJECT-KEY": projectKey,
            PLATFORM: "ios",
            IDENTIFIER: "com.example.shared",
          },
          body: JSON.stringify({ installation_id: "shared-installation" }),
        }),
        testEnv,
        {} as ExecutionContext,
      );
      expect(response?.status).toBe(200);
    }
    expect(contexts).toEqual([
      { projectId: 101, projectRef: "10-prod" },
      { projectId: 202, projectRef: "20-prod" },
    ]);
  });

  it("rejects incomplete legacy account deletion before Identity is reached", async () => {
    const fetch = vi.fn(async () => Response.json({ deleted: true }));
    const response = await worker.fetch?.(
      new Request("https://api.test/auth/me", {
        method: "DELETE",
        headers: { authorization: "Bearer legacy-identity-token" },
      }),
      env({ IDENTITY_SERVICE: { fetch } as unknown as Fetcher }),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(410);
    await expect(response?.json()).resolves.toMatchObject({
      error: {
        code: "account_erasure_route_required",
        retryable: false,
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes the files custom domain only to the authenticated Files surface", async () => {
    let forwarded: Request | null = null;
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        forwarded = new Request(input, init);
        return Response.json({ path: new URL(forwarded.url).pathname });
      },
    );
    const response = await worker.fetch?.(
      new Request("https://files.test/v1/files?limit=10", {
        headers: {
          Host: "files.test",
          authorization: "Bearer application-token",
        },
      }),
      env({
        FILES_DOMAIN: "files.test",
        FILES_SERVICE: { fetch } as unknown as Fetcher,
      }),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(200);
    expect(forwarded!.url).toBe("https://service.internal/v1/files?limit=10");
    expect(forwarded!.headers.get("authorization")).toBe(
      "Bearer application-token",
    );
  });

  it("routes the dedicated auth domain only through the private Identity binding", async () => {
    let forwarded: Request | null = null;
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        forwarded = new Request(input, init);
        return new Response("auth", {
          headers: { "set-cookie": "session=opaque; Secure; HttpOnly" },
        });
      },
    );
    const response = await worker.fetch?.(
      new Request("https://auth.test/oauth2/v1/authorize?client_id=dashboard", {
        headers: {
          Host: "auth.test",
          Cookie: "locale=fr",
          Origin: "https://board.test",
        },
      }),
      env({
        IDENTITY_SERVICE: { fetch } as unknown as Fetcher,
      }),
      {} as ExecutionContext,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("set-cookie")).toContain("session=opaque");
    expect(forwarded!.url).toBe(
      "https://identity.internal/oauth2/v1/authorize?client_id=dashboard",
    );
    expect(forwarded!.headers.get("cookie")).toBe("locale=fr");
    expect(forwarded!.headers.get("origin")).toBe("https://board.test");
    expect(forwarded!.headers.get("x-forwarded-host")).toBe("auth.test");
    expect(forwarded!.headers.get("x-superboard-auth-gateway")).toBe("1");
  });

  it("serves the Melody RS256 JWKS on the dedicated auth domain", async () => {
    let forwarded: Request | null = null;
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        forwarded = new Request(input, init);
        return Response.json({ keys: [{ alg: "RS256" }] });
      },
    );
    const response = await worker.fetch?.(
      new Request("https://auth.test/.well-known/jwks.json", {
        headers: { Host: "auth.test" },
      }),
      env({ IDENTITY_SERVICE: { fetch } as unknown as Fetcher }),
      {} as ExecutionContext,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      keys: [{ alg: "RS256" }],
    });
    expect(forwarded!.url).toBe(
      "https://identity.internal/.well-known/jwks.json",
    );
    expect(forwarded!.headers.get("x-superboard-auth-gateway")).toBe("1");
  });

  it("enqueues maintenance work from the scheduled handler when a queue binding exists", async () => {
    const sent: unknown[] = [];
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);
    const testEnv = env({
      MAINTENANCE_QUEUE: {
        send: async (message: unknown) => {
          sent.push(message);
        },
      } as any,
    });

    await worker.scheduled?.({} as any, testEnv, { waitUntil } as any);

    expect(waitUntil).toHaveBeenCalledTimes(4);
    await Promise.all(waitUntil.mock.results.map((result) => result.value));
    expect(sent).toEqual([{ type: "maintenance.run", days: 3 }]);
  });

  it("acks queue messages after successful job dispatch", async () => {
    const message = {
      id: "msg-1",
      body: { type: "push.process", limit: 1 },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await worker.queue?.(
      { queue: "opengrow-push", messages: [message] } as any,
      env(),
      {} as any,
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("retries queue messages after failed job dispatch", async () => {
    const message = {
      id: "msg-2",
      body: { type: "unknown.job" },
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await worker.queue?.(
      { queue: "opengrow-maintenance", messages: [message] } as any,
      env(),
      {} as any,
    );

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it("persists and redacts a DLQ message before acknowledging it", async () => {
    const db = createFakeD1((call) => (call.op === "run" ? true : undefined));
    const message = {
      id: "dead-letter-1",
      body: { type: "maintenance.run", secret: "private-queue-secret" },
      attempts: 9,
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await worker.queue?.(
      { queue: "events-dlq", messages: [message] } as any,
      env({
        DB: db,
        EVENT_DLQ_NAME: "events-dlq",
        PUSH_DLQ_NAME: "push-dlq",
        MAINTENANCE_DLQ_NAME: "maintenance-dlq",
      }),
      {} as any,
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    const inserted = db.calls.find((call) =>
      call.sql.includes("INSERT OR IGNORE INTO platform_dead_letters"),
    );
    expect(inserted?.args[4]).toBe(
      '{"type":"maintenance.run","secret":"[REDACTED]"}',
    );
    expect(inserted?.args[7]).toBe(0);
  });
});
