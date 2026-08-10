import { describe, expect, it, vi } from "vitest";
import {
  verifyInternalProjectContextRequest,
  verifyProjectContextSignature,
} from "@opengrow/contracts/project-context";
import { signToken } from "./crypto";
import { app } from "../index";
import type { Env } from "../types";
import { createFakeD1, type FakeD1Call } from "../test/fake-d1";
import {
  extractDomainRoute,
  resolveAuthorizedProjectContext,
  resolveSdkProjectContext,
} from "./domain-modules";

const INTERNAL_SECRET = "internal-module-secret-for-unit-tests";

describe("domain module route contract", () => {
  it.each([
    [
      "https://api.test/api/v1/marketing/projects/10-prod/email/subscribers",
      undefined,
      "10-prod",
      "/internal/v1/email/subscribers",
    ],
    [
      "https://api.test/api/v1/marketing/10-test/statistics",
      undefined,
      "10-test",
      "/internal/v1/statistics",
    ],
    ["https://api.test/api/v1/marketing", "10-prod", "10-prod", "/internal/v1"],
    [
      "https://api.test/api/v1/marketing/10-prod/email/subscribers",
      "10-prod",
      "10-prod",
      "/internal/v1/email/subscribers",
    ],
  ])(
    "maps %s to the exact internal route",
    (url, projectHeader, projectRef, internalPath) => {
      const headers = projectHeader
        ? { "X-Project-Id": projectHeader }
        : undefined;
      expect(
        extractDomainRoute(new Request(url, { headers }), "marketing"),
      ).toEqual({ ok: true, projectRef, internalPath });
    },
  );

  it("rejects ambiguous project context", () => {
    const result = extractDomainRoute(
      new Request(
        "https://api.test/api/v1/marketing/projects/10-prod/statistics",
        { headers: { "X-Project-Ref": "10-test" } },
      ),
      "marketing",
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "project_context_conflict",
    });
  });

  it("resolves the numeric D1 project id while authorizing the instance", async () => {
    const db = createFakeD1((call) => {
      if (call.sql.includes("INNER JOIN instance_roles")) {
        expect(call.args).toEqual([7, 10, 0]);
        return { project_id: 11, instance_id: 10, is_test: 0, role: "owner" };
      }
      return undefined;
    });

    await expect(
      resolveAuthorizedProjectContext(db, 7, "10-prod"),
    ).resolves.toEqual({
      ok: true,
      context: {
        projectId: 11,
        projectRef: "10-prod",
        instanceId: 10,
        environment: "production",
        role: "owner",
      },
    });
  });
});

