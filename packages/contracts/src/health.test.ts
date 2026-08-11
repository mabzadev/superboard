import { describe, expect, it } from "vitest";
import {
  assertSqlDatabaseHealth,
  inspectSqlDatabaseAndSchemaHealth,
  inspectSqlSchemaHealth,
  type SqlHealthDatabase,
} from "./health";

describe("SQL health contracts", () => {
  it("checks reachability with the smallest read", async () => {
    await expect(
      assertSqlDatabaseHealth(database({ opengrow_health_check: 1 })),
    ).resolves.toBeUndefined();
    await expect(
      assertSqlDatabaseHealth(database({ opengrow_health_check: 0 })),
    ).rejects.toThrow(/unexpected result/u);
  });

  it("combines reachability and schema inspection", async () => {
    const rows = [
      { opengrow_health_check: 1 },
      {
        applied_migration_count: 1,
        expected_migration_applied: 1,
        latest_migration: "0001_initial.sql",
      },
    ];
    await expect(
      inspectSqlDatabaseAndSchemaHealth(
        databaseSequence(rows),
        "0001_initial.sql",
      ),
    ).resolves.toMatchObject({ status: "current" });
  });

  it("distinguishes current, behind and drifted D1 ledgers", async () => {
    await expect(
      inspectSqlSchemaHealth(
        database({
          applied_migration_count: 3,
          expected_migration_applied: 1,
          latest_migration: "0003_current.sql",
        }),
        "0003_current.sql",
      ),
    ).resolves.toEqual({
      status: "current",
      expectedMigration: "0003_current.sql",
      latestMigration: "0003_current.sql",
      appliedMigrationCount: 3,
    });
    await expect(
      inspectSqlSchemaHealth(
        database({
          applied_migration_count: 2,
          expected_migration_applied: 0,
          latest_migration: "0002_previous.sql",
        }),
        "0003_current.sql",
      ),
    ).resolves.toMatchObject({ status: "behind" });
    await expect(
      inspectSqlSchemaHealth(
        database({
          applied_migration_count: 4,
          expected_migration_applied: 1,
          latest_migration: "0004_unreviewed.sql",
        }),
        "0003_current.sql",
      ),
    ).resolves.toMatchObject({ status: "drifted" });
  });

  it("fails closed on invalid configuration or malformed ledger rows", async () => {
    await expect(
      inspectSqlSchemaHealth(database({}), "latest"),
    ).rejects.toThrow(/missing or invalid/u);
    await expect(
      inspectSqlSchemaHealth(
        database({
          applied_migration_count: 1.5,
          expected_migration_applied: 1,
          latest_migration: "0001_initial.sql",
        }),
        "0001_initial.sql",
      ),
    ).rejects.toThrow(/unexpected result/u);
  });
});

function database(row: Record<string, unknown>): SqlHealthDatabase {
  const result = { first: async () => row };
  return {
    prepare: () => ({
      ...result,
      bind: () => result,
    }),
  };
}

function databaseSequence(rows: Record<string, unknown>[]): SqlHealthDatabase {
  let index = 0;
  return {
    prepare: () => {
      const result = { first: async () => rows[index++] ?? null };
      return { ...result, bind: () => result };
    },
  };
}
