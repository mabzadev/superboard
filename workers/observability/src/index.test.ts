import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

const TOKEN = "observability-test-token";

afterEach(() => vi.unstubAllGlobals());

describe("SuperBoard observability Worker", () => {
  it("writes sanitized Tail Worker trace points", async () => {
    const points: AnalyticsEngineDataPoint[] = [];
    const env = environment(points);
    const event = {
      event: {
        request: {
          method: "GET",
          url: "https://api.example.com/users?token=secret",
          headers: {},
        },
        response: { status: 200 },
      },
      eventTimestamp: Date.now(),
      logs: [],
      exceptions: [],
      diagnosticsChannelEvents: [],
      scriptName: "opengrow-api-dev",
      entrypoint: "default",
      outcome: "ok",
      executionModel: "stateless",
      truncated: false,
      cpuTime: 2.5,
      wallTime: 12,
    } as TraceItem;

    await worker.tail?.([event], env, {} as ExecutionContext);

    expect(points).toHaveLength(1);
    expect(points[0].blobs).toEqual([
      "v1",
      "opengrow-api-dev",
      "default",
      "fetch",
      "GET",
      "/users",
      "200",
      "ok",
      "development",
    ]);
    expect(JSON.stringify(points[0])).not.toContain("secret");
  });

  it("rejects unauthenticated private reads", async () => {
    const response = await worker.fetch?.(
      new Request("https://observability.internal/internal/v1/health"),
      environment([]),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(401);
  });

  it("accepts the previous observability token during API rotation", async () => {
    const response = await worker.fetch?.(
      new Request("https://observability.internal/internal/v1/health", {
        headers: { "x-observability-token": "previous-observability-token" },
      }),
      environment([], {
        OBSERVABILITY_INTERNAL_TOKEN: "new-observability-token",
        OBSERVABILITY_INTERNAL_TOKEN_PREVIOUS: "previous-observability-token",
      }),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(200);
  });

  it("stays healthy in development when optional analytics reads are not configured", async () => {
    const response = await worker.fetch?.(
      new Request("https://observability.internal/internal/v1/health", {
        headers: { "x-observability-token": TOKEN },
      }),
      environment([], {
        CLOUDFLARE_ANALYTICS_ACCOUNT_ID: undefined,
        CLOUDFLARE_ANALYTICS_TOKEN: undefined,
      }),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      status: "degraded",
      analyticsQueryConfigured: false,
    });
  });

  it("returns an empty development summary when optional analytics reads are not configured", async () => {
    const response = await worker.fetch?.(
      new Request("https://observability.internal/internal/v1/summary", {
        headers: { "x-observability-token": TOKEN },
      }),
      environment([], {
        CLOUDFLARE_ANALYTICS_ACCOUNT_ID: undefined,
        CLOUDFLARE_ANALYTICS_TOKEN: undefined,
      }),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      status: "unavailable",
      rows: [],
    });
  });

  it("fails closed without analytics reads outside development", async () => {
    const response = await worker.fetch?.(
      new Request("https://observability.internal/internal/v1/health", {
        headers: { "x-observability-token": TOKEN },
      }),
      environment([], {
        ENVIRONMENT: "production",
        CLOUDFLARE_ANALYTICS_ACCOUNT_ID: undefined,
        CLOUDFLARE_ANALYTICS_TOKEN: undefined,
      }),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ status: "misconfigured" });
  });

  it("queries a bounded, whitelisted Analytics Engine window", async () => {
    const analyticsFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(init?.body)).toContain("INTERVAL '15' MINUTE");
        expect(String(init?.body)).toContain("FROM opengrow_mbza_development");
        return Response.json({
          data: [
            {
              service: "opengrow-api-dev",
              outcome: "ok",
              eventType: "fetch",
              invocations: "4",
              exceptions: "0",
              truncated: "0",
              averageCpuMs: "2.5",
              averageWallMs: "8",
              maximumCpuMs: "4",
              maximumWallMs: "12",
            },
          ],
        });
      },
    );
    vi.stubGlobal("fetch", analyticsFetch);

    const response = await worker.fetch?.(
      new Request(
        "https://observability.internal/internal/v1/summary?window=15",
        {
          headers: { "x-observability-token": TOKEN },
        },
      ),
      environment([]),
      {} as ExecutionContext,
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({
      status: "ok",
      windowMinutes: 15,
      rows: [
        { service: "opengrow-api-dev", invocations: 4, averageCpuMs: 2.5 },
      ],
    });
  });
});

function environment(
  points: AnalyticsEngineDataPoint[],
  overrides: Record<string, unknown> = {},
) {
  return {
    ANALYTICS: {
      writeDataPoint: (point?: AnalyticsEngineDataPoint) => {
        if (point) points.push(point);
      },
    },
    ANALYTICS_DATASET: "opengrow_mbza_development",
    ENVIRONMENT: "development",
    OBSERVABILITY_INTERNAL_TOKEN: TOKEN,
    CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_ANALYTICS_TOKEN: "analytics-read-token",
    ...overrides,
  } as never;
}
