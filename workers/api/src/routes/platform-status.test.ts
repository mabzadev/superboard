import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth", () => ({ getAuthContext: vi.fn() }));

import { getAuthContext } from "../lib/auth";
import platform from "./platform-status";
import sdkCatalog from "../../../../config/sdk-libraries.json";

const auth = vi.mocked(getAuthContext);

describe("platform status", () => {
  beforeEach(() => {
    auth.mockResolvedValue({ userId: 7, instanceId: 12 } as never);
  });

  it("aggregates common Worker health and database counters for admins", async () => {
    const db = database();
    const healthy = {
      fetch: vi
        .fn()
        .mockImplementation(async () => Response.json({ status: "ok" })),
    };
    const email = {
      fetch: vi.fn().mockResolvedValue(
        Response.json({
          status: "ok",
          schema: currentSchema("0003_email_idempotency.sql", 3),
          metrics: {
            messages: {
              queued: 2,
              sending: 1,
              failed: 3,
              outcomeUnknown: 1,
            },
            deliveries: {
              queued: 4,
              sending: 1,
              failed: 2,
              outcomeUnknown: 1,
            },
            delegatedTransport: { outcomeUnknown: 2 },
            deadLetters: { quarantined: 6, replayed: 4, discarded: 2 },
          },
        }),
      ),
    };
    const marketing = {
      fetch: vi.fn().mockResolvedValue(
        Response.json({
          data: {
            status: "ok",
            schema: currentSchema("0009_application_preferences.sql", 9),
            metrics: {
              content: { scheduled: 2, running: 1 },
              deliveries: {
                pending: 5,
                sending: 2,
                failed: 1,
                bounced: 1,
                complained: 0,
              },
              outbox: { pending: 1, deadLetter: 0 },
              deadLetters: { quarantined: 2 },
            },
          },
        }),
      ),
    };
    const observability = {
      fetch: vi.fn().mockResolvedValue(
        Response.json({
          status: "ok",
          environment: "development",
          dataset: "opengrow_mbza_development",
          windowMinutes: 60,
          generatedAt: "2026-08-08T00:00:00.000Z",
          rows: [
            {
              service: "opengrow-api-dev",
              outcome: "ok",
              eventType: "fetch",
              invocations: 4,
              exceptions: 0,
              truncated: 0,
              averageCpuMs: 2,
              averageWallMs: 8,
              maximumCpuMs: 3,
              maximumWallMs: 12,
            },
          ],
        }),
      ),
    };
    const response = await platform.request(
      "/status",
      {
        headers: { authorization: "Bearer dashboard-token" },
      },
      {
        DB: db,
        KV: {},
        R2: {},
        ENVIRONMENT: "development",
        OPENGROW_TARGET: "mbza-development",
        PLATFORM_WORKERS_JSON: workerCatalog(),
        OPENGROW_RELEASE: "abcdef123456",
        D1_EXPECTED_MIGRATION: "0057_application_account_erasure.sql",
        PUBLIC_ROUTING_MODE: "active",
        API_DOMAIN: "api.mbza.dev",
        SDK_DOMAIN: "sdk.mbza.dev",
        SHORTLINK_DOMAIN: "in.mbza.dev",
        APP_URL: "https://grow.mbza.dev",
        FILES_DOMAIN: "files.mbza.dev",
        BILLING: healthy,
        EMAIL_SERVICE: email,
        MARKETING_MODULE: marketing,
        OBSERVABILITY: observability,
        OBSERVABILITY_INTERNAL_TOKEN: "private-observability-token",
      } as never,
    );
    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.endpoints.shortLinks).toBe("https://in.mbza.dev");
    expect(body.publicSurfaces).toEqual([]);
    expect(body.metrics.users).toBe(3);
    expect(body.metrics.pushDevices).toBe(3);
    expect(body.metrics.notifications).toBe(3);
    expect(body.metrics.notificationMessages).toBe(3);
    expect(body.metrics.rateLimitedAuthKeys).toBe(3);
    expect(body.jobs.pushDeliveries).toEqual({});
    expect(body.jobs.pushCredentials).toEqual({});
    expect(body.jobs.bearerTokenStorage).toEqual({});
    expect(body.jobs.authCredentials).toEqual({});
    expect(body.jobs.accountErasures).toEqual({});
    expect(body.jobs.email).toEqual({
      messagesQueued: 2,
      messagesSending: 1,
      messagesFailed: 3,
      messagesOutcomeUnknown: 1,
      deliveriesQueued: 4,
      deliveriesSending: 1,
      deliveriesFailed: 2,
      deliveriesOutcomeUnknown: 1,
      delegatedTransportOutcomeUnknown: 2,
      deadLettersQuarantined: 6,
      deadLettersReplayed: 4,
      deadLettersDiscarded: 2,
    });
    expect(body.jobs.marketing).toMatchObject({
      campaignsScheduled: 2,
      campaignsRunning: 1,
      deliveriesPending: 5,
      deliveriesFailed: 1,
      outboxPending: 1,
      outboxDeadLetter: 0,
      deadLettersQuarantined: 2,
    });
    expect(body.deployment).toEqual({
      target: "mbza-development",
      release: "abcdef123456",
      publicRouting: "active",
    });
    expect(body.catalog).toEqual({
      schemaVersion: 1,
      status: "ok",
      target: "mbza-development",
      environment: "development",
    });
    expect(body.services).toHaveLength(
      JSON.parse(workerCatalog()).workers.length,
    );
    expect(
      body.services.find((service: any) => service.id === "api"),
    ).toMatchObject({
      workerName: "opengrow-api-dev",
      enabled: true,
      health: { mode: "self", path: "/health" },
      capabilities: expect.arrayContaining(["identity", "billing", "platform"]),
      dependencies: { stores: ["DB", "KV", "R2"] },
    });
    expect(
      body.services.find((service: any) => service.id === "email"),
    ).toMatchObject({
      workerName: "opengrow-email-dev",
      jobs: { messagesQueued: 2, deliveriesFailed: 2 },
    });
    expect(
      body.dataStores.find((store: any) => store.id === "central"),
    ).toMatchObject({
      kind: "D1",
      owner: "api",
      status: "ok",
      schema: currentSchema("0057_application_account_erasure.sql", 57),
    });
    expect(
      body.dataStores.find((store: any) => store.id === "email"),
    ).toMatchObject({ owner: "email", status: "ok" });
    expect(
      body.dataStores.find((store: any) => store.id === "support"),
    ).toMatchObject({ status: "misconfigured" });
    expect(
      body.services.find((service: any) => service.id === "billing").status,
    ).toBe("ok");
    expect(
      body.services.find((service: any) => service.id === "custom").status,
    ).toBe("misconfigured");
    expect(
      body.services.find((service: any) => service.id === "observability")
        .status,
    ).toBe("ok");
    expect(body.runtime.rows[0]).toMatchObject({
      service: "opengrow-api-dev",
      invocations: 4,
    });
    expect(
      body.api.capabilities.map((capability: any) => capability.id),
    ).toContain("files");
    expect(
      body.api.capabilities.map((capability: any) => capability.id),
    ).toContain("support");
    expect(
      body.api.capabilities.map((capability: any) => capability.id),
    ).toContain("custom-jobs");
    expect(
      body.api.capabilities.find(
        (capability: any) => capability.id === "marketing-consent",
      ),
    ).toMatchObject({
      access:
        "Verified application identity; private signed gateway to Marketing",
      entrypoints: ["/api/v1/sdk/marketing/v1/preferences"],
    });
    expect(
      body.api.capabilities.find(
        (capability: any) => capability.id === "email-operations",
      ),
    ).toMatchObject({
      access: "Authenticated Dashboard owner or administrator",
      entrypoints: ["/api/v1/platform/email/*"],
    });
    expect(
      body.api.capabilities.find(
        (capability: any) => capability.id === "files",
      ),
    ).toMatchObject({
      access: "Application JWT on the Files domain or API alias",
      entrypoints: ["Files domain /v1/files/*", "/api/v1/app-files/*"],
    });
    expect(observability.fetch).toHaveBeenCalledWith(
      "https://observability.internal/internal/v1/summary?window=60",
      expect.objectContaining({
        headers: { "x-observability-token": "private-observability-token" },
      }),
    );
  });

  it("distinguishes target-disabled Workers from missing required bindings", async () => {
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        ENVIRONMENT: "development",
        OPENGROW_TARGET: "mbza-development",
        PLATFORM_WORKERS_JSON: workerCatalog(),
      } as never,
    );
    const body = (await response.json()) as any;
    expect(
      body.services.find((service: any) => service.id === "messaging"),
    ).toMatchObject({
      enabled: false,
      status: "disabled",
      workerName: null,
    });
    expect(
      body.services.find((service: any) => service.id === "billing"),
    ).toMatchObject({
      enabled: true,
      status: "misconfigured",
      workerName: "opengrow-billing-dev",
      error: "Required service binding is missing",
    });
  });

  it("includes target-managed Workers and checks their service-binding reachability", async () => {
    const managed = managedWorkerCatalogEntry();
    const managedBinding = {
      fetch: vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Method not allowed" }, { status: 405 }),
        ),
    };
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        ENVIRONMENT: "development",
        OPENGROW_TARGET: "mbza-development",
        PLATFORM_WORKERS_JSON: workerCatalog([managed]),
        MANAGED_VOCALS_ORCHESTRATOR: managedBinding,
      } as never,
    );
    const body = (await response.json()) as any;
    expect(body.catalog.status).toBe("ok");
    expect(
      body.services.find(
        (service: any) => service.id === "managed-vocals-orchestrator",
      ),
    ).toMatchObject({
      kind: "managed",
      workerName: "send-users-vocals-orchestrator-dev",
      status: "ok",
      health: { mode: "binding", path: "/health" },
      capabilities: [
        "workflow:VocalProcessingWorkflow",
        "container:Standard",
        "durable-object:Dispatcher",
      ],
      routes: ["POST /"],
      dependencies: {
        services: ["custom"],
        stores: ["DB", "customR2"],
        queues: ["workflow:send-users-vocals-workflows-dev"],
      },
      jobs: null,
    });
    expect(managedBinding.fetch).toHaveBeenCalledWith(
      "https://managed-vocals-orchestrator.internal/health",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it("fails closed when the target Worker catalog is malformed", async () => {
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        ENVIRONMENT: "development",
        OPENGROW_TARGET: "mbza-development",
        PLATFORM_WORKERS_JSON: '{"schemaVersion":1,"target":"other"}',
      } as never,
    );
    const body = (await response.json()) as any;
    expect(body.status).toBe("degraded");
    expect(body.catalog).toMatchObject({
      status: "misconfigured",
      error: "Worker catalog does not match this target and environment",
    });
  });

  it("marks a mismatched custom Worker protocol or target as incompatible", async () => {
    const custom = {
      fetch: vi.fn(async (request: Request | string) => {
        const path = new URL(
          typeof request === "string" ? request : request.url,
        ).pathname;
        if (path === "/health") return Response.json({ status: "ok" });
        if (path.endsWith("/manifest")) {
          return Response.json({
            protocolVersion: 1,
            appKey: "wrong-target",
            service: "custom-wrong",
            version: "1.0.0",
            description: "Wrong custom Worker",
            capabilities: [],
          });
        }
        return Response.json({
          status: "ok",
          generatedAt: "2026-08-09T00:00:00.000Z",
          jobs: {},
          capabilities: {},
        });
      }),
    };
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        CUSTOM_WORKER: custom,
        CUSTOM_WORKER_TOKEN: "custom-secret",
        ENVIRONMENT: "development",
        OPENGROW_TARGET: "mbza-development",
        OPENGROW_RELEASE: "test",
        API_DOMAIN: "api.mbza.dev",
        SDK_DOMAIN: "sdk.mbza.dev",
        SHORTLINK_DOMAIN: "in.mbza.dev",
        APP_URL: "https://grow.mbza.dev",
      } as never,
    );
    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.custom).toMatchObject({
      status: "incompatible",
      error: "Expected custom protocol v2 for mbza-development",
    });
  });

  it("fails closed on a malformed custom Worker operator contract", async () => {
    const custom = {
      fetch: vi.fn(async (request: Request | string) => {
        const path = new URL(
          typeof request === "string" ? request : request.url,
        ).pathname;
        if (path === "/health") return Response.json({ status: "ok" });
        if (path.endsWith("/manifest")) {
          return Response.json({
            protocolVersion: 2,
            appKey: "mbza-development",
            capabilities: "not-an-array",
          });
        }
        return Response.json({ status: "ok", jobs: "not-an-object" });
      }),
    };
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        CUSTOM_WORKER: custom,
        CUSTOM_WORKER_TOKEN: "custom-secret",
        ENVIRONMENT: "development",
        OPENGROW_TARGET: "mbza-development",
        OPENGROW_RELEASE: "test",
        API_DOMAIN: "api.mbza.dev",
        SDK_DOMAIN: "sdk.mbza.dev",
        SHORTLINK_DOMAIN: "in.mbza.dev",
        APP_URL: "https://grow.mbza.dev",
      } as never,
    );
    const body = (await response.json()) as any;
    expect(body.status).toBe("degraded");
    expect(body.custom).toEqual({
      status: "incompatible",
      manifest: null,
      stats: null,
      error: "Custom Worker returned an invalid manifest contract",
    });
  });

  it("rejects malformed custom cancellation and refund telemetry", async () => {
    const custom = {
      fetch: vi.fn(async (request: Request | string) => {
        const path = new URL(
          typeof request === "string" ? request : request.url,
        ).pathname;
        if (path === "/health") return Response.json({ status: "ok" });
        if (path.endsWith("/manifest")) {
          return Response.json({
            protocolVersion: 2,
            appKey: "mbza-development",
            service: "custom-reference",
            version: "1.2.0",
            description: "Reference custom Worker",
            capabilities: [],
          });
        }
        return Response.json({
          status: "ok",
          generatedAt: "2026-08-09T00:00:00.000Z",
          jobs: {},
          capabilities: {},
          cancellations: {
            jobs: 1,
            refundsPending: "one",
            refundsApplied: 0,
            creditsRefunded: 0,
          },
        });
      }),
    };
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        CUSTOM_WORKER: custom,
        CUSTOM_WORKER_TOKEN: "custom-secret",
        ENVIRONMENT: "development",
        OPENGROW_TARGET: "mbza-development",
        OPENGROW_RELEASE: "test",
        API_DOMAIN: "api.mbza.dev",
        SDK_DOMAIN: "sdk.mbza.dev",
        SHORTLINK_DOMAIN: "in.mbza.dev",
        APP_URL: "https://grow.mbza.dev",
      } as never,
    );
    const body = (await response.json()) as any;
    expect(body.custom).toMatchObject({
      status: "incompatible",
      error: "Custom Worker returned an invalid stats contract",
    });
  });

  it("checks public routes independently from private Worker bindings", async () => {
    const publicFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        return url.includes("reference.example.test")
          ? new Response("offline", { status: 503 })
          : Response.json({ status: "ok" });
      });
    try {
      const response = await platform.request(
        "/status",
        { headers: { authorization: "Bearer dashboard-token" } },
        {
          DB: database(),
          ENVIRONMENT: "development",
          PUBLIC_SURFACES_JSON: JSON.stringify([
            {
              id: "api",
              url: "https://api.example.test",
              healthUrl: "https://api.example.test/health",
              description: "API",
            },
            {
              id: "reference",
              url: "https://reference.example.test",
              description: "Reference",
            },
          ]),
        } as never,
      );
      const body = (await response.json()) as any;
      expect(body.status).toBe("degraded");
      expect(body.publicSurfaces).toEqual([
        expect.objectContaining({ id: "api", status: "ok", httpStatus: 200 }),
        expect.objectContaining({
          id: "reference",
          status: "degraded",
          httpStatus: 503,
        }),
      ]);
    } finally {
      publicFetch.mockRestore();
    }
  });

  it("fails closed on unsafe or malformed public surface monitors", async () => {
    const publicFetch = vi.spyOn(globalThis, "fetch");
    try {
      const response = await platform.request(
        "/status",
        { headers: { authorization: "Bearer dashboard-token" } },
        {
          DB: database(),
          ENVIRONMENT: "development",
          PUBLIC_SURFACES_JSON: JSON.stringify([
            null,
            {
              id: "loopback",
              url: "https://127.0.0.1",
              description: "Unsafe loopback monitor",
            },
            {
              id: "split-origin",
              url: "https://public.example.test",
              healthUrl: "https://health.example.test/health",
              description: "Mismatched health endpoint",
            },
          ]),
        } as never,
      );
      const body = (await response.json()) as any;
      expect(response.status).toBe(200);
      expect(body.status).toBe("degraded");
      expect(body.publicSurfaces).toEqual([
        expect.objectContaining({
          id: "configuration",
          status: "misconfigured",
        }),
        expect.objectContaining({
          id: "loopback",
          status: "misconfigured",
        }),
        expect.objectContaining({
          id: "split-origin",
          status: "misconfigured",
        }),
      ]);
      expect(publicFetch).not.toHaveBeenCalled();
    } finally {
      publicFetch.mockRestore();
    }
  });

  it("degrades instead of inventing zero job metrics from an incomplete healthy service", async () => {
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        ENVIRONMENT: "development",
        EMAIL_SERVICE: {
          fetch: vi.fn().mockResolvedValue(Response.json({ status: "ok" })),
        },
      } as never,
    );
    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.jobs.email).toBeNull();
    expect(
      body.services.find((service: any) => service.id === "email"),
    ).toMatchObject({ status: "ok" });
  });

  it("treats an unknown service health contract as degraded", async () => {
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        ENVIRONMENT: "development",
        APP_MODULE: {
          fetch: vi.fn().mockResolvedValue(Response.json({ service: "app" })),
        },
      } as never,
    );
    const body = (await response.json()) as any;
    expect(body.status).toBe("degraded");
    expect(
      body.services.find((service: any) => service.id === "app"),
    ).toMatchObject({ status: "degraded" });
  });

  it("fails closed when a D1 service reports healthy without a current schema", async () => {
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        ENVIRONMENT: "development",
        D1_EXPECTED_MIGRATION: "0057_application_account_erasure.sql",
        APP_MODULE: {
          fetch: vi.fn().mockResolvedValue(Response.json({ status: "ok" })),
        },
      } as never,
    );
    const body = (await response.json()) as any;
    expect(body.status).toBe("degraded");
    expect(
      body.services.find((service: any) => service.id === "app"),
    ).toMatchObject({ status: "ok" });
    expect(
      body.dataStores.find((store: any) => store.id === "app"),
    ).toMatchObject({ status: "degraded", schema: null });
  });

  it("degrades when persisted central job state cannot be queried", async () => {
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: databaseWithUnavailableJobs(),
        ENVIRONMENT: "development",
        D1_EXPECTED_MIGRATION: "0057_application_account_erasure.sql",
      } as never,
    );
    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.api.status).toBe("ok");
    expect(body.jobs).toMatchObject({
      billingExports: null,
      failedPurchases: null,
      platformDeadLetters: null,
      pushDeliveries: null,
      pushCredentials: null,
      bearerTokenStorage: null,
      authCredentials: null,
    });
    expect(
      body.dataStores.find((store: any) => store.id === "central"),
    ).toMatchObject({ status: "ok" });
  });

  it("rejects non-admin members", async () => {
    const db = database("member");
    const response = await platform.request(
      "/status",
      {
        headers: { authorization: "Bearer dashboard-token" },
      },
      { DB: db } as never,
    );
    expect(response.status).toBe(403);
  });

  it("serves the Git-owned SDK and FlutterFlow catalog only to administrators", async () => {
    const response = await platform.request(
      "/libraries",
      {
        headers: { authorization: "Bearer dashboard-token" },
      },
      { DB: database() } as never,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.data.releasePolicy).toBe("immutable-tag");
    expect(body.data.libraries).toEqual(sdkCatalog.libraries);
    expect(
      body.data.libraries.find((library: any) => library.id === "flutterflow"),
    ).toMatchObject({
      license: "MIT",
      licensePath: "sdks/flutterflow/LICENSE",
    });
    expect(body.data.customCode.actions.support).toContain(
      "opengrowSupportInitializeAuthenticated",
    );
    expect(body.data.customCode.actions.purchases).toContain(
      "opengrowGetEntitlements",
    );
    expect(body.data.customCode.streams.support).toContain(
      "opengrowSupportEventJsonStream",
    );
    expect(body.data.customCode.sourceFiles.flutterflow).toContain(
      "sdks/flutterflow/lib/opengrow_flutterflow.dart",
    );
    expect(body.data.flutterFlowLibrary).toMatchObject({
      owner: "opengrow-platform",
      displayName: "OpenGrow",
      releasePolicy: "immutable-tag-only",
      remoteProject: {
        projectIdVariable: "FF_LIBRARY_PROJECT_ID",
        apiKeySecret: "FF_API_KEY",
        githubEnvironment: "flutterflow-library",
      },
    });
    expect(body.data.flutterFlowLibrary.dependencies).toHaveLength(2);
    expect(body.data.flutterFlowLibrary.actions.support).toContain(
      "opengrowSupportDispose",
    );
    expect(body.data.flutterFlowLibrary.forbiddenAppState).toContain(
      "opengrowApplicationAccessToken",
    );
    expect(JSON.stringify(body)).not.toMatch(/chatwoot/i);

    const denied = await platform.request(
      "/libraries",
      {
        headers: { authorization: "Bearer dashboard-token" },
      },
      { DB: database("member") } as never,
    );
    expect(denied.status).toBe(403);
  });

  it("lists tenant-scoped account erasures without exposing user identifiers", async () => {
    const bindings: unknown[][] = [];
    const fullHash =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const db = databaseWithAccountErasures(bindings, fullHash);
    const response = await platform.request(
      "/account-erasures?status=failed&project_id=20&limit=25",
      { headers: { authorization: "Bearer dashboard-token" } },
      { DB: db } as never,
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.data).toEqual([
      {
        id: "erase-1",
        projectId: 20,
        projectRef: "vocostar",
        subjectReference: "0123456789ab",
        status: "failed",
        completedSteps: ["app", "marketing"],
        attempts: 3,
        lastErrorCode: "support_unavailable",
        lastErrorService: "support",
        requestedAt: "2026-08-10T08:00:00.000Z",
        updatedAt: "2026-08-10T08:03:00.000Z",
        completedAt: null,
      },
    ]);
    expect(bindings).toContainEqual([12, "failed", "failed", 20, 20, 25]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fullHash);
    expect(serialized).not.toContain("raw-application-user-id");
  });

  it("validates account-erasure filters before querying operation rows", async () => {
    const env = { DB: database() } as never;
    for (const path of [
      "/account-erasures?status=unknown",
      "/account-erasures?project_id=0",
      "/account-erasures?project_id=12.5",
      "/account-erasures?limit=0",
      "/account-erasures?limit=101",
    ]) {
      const response = await platform.request(
        path,
        { headers: { authorization: "Bearer dashboard-token" } },
        env,
      );
      expect(response.status, path).toBe(422);
    }
  });

  it("restricts account-erasure operations to platform administrators", async () => {
    const response = await platform.request(
      "/account-erasures",
      { headers: { authorization: "Bearer dashboard-token" } },
      { DB: database("member") } as never,
    );
    expect(response.status).toBe(403);
  });

  it("propagates a service-reported degraded state", async () => {
    const response = await platform.request(
      "/status",
      {
        headers: { authorization: "Bearer dashboard-token" },
      },
      {
        DB: database(),
        ENVIRONMENT: "development",
        SUPPORT_MODULE: {
          fetch: vi.fn().mockResolvedValue(
            Response.json({
              data: {
                service: "support",
                status: "degraded",
                reason: "database_health_unavailable",
              },
            }),
          ),
        },
      } as never,
    );
    const body = (await response.json()) as any;
    expect(body.status).toBe("degraded");
    expect(
      body.services.find((service: any) => service.id === "support"),
    ).toMatchObject({
      status: "degraded",
      detail: { data: { reason: "database_health_unavailable" } },
    });
  });

  it("marks the platform and API degraded when central D1 metrics fail", async () => {
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: databaseWithUnavailableMetrics(),
        ENVIRONMENT: "development",
      } as never,
    );
    const body = (await response.json()) as any;
    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.api.status).toBe("degraded");
    expect(
      body.dataStores.find((store: any) => store.id === "central"),
    ).toMatchObject({ status: "degraded" });
    expect(body.metrics).toMatchObject({
      users: null,
      instances: null,
      projects: null,
      activeOauthTokens: null,
      pushDevices: null,
      notifications: null,
      notificationMessages: null,
      rateLimitedAuthKeys: null,
    });
  });

  it("rejects oversized or malformed observability summaries without buffering them", async () => {
    const oversized = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        OBSERVABILITY_INTERNAL_TOKEN: "private-observability-token",
        OBSERVABILITY: {
          fetch: vi.fn().mockResolvedValue(
            new Response("x".repeat(512 * 1024 + 1), {
              headers: { "content-type": "application/json" },
            }),
          ),
        },
      } as never,
    );
    const oversizedBody = (await oversized.json()) as any;
    expect(oversizedBody.status).toBe("degraded");
    expect(
      oversizedBody.services.find(
        (service: any) => service.id === "observability",
      ),
    ).toMatchObject({
      status: "unavailable",
      error: "Observability summary response is too large",
    });

    const malformed = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        OBSERVABILITY_INTERNAL_TOKEN: "private-observability-token",
        OBSERVABILITY: {
          fetch: vi.fn().mockResolvedValue(Response.json({ status: "ok" })),
        },
      } as never,
    );
    const malformedBody = (await malformed.json()) as any;
    expect(
      malformedBody.services.find(
        (service: any) => service.id === "observability",
      ),
    ).toMatchObject({
      status: "unavailable",
      error: "Observability returned an invalid summary contract",
    });
  });

  it("rejects an oversized custom Worker operator response", async () => {
    const custom = {
      fetch: vi.fn(async (request: Request | string) => {
        const path = new URL(
          typeof request === "string" ? request : request.url,
        ).pathname;
        if (path === "/health") return Response.json({ status: "ok" });
        if (path.endsWith("/manifest")) {
          return new Response("x".repeat(64 * 1024 + 1), {
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({
          status: "ok",
          generatedAt: "2026-08-09T00:00:00.000Z",
          jobs: {},
          capabilities: {},
        });
      }),
    };
    const response = await platform.request(
      "/status",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        CUSTOM_WORKER: custom,
        CUSTOM_WORKER_TOKEN: "custom-secret",
        OPENGROW_TARGET: "mbza-development",
      } as never,
    );
    const body = (await response.json()) as any;
    expect(body.status).toBe("degraded");
    expect(body.custom).toMatchObject({
      status: "unavailable",
      error: "Custom Worker manifest response is too large",
    });
  });

  it("proxies custom job inspection and retry only for platform admins", async () => {
    const db = database();
    const custom = {
      fetch: vi.fn(async (request: Request | string) => {
        const url = new URL(
          typeof request === "string" ? request : request.url,
        );
        if (url.pathname.endsWith("/retry")) {
          return Response.json(
            { id: "job-1", status: "dispatched" },
            { status: 202 },
          );
        }
        return Response.json({
          jobs: [{ id: "job-1", status: "failed" }],
          nextCursor: null,
        });
      }),
    };
    const env = {
      DB: db,
      CUSTOM_WORKER: custom,
      CUSTOM_WORKER_TOKEN: "custom-secret",
    } as never;
    const list = await platform.request(
      "/custom/jobs?status=failed",
      {
        headers: { authorization: "Bearer dashboard-token" },
      },
      env,
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ jobs: [{ id: "job-1" }] });
    expect(custom.fetch).toHaveBeenNthCalledWith(
      1,
      "https://custom.internal/internal/v1/jobs?status=failed",
      expect.objectContaining({
        headers: { "x-custom-worker-token": "custom-secret" },
      }),
    );
    const retry = await platform.request(
      "/custom/jobs/job-1/retry",
      {
        method: "POST",
        headers: { authorization: "Bearer dashboard-token" },
      },
      env,
    );
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({
      id: "job-1",
      status: "dispatched",
    });
  });

  it("bounds custom Worker operator proxy responses", async () => {
    const response = await platform.request(
      "/custom/jobs",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        DB: database(),
        CUSTOM_WORKER: {
          fetch: vi.fn().mockResolvedValue(
            new Response("x".repeat(2 * 1024 * 1024 + 1), {
              headers: { "content-type": "application/json" },
            }),
          ),
        },
        CUSTOM_WORKER_TOKEN: "custom-secret",
      } as never,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "custom_worker_unavailable",
    });
  });

  it("proxies body-free email operations and audited DLQ decisions only for admins", async () => {
    const email = {
      fetch: vi.fn(async (request: Request | string) => {
        const url = new URL(
          typeof request === "string" ? request : request.url,
        );
        if (url.pathname.endsWith("/replay")) {
          return Response.json(
            { id: "dead-letter-1", status: "replayed", messageId: "mail-1" },
            { status: 202 },
          );
        }
        return Response.json({
          generatedAt: "2026-08-10T10:00:00.000Z",
          messages: [{ id: "mail-1", status: "failed" }],
          deadLetters: [{ id: "dead-letter-1", status: "quarantined" }],
        });
      }),
    };
    const env = {
      DB: database(),
      EMAIL_SERVICE: email,
      EMAIL_INTERNAL_TOKEN: "email-internal-secret",
    } as never;
    const list = await platform.request(
      "/email/operations?status=failed",
      { headers: { authorization: "Bearer dashboard-token" } },
      env,
    );
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      messages: [{ id: "mail-1", status: "failed" }],
      deadLetters: [{ id: "dead-letter-1" }],
    });
    expect(email.fetch).toHaveBeenNthCalledWith(
      1,
      "https://email.internal/internal/v1/operations?status=failed",
      expect.objectContaining({
        headers: { "x-internal-token": "email-internal-secret" },
      }),
    );

    const replay = await platform.request(
      "/email/dead-letters/dead-letter-1/replay",
      {
        method: "POST",
        headers: { authorization: "Bearer dashboard-token" },
      },
      env,
    );
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({ status: "replayed" });

    const denied = await platform.request(
      "/email/operations",
      { headers: { authorization: "Bearer dashboard-token" } },
      {
        ...env,
        DB: database("member"),
      } as never,
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({ error: "admin_required" });
  });
});