describe("gateway to domain service binding", () => {
  it("blocks module writes while allowing reads during project cutover", async () => {
    const fetch = vi.fn(async () => Response.json({ data: [] }));
    const testEnv = gatewayEnv(
      {
        APP_MODULE: { fetch } as unknown as Fetcher,
      },
      true,
      true,
    );
    const token = await accessToken(testEnv);

    const write = await app.request(
      "/api/v1/app/projects/10-prod/customers",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "cutover-write",
        },
        body: JSON.stringify({ external_id: "customer-1" }),
      },
      testEnv,
    );
    expect(write.status).toBe(503);
    await expect(write.json()).resolves.toMatchObject({
      error: { code: "maintenance_read_only", retryable: true },
    });
    expect(fetch).not.toHaveBeenCalled();

    const read = await app.request(
      "/api/v1/app/projects/10-prod/customers",
      { headers: { Authorization: `Bearer ${token}` } },
      testEnv,
    );
    expect(read.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("forwards a signed, canonical context and fixes the root route", async () => {
    let internalRequest: Request | undefined;
    const testEnv = gatewayEnv({
      ONBOARDINGS_MODULE: {
        fetch: vi.fn(async (request: Request) => {
          internalRequest = request;
          return Response.json({ data: [] });
        }),
      } as unknown as Fetcher,
    });
    const token = await accessToken(testEnv);
    const response = await app.request(
      "/api/v1/onboardings/projects/10-test",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-Id": "gateway-root-test",
        },
      },
      testEnv,
    );

    expect(response.status).toBe(200);
    expect(internalRequest?.url).toBe(
      "https://onboardings.internal/internal/v1",
    );
    expect(internalRequest?.headers.get("x-project-id")).toBe("12");
    expect(internalRequest?.headers.get("x-project-ref")).toBe("10-test");
    expect(internalRequest?.headers.get("x-instance-id")).toBe("10");
    expect(internalRequest?.headers.get("x-environment")).toBe("test");
    expect(internalRequest?.headers.get("x-actor-id")).toBe("7");
    expect(internalRequest?.headers.get("x-role")).toBe("owner");
    expect(internalRequest?.headers.get("authorization")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("gateway-root-test");
    const verification = await verifyInternalProjectContextRequest(
      internalRequest!,
      INTERNAL_SECRET,
      "onboardings",
    );
    expect(verification).toMatchObject({
      ok: true,
      context: {
        projectId: 12,
        projectRef: "10-test",
        requestId: "gateway-root-test",
      },
    });
    if (!verification.ok) throw new Error("Expected a valid project context");
    await expect(
      verifyProjectContextSignature(
        verification.context,
        INTERNAL_SECRET,
        internalRequest!.headers.get("x-context-signature")!,
        verification.context.issuedAt + 61,
      ),
    ).resolves.toBe(false);

    const tamperedHeaders = new Headers(internalRequest!.headers);
    tamperedHeaders.set("X-Project-Id", "99");
    const tampered = await verifyInternalProjectContextRequest(
      new Request(internalRequest!, { headers: tamperedHeaders }),
      INTERNAL_SECRET,
      "onboardings",
    );
    expect(tampered).toMatchObject({
      ok: false,
      code: "project_context_signature_invalid",
    });
  });

  it("supports the currently deployed project-ref path without forwarding it", async () => {
    let internalRequest: Request | undefined;
    const testEnv = gatewayEnv({
      MARKETING_MODULE: {
        fetch: vi.fn(async (request: Request) => {
          internalRequest = request;
          return Response.json({ data: [] });
        }),
      } as unknown as Fetcher,
    });
    const token = await accessToken(testEnv);
    const response = await app.request(
      "/api/v1/marketing/10-prod/email/subscribers?status=enabled",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Project-Id": "10-prod",
        },
      },
      testEnv,
    );

    expect(response.status).toBe(200);
    expect(internalRequest?.url).toBe(
      "https://marketing.internal/internal/v1/email/subscribers?status=enabled",
    );
    expect(internalRequest?.headers.get("x-project-id")).toBe("11");
  });

  it("returns a correlated error envelope when access is denied", async () => {
    const testEnv = gatewayEnv({}, false);
    const token = await accessToken(testEnv);
    const response = await app.request(
      "/api/v1/marketing/projects/10-prod/statistics",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-Id": "denied-request",
        },
      },
      testEnv,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "project_forbidden",
        message: "Project access denied",
        status: 403,
        request_id: "denied-request",
      },
    });
  });

  it("requires idempotency before forwarding mutations", async () => {
    const fetch = vi.fn(async () => Response.json({ data: {} }));
    const testEnv = gatewayEnv({
      MARKETING_MODULE: { fetch } as unknown as Fetcher,
    });
    const token = await accessToken(testEnv);
    const response = await app.request(
      "/api/v1/marketing/projects/10-prod/campaigns",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Launch" }),
      },
      testEnv,
    );

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "idempotency_key_required" },
    });
  });

  it("does not require idempotency for POST-based resolver reads", async () => {
    const fetch = vi.fn(async () => Response.json({ data: null }));
    const testEnv = gatewayEnv({
      PRODUCTS_MODULE: { fetch } as unknown as Fetcher,
    });
    const token = await accessToken(testEnv);
    const response = await app.request(
      "/api/v1/products/projects/10-prod/offerings/resolve",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ placement: "default" }),
      },
      testEnv,
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps service binding failures to a retryable gateway error", async () => {
    const testEnv = gatewayEnv({
      APP_MODULE: {
        fetch: vi.fn(async () => {
          throw new Error("binding unavailable");
        }),
      } as unknown as Fetcher,
    });
    const token = await accessToken(testEnv);
    const response = await app.request(
      "/api/v1/app/projects/10-prod/customers",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-Id": "binding-failure",
        },
      },
      testEnv,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "module_request_failed",
        message: "app service request failed",
        status: 502,
        request_id: "binding-failure",
        retryable: true,
      },
    });
  });
});

