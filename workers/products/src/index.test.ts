import { describe, expect, it } from "vitest";
import app from "./index";

describe("products worker health", () => {
  it("reports a connected D1 binding", async () => {
    const response = await app.request(
      "/internal/v1/health",
      {},
      environment(true),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: {
        service: "products",
        version: "v1",
        status: "ok",
        storage: "d1",
        schema: schema("0003_audit_context.sql", 3),
      },
    });
  });

  it("fails closed when the D1 query fails", async () => {
    const response = await app.request(
      "/internal/v1/health",
      {},
      environment(false),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: {
        service: "products",
        status: "degraded",
        reason: "database_health_unavailable",
      },
    });
  });
});

function environment(healthy: boolean): Env {
  return {
    DB: {
      prepare: (query: string) => {
        const first = async () =>
          !healthy
            ? null
            : query.includes("opengrow_health_check")
              ? { opengrow_health_check: 1 }
              : ledger("0003_audit_context.sql", 3);
        return { first, bind: () => ({ first }) };
      },
    } as unknown as D1Database,
    D1_EXPECTED_MIGRATION: "0003_audit_context.sql",
    INTERNAL_API_TOKEN: "test-secret",
  };
}

function ledger(latestMigration: string, count: number) {
  return {
    applied_migration_count: count,
    expected_migration_applied: 1,
    latest_migration: latestMigration,
  };
}

function schema(latestMigration: string, count: number) {
  return {
    status: "current",
    expectedMigration: "0003_audit_context.sql",
    latestMigration,
    appliedMigrationCount: count,
  };
}
