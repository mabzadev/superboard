import { describe, expect, it } from "vitest";
import {
  signProjectContext,
  type InternalProjectContext,
} from "@opengrow/contracts";
import app from "./index";

describe("dynamic-links worker", () => {
  it("publishes a versioned health endpoint", async () => {
    const response = await app.request("/internal/v1/health", {}, healthyEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: {
        service: "dynamic-links",
        version: "v1",
        status: "ok",
        storage: "d1",
        schema: schema(),
      },
    });
  });

  it("reports D1 failures without leaking their message", async () => {
    const response = await app.request(
      "/internal/v1/health",
      {},
      env({
        prepare: () => ({
          first: async () => {
            throw new Error("private database error");
          },
        }),
      } as unknown as D1Database),
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('"status":"degraded"');
    expect(body).toContain('"reason":"database_health_unavailable"');
    expect(body).not.toContain("private database error");
  });

  it("rejects unsigned project traffic", async () => {
    const response = await app.request(
      "/internal/v1/missing",
      { headers: { "x-internal-token": "secret", "x-project-id": "12" } },
      env(),
    );
    expect(response.status).toBe(403);
  });

  it("accepts a canonical signed project context", async () => {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const context: InternalProjectContext = {
      module: "dynamic-links",
      method: "GET",
      pathname: "/internal/v1/missing",
      projectId: 12,
      projectRef: "10-test",
      instanceId: 10,
      environment: "test",
      actorId: 2,
      role: "owner",
      requestId: "dynamic-request",
      issuedAt,
    };
    const response = await app.request(
      context.pathname,
      { headers: await headers(context) },
      env(),
    );
    expect(response.status).toBe(404);
  });
});

async function headers(context: InternalProjectContext) {
  return {
    "x-internal-token": "secret",
    "x-project-id": String(context.projectId),
    "x-project-ref": context.projectRef,
    "x-instance-id": String(context.instanceId),
    "x-environment": context.environment,
    "x-actor-id": String(context.actorId),
    "x-role": context.role,
    "x-request-id": context.requestId,
    "x-context-issued-at": String(context.issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, "secret"),
  };
}
function env(database = {} as D1Database): Env {
  return {
    DB: database,
    D1_EXPECTED_MIGRATION: "0003_campaign_analytics.sql",
    INTERNAL_API_TOKEN: "secret",
  };
}
function healthyEnv(): Env {
  return env({
    prepare: (query: string) => {
      const first = async () =>
        query.includes("opengrow_health_check")
          ? { opengrow_health_check: 1 }
          : {
              applied_migration_count: 3,
              expected_migration_applied: 1,
              latest_migration: "0003_campaign_analytics.sql",
            };
      return { first, bind: () => ({ first }) };
    },
  } as unknown as D1Database);
}
function schema() {
  return {
    status: "current",
    expectedMigration: "0003_campaign_analytics.sql",
    latestMigration: "0003_campaign_analytics.sql",
    appliedMigrationCount: 3,
  };
}