describe("Access Key SDK module gateway", () => {
  it.each([
    {
      moduleName: "app" as const,
      bindingName: "APP_MODULE" as const,
      publicPath: "/api/v1/app/runtime-policy",
      internalPath: "/internal/v1/runtime-policy/resolve",
    },
    {
      moduleName: "products" as const,
      bindingName: "PRODUCTS_MODULE" as const,
      publicPath: "/api/v1/products/offerings/resolve",
      internalPath: "/internal/v1/offerings/resolve",
    },
    {
      moduleName: "paywalls" as const,
      bindingName: "PAYWALLS_MODULE" as const,
      publicPath: "/api/v1/paywalls/resolve",
      internalPath: "/internal/v1/placements/resolve",
    },
    {
      moduleName: "onboardings" as const,
      bindingName: "ONBOARDINGS_MODULE" as const,
      publicPath: "/api/v1/onboardings/resolve",
      internalPath: "/internal/v1/placements/resolve",
    },
  ])(
    "authenticates and resolves $publicPath without a Bearer session",
    async ({ moduleName, bindingName, publicPath, internalPath }) => {
      let internalRequest: Request | undefined;
      const fetch = vi.fn(async (request: Request) => {
        internalRequest = request;
        return Response.json({ data: null });
      });
      const testEnv = sdkGatewayEnv({
        [bindingName]: { fetch } as unknown as Fetcher,
      });
      const response = await app.request(
        `https://sdk.test${publicPath}`,
        {
          method: "POST",
          headers: sdkHeaders(),
          body: JSON.stringify({ placement: "default" }),
        },
        testEnv,
      );

      expect(response.status).toBe(200);
      expect(internalRequest?.url).toBe(
        `https://${moduleName}.internal${internalPath}`,
      );
      expect(internalRequest?.headers.get("project-key")).toBeNull();
      expect(internalRequest?.headers.get("x-api-key")).toBeNull();
      expect(internalRequest?.headers.get("authorization")).toBeNull();
      expect(internalRequest?.headers.get("x-project-id")).toBe("11");
      expect(internalRequest?.headers.get("x-project-ref")).toBe("10-prod");
      expect(internalRequest?.headers.get("x-actor-id")).toBe("0");
      expect(internalRequest?.headers.get("x-role")).toBe("sdk");
      const verification = await verifyInternalProjectContextRequest(
        internalRequest!,
        INTERNAL_SECRET,
        moduleName,
      );
      expect(verification).toMatchObject({
        ok: true,
        context: {
          projectId: 11,
          projectRef: "10-prod",
          instanceId: 10,
          environment: "production",
          actorId: 0,
          role: "sdk",
        },
      });
    },
  );

  it("does not accept a Bearer session in place of SDK credentials", async () => {
    const fetch = vi.fn(async () => Response.json({ data: null }));
    const testEnv = sdkGatewayEnv({
      PAYWALLS_MODULE: { fetch } as unknown as Fetcher,
    });
    const response = await app.request(
      "https://sdk.test/api/v1/paywalls/resolve",
      {
        method: "POST",
        headers: {
          Host: "sdk.test",
          Authorization: "Bearer dashboard-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ placement: "default" }),
      },
      testEnv,
    );

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "sdk_credentials_required" },
    });
  });

  it.each([
    ["ios", "com.opengrow.ios"],
    ["web", "app.opengrow.test"],
  ])(
    "validates the configured %s application identity",
    async (platform, identifier) => {
      const testEnv = sdkGatewayEnv({});
      const request = new Request("https://sdk.test/api/v1/paywalls/resolve", {
        method: "POST",
        headers: sdkHeaders({ PLATFORM: platform, IDENTIFIER: identifier }),
        body: JSON.stringify({ placement: "default" }),
      });

      await expect(
        resolveSdkProjectContext(testEnv.DB, request),
      ).resolves.toMatchObject({
        ok: true,
        context: { projectId: 11, projectRef: "10-prod" },
        platform,
        identifier,
      });
    },
  );

  it("isolates the test project selected by the prefixed Access Key", async () => {
    let internalRequest: Request | undefined;
    const testEnv = sdkGatewayEnv({
      ONBOARDINGS_MODULE: {
        fetch: vi.fn(async (request: Request) => {
          internalRequest = request;
          return Response.json({ data: null });
        }),
      } as unknown as Fetcher,
    });
    const response = await app.request(
      "https://sdk.test/api/v1/onboardings/resolve",
      {
        method: "POST",
        headers: sdkHeaders({ "PROJECT-KEY": "test_access-key" }),
        body: JSON.stringify({ placement: "first-run" }),
      },
      testEnv,
    );

    expect(response.status).toBe(200);
    expect(internalRequest?.headers.get("x-project-id")).toBe("12");
    expect(internalRequest?.headers.get("x-project-ref")).toBe("10-test");
    expect(internalRequest?.headers.get("x-environment")).toBe("test");
  });

  it("rejects an Access Key from another project", async () => {
    const fetch = vi.fn(async () => Response.json({ data: null }));
    const testEnv = sdkGatewayEnv(
      { PRODUCTS_MODULE: { fetch } as unknown as Fetcher },
      { validProject: false },
    );
    const response = await app.request(
      "https://sdk.test/api/v1/products/offerings/resolve",
      {
        method: "POST",
        headers: sdkHeaders({ "PROJECT-KEY": "foreign-key" }),
        body: JSON.stringify({ placement: "default" }),
      },
      testEnv,
    );

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "sdk_credentials_invalid" },
    });
  });

  it("rejects an application identifier not configured for the project", async () => {
    const fetch = vi.fn(async () => Response.json({ data: null }));
    const testEnv = sdkGatewayEnv(
      { PAYWALLS_MODULE: { fetch } as unknown as Fetcher },
      { validApplication: false },
    );
    const response = await app.request(
      "https://sdk.test/api/v1/paywalls/resolve",
      {
        method: "POST",
        headers: sdkHeaders({ IDENTIFIER: "com.foreign.app" }),
        body: JSON.stringify({ placement: "default" }),
      },
      testEnv,
    );

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "sdk_application_forbidden" },
    });
  });

  it.each([
    ["app", "APP_MODULE", "/api/v1/app/events", "/internal/v1/customer-events"],
    [
      "paywalls",
      "PAYWALLS_MODULE",
      "/api/v1/paywalls/events",
      "/internal/v1/events",
    ],
    [
      "onboardings",
      "ONBOARDINGS_MODULE",
      "/api/v1/onboardings/events",
      "/internal/v1/events",
    ],
  ] as const)(
    "requires and forwards idempotency for %s events",
    async (moduleName, bindingName, publicPath, internalPath) => {
      const fetch = vi.fn(async () => Response.json({ data: { accepted: 1 } }));
      const testEnv = sdkGatewayEnv({
        [bindingName]: { fetch } as unknown as Fetcher,
      });
      const missing = await app.request(
        `https://sdk.test${publicPath}`,
        {
          method: "POST",
          headers: sdkHeaders(),
          body: JSON.stringify({ events: [{ id: "event-1", type: "view" }] }),
        },
        testEnv,
      );
      expect(missing.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();

      const accepted = await app.request(
        `https://sdk.test${publicPath}`,
        {
          method: "POST",
          headers: sdkHeaders({ "Idempotency-Key": "events-batch-1" }),
          body: JSON.stringify({ events: [{ id: "event-1", type: "view" }] }),
        },
        testEnv,
      );
      expect(accepted.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(1);
      const forwarded = fetch.mock.calls[0][0] as Request;
      expect(forwarded.url).toBe(
        `https://${moduleName}.internal${internalPath}`,
      );
      expect(forwarded.headers.get("idempotency-key")).toBe("events-batch-1");
      await expect(forwarded.json()).resolves.toEqual({
        events: [{ id: "event-1", type: "view" }],
      });
    },
  );
});