function database(role = "admin") {
  return {
    prepare(sql: string) {
      const statement = {
        bind: (..._values: unknown[]) => statement,
        async first() {
          if (sql.includes("FROM instance_roles")) return { role };
          if (sql.includes("FROM d1_migrations"))
            return migrationLedger("0057_application_account_erasure.sql", 57);
          if (sql.includes("COUNT(*) total")) return { total: 3 };
          return null;
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function databaseWithAccountErasures(bindings: unknown[][], fullHash: string) {
  return {
    prepare(sql: string) {
      const statement = {
        bind: (...values: unknown[]) => {
          bindings.push(values);
          return statement;
        },
        async first() {
          if (sql.includes("FROM instance_roles")) return { role: "admin" };
          return null;
        },
        async all() {
          if (!sql.includes("FROM application_account_erasures")) {
            return { results: [] };
          }
          return {
            results: [
              {
                id: "erase-1",
                project_id: 20,
                project_ref: "vocostar",
                application_user_id: "raw-application-user-id",
                application_user_hash: fullHash,
                status: "failed",
                completed_steps_json:
                  '["app","marketing",42,"NOT VALID","toolongtoolongtoolongtoolongtoolong"]',
                attempts: 3,
                last_error_code: "support_unavailable",
                last_error_service: "support",
                requested_at: "2026-08-10T08:00:00.000Z",
                updated_at: "2026-08-10T08:03:00.000Z",
                completed_at: null,
              },
            ],
          };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function databaseWithUnavailableMetrics() {
  return {
    prepare(sql: string) {
      const statement = {
        bind: (..._values: unknown[]) => statement,
        async first() {
          if (sql.includes("FROM instance_roles")) return { role: "admin" };
          throw new Error("D1 unavailable");
        },
        async all() {
          throw new Error("D1 unavailable");
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function databaseWithUnavailableJobs() {
  return {
    prepare(sql: string) {
      const statement = {
        bind: (..._values: unknown[]) => statement,
        async first() {
          if (sql.includes("FROM instance_roles")) return { role: "admin" };
          if (sql.includes("FROM d1_migrations"))
            return migrationLedger("0057_application_account_erasure.sql", 57);
          if (sql.includes("COUNT(*) total")) return { total: 3 };
          return null;
        },
        async all() {
          throw new Error("Job tables unavailable");
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function migrationLedger(latestMigration: string, count: number) {
  return {
    applied_migration_count: count,
    expected_migration_applied: 1,
    latest_migration: latestMigration,
  };
}

function currentSchema(expectedMigration: string, count: number) {
  return {
    status: "current",
    expectedMigration,
    latestMigration: expectedMigration,
    appliedMigrationCount: count,
  };
}

function workerCatalog(managedWorkers: unknown[] = []) {
  const ids = [
    "api",
    "dashboard",
    "billing",
    "messaging",
    "email",
    "identity",
    "files",
    "observability",
    "mcp",
    "custom",
    "app",
    "products",
    "paywalls",
    "dynamic-links",
    "support",
    "marketing",
    "onboardings",
  ];
  return JSON.stringify({
    schemaVersion: 1,
    target: "mbza-development",
    environment: "development",
    workers: [
      ...ids.map((id) => ({
        id,
        workerName: id === "messaging" ? null : `opengrow-${id}-dev`,
        enabled: id !== "messaging",
        publicSurfaceIds:
          id === "api"
            ? ["api", "sdk", "shortlinks"]
            : id === "dashboard" || id === "mcp"
              ? [id]
              : [],
      })),
      ...managedWorkers,
    ],
    customDependencies: [],
  });
}

function managedWorkerCatalogEntry() {
  return {
    id: "managed-vocals-orchestrator",
    workerName: "send-users-vocals-orchestrator-dev",
    enabled: true,
    publicSurfaceIds: [],
    managed: {
      binding: "MANAGED_VOCALS_ORCHESTRATOR",
      description: "Target-managed vocal workflow",
      workflow: "send-users-vocals-workflows-dev",
      workflowClass: "VocalProcessingWorkflow",
      containers: [{ className: "Standard", instanceType: "standard-1" }],
      durableObjects: [{ className: "Dispatcher", storage: "legacy-kv" }],
      stores: ["DB", "customR2"],
    },
  };
}
