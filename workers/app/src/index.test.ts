import { describe, expect, it } from "vitest";
import {
  signProjectContext,
  type InternalProjectContext,
} from "@opengrow/contracts";
import app from "./index";

describe("app worker", () => {
  it("reports its versioned health contract", async () => {
    const response = await app.request("/internal/v1/health", {}, healthyEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: {
        service: "app",
        version: "v1",
        status: "ok",
        storage: "d1",
        schema: schema("0004_sdk_secret_references.sql"),
      },
    });
  });

  it("degrades when D1 is reachable but behind the reviewed schema", async () => {
    const response = await app.request(
      "/internal/v1/health",
      {},
      env(healthyDatabase("0003_customer_analytics.sql", false)),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: {
        status: "degraded",
        reason: "database_schema_not_current",
        schema: { status: "behind" },
      },
    });
  });

  it("reports a degraded state when D1 cannot be queried", async () => {
    const response = await app.request(
      "/internal/v1/health",
      {},
      env({
        prepare: () => ({
          first: async () => {
            throw new Error("unavailable");
          },
        }),
      } as unknown as D1Database),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      data: {
        service: "app",
        version: "v1",
        status: "degraded",
        storage: "d1",
        reason: "database_health_unavailable",
      },
    });
  });

  it("rejects unsigned project traffic", async () => {
    const response = await app.request(
      "/internal/v1/missing",
      { headers: { "x-internal-token": "secret", "x-project-id": "12" } },
      env(),
    );
    expect(response.status).toBe(403);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("project_context_invalid");
  });

  it("accepts a fresh signed context for the canonical project", async () => {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const context: InternalProjectContext = {
      module: "app",
      method: "GET",
      pathname: "/internal/v1/missing",
      projectId: 12,
      projectRef: "10-test",
      instanceId: 10,
      environment: "test",
      actorId: 2,
      role: "owner",
      requestId: "request-1",
      issuedAt,
    };
    const signature = await signProjectContext(context, "secret");
    const response = await app.request(
      context.pathname,
      {
        headers: {
          "x-internal-token": "secret",
          "x-project-id": "12",
          "x-project-ref": "10-test",
          "x-instance-id": "10",
          "x-environment": "test",
          "x-actor-id": "2",
          "x-role": "owner",
          "x-request-id": "request-1",
          "x-context-issued-at": String(issuedAt),
          "x-context-version": "1",
          "x-context-signature": signature,
        },
      },
      env(),
    );
    expect(response.status).toBe(404);
  });
});

function env(database = {} as D1Database): Env {
  return {
    DB: database,
    D1_EXPECTED_MIGRATION: "0004_sdk_secret_references.sql",
    INTERNAL_API_TOKEN: "secret",
  };
}

function healthyEnv(): Env {
  return env(healthyDatabase("0004_sdk_secret_references.sql", true));
}

function schema(latestMigration: string) {
  return {
    status: "current",
    expectedMigration: "0004_sdk_secret_references.sql",
    latestMigration,
    appliedMigrationCount: 4,
  };
}

function healthyDatabase(
  latestMigration: string,
  expectedApplied: boolean,
): D1Database {
  return {
    prepare: (query: string) => {
      const first = async () =>
        query.includes("opengrow_health_check")
          ? { opengrow_health_check: 1 }
          : {
              applied_migration_count: expectedApplied ? 4 : 3,
              expected_migration_applied: expectedApplied ? 1 : 0,
              latest_migration: latestMigration,
            };
      return { first, bind: () => ({ first }) };
    },
  } as unknown as D1Database;
}