describe("public Marketing gateway", () => {
  it.each([
    [
      "GET",
      "/api/v1/marketing/tracking/open/signed-token",
      "/public/v1/tracking/open/signed-token",
    ],
    [
      "GET",
      "/api/v1/marketing/tracking/click/signed-token?source=email",
      "/public/v1/tracking/click/signed-token?source=email",
    ],
    [
      "POST",
      "/api/v1/marketing/tracking/unsubscribe/signed-token",
      "/public/v1/tracking/unsubscribe/signed-token",
    ],
    [
      "GET",
      "/api/v1/marketing/opt-in/confirmation-token",
      "/public/v1/opt-in/confirmation-token",
    ],
    [
      "POST",
      "/api/v1/marketing/opt-in/confirmation-token",
      "/public/v1/opt-in/confirmation-token",
    ],
    [
      "POST",
      "/api/v1/marketing/provider-webhooks/provider-1",
      "/public/v1/provider-webhooks/provider-1",
    ],
  ])(
    "forwards %s %s without a Dashboard session",
    async (method, publicPath, internalPath) => {
      let forwarded: Request | undefined;
      const environment = gatewayEnv({
        MARKETING_MODULE: {
          fetch: vi.fn(async (request: Request) => {
            forwarded = request;
            return new Response(null, { status: 204 });
          }),
        } as unknown as Fetcher,
      });
      const response = await app.request(
        publicPath,
        {
          method,
          headers: { "X-Webhook-Secret": "provider-secret" },
        },
        environment,
      );
      expect(response.status).toBe(204);
      expect(
        new URL(forwarded!.url).pathname + new URL(forwarded!.url).search,
      ).toBe(internalPath);
      expect(forwarded?.headers.get("x-webhook-secret")).toBe(
        "provider-secret",
      );
      expect(forwarded?.headers.get("authorization")).toBeNull();
    },
  );
});

describe("public Support realtime gateway", () => {
  it("forwards a one-use realtime ticket without a Dashboard bearer token", async () => {
    let forwarded: Request | undefined;
    const environment = gatewayEnv({
      SUPPORT_MODULE: {
        fetch: vi.fn(async (request: Request) => {
          forwarded = request;
          return new Response(null, { status: 204 });
        }),
      } as unknown as Fetcher,
    });
    const response = await app.request(
      "/api/v1/support/realtime/signed-ticket",
      {
        headers: { Upgrade: "websocket", Connection: "Upgrade" },
      },
      environment,
    );
    expect(response.status).toBe(204);
    expect(new URL(forwarded!.url).pathname).toBe(
      "/public/v1/realtime/signed-ticket",
    );
    expect(forwarded?.headers.get("upgrade")).toBe("websocket");
    expect(forwarded?.headers.get("authorization")).toBeNull();
  });

  it("forwards the authenticated application Support API through api.<app>", async () => {
    let forwarded: Request | undefined;
    const environment = gatewayEnv({
      SUPPORT_MODULE: {
        fetch: vi.fn(async (request: Request) => {
          forwarded = request;
          return Response.json({ data: [] });
        }),
      } as unknown as Fetcher,
    });
    const response = await app.request(
      "/api/v1/support-client/conversations?limit=25",
      {
        headers: {
          Authorization: "Bearer application-identity",
          "X-OpenGrow-Project-Id": "12",
        },
      },
      environment,
    );
    expect(response.status).toBe(200);
    const target = new URL(forwarded!.url);
    expect(`${target.pathname}${target.search}`).toBe(
      "/v1/conversations?limit=25",
    );
    expect(forwarded?.headers.get("authorization")).toBe(
      "Bearer application-identity",
    );
    expect(forwarded?.headers.get("x-opengrow-project-id")).toBe("12");
  });
});

function gatewayEnv(
  overrides: Partial<Env> = {},
  hasAccess = true,
  maintenance = false,
): Env {
  const db = createFakeD1((call: FakeD1Call) => {
    if (call.sql.includes("FROM oauth_access_tokens")) {
      return {
        resource_owner_id: 7,
        application_id: 1,
        expires_in: 7_200,
        revoked_at: null,
        scopes: "read write",
        created_at: new Date(Date.now() - 60_000).toISOString(),
      };
    }
    if (call.sql.includes("INNER JOIN instance_roles")) {
      if (!hasAccess) return null;
      const isTest = call.args[2] === 1;
      return {
        project_id: isTest ? 12 : 11,
        instance_id: 10,
        is_test: isTest ? 1 : 0,
        role: "owner",
      };
    }
    if (call.sql.includes("SELECT id FROM projects WHERE instance_id")) {
      return { id: 11 };
    }
    if (call.sql.includes("FROM module_cutover_maintenance")) {
      return maintenance ? { enabled: 1 } : null;
    }
    throw new Error(`Unexpected D1 query: ${call.sql}`);
  });
  return {
    DB: db,
    KV: {} as KVNamespace,
    ENVIRONMENT: "test",
    SHORTLINK_DOMAIN: "go.test",
    API_DOMAIN: "api.test",
    SDK_DOMAIN: "sdk.test",
    CORS_ORIGIN: "*",
    JWT_SECRET: "gateway-jwt-secret",
    MODULE_INTERNAL_TOKEN: INTERNAL_SECRET,
    ...overrides,
  };
}

async function accessToken(environment: Env): Promise<string> {
  return signToken(
    { sub: 7, instanceId: 10, type: "access" },
    environment,
    "2h",
  );
}

function sdkGatewayEnv(
  overrides: Partial<Env>,
  options: { validProject?: boolean; validApplication?: boolean } = {},
): Env {
  const db = createFakeD1((call: FakeD1Call) => {
    if (
      call.sql.includes("FROM instances i") &&
      call.sql.includes("INNER JOIN projects p")
    ) {
      if (options.validProject === false) return null;
      const isTest = call.args[1] === 1;
      return {
        project_id: isTest ? 12 : 11,
        instance_id: 10,
        is_test: isTest ? 1 : 0,
      };
    }
    if (
      call.sql.includes("android_configurations") ||
      call.sql.includes("ios_configurations") ||
      call.sql.includes("web_configurations") ||
      call.sql.includes("desktop_configurations")
    ) {
      expect(call.args[0]).toBe(10);
      return options.validApplication === false ? null : { id: 1 };
    }
    throw new Error(`Unexpected SDK D1 query: ${call.sql}`);
  });
  return {
    DB: db,
    KV: {} as KVNamespace,
    ENVIRONMENT: "test",
    SHORTLINK_DOMAIN: "go.test",
    API_DOMAIN: "api.test",
    SDK_DOMAIN: "sdk.test",
    CORS_ORIGIN: "*",
    JWT_SECRET: "gateway-jwt-secret",
    MODULE_INTERNAL_TOKEN: INTERNAL_SECRET,
    ...overrides,
  };
}

function sdkHeaders(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    Host: "sdk.test",
    "PROJECT-KEY": "access-key",
    PLATFORM: "android",
    IDENTIFIER: "com.opengrow.app",
    "Content-Type": "application/json",
    ...overrides,
  };
}
