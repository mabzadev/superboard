export interface SqlHealthDatabase {
  prepare(query: string): {
    first<T = Record<string, unknown>>(): Promise<T | null>;
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

export type SqlSchemaHealthStatus = "current" | "behind" | "drifted";

export interface SqlSchemaHealth {
  status: SqlSchemaHealthStatus;
  expectedMigration: string;
  latestMigration: string | null;
  appliedMigrationCount: number;
}

const MIGRATION_FILENAME_PATTERN = /^\d+[a-z0-9_-]*\.sql$/iu;

/**
 * Executes the smallest possible read against a SQL binding and fails closed
 * when the binding is missing, unreachable, or returns an unexpected result.
 */
export async function assertSqlDatabaseHealth(
  database: SqlHealthDatabase,
): Promise<void> {
  const row = await database
    .prepare("SELECT 1 AS opengrow_health_check")
    .first<{ opengrow_health_check: number }>();
  if (Number(row?.opengrow_health_check) !== 1) {
    throw new Error("SQL health check returned an unexpected result");
  }
}

/**
 * Reads Wrangler's documented D1 migration ledger and compares it with the
 * exact latest migration injected from the reviewed source tree at build time.
 * A database is `behind` when the expected migration is absent and `drifted`
 * when that migration exists but a different migration was applied afterward.
 */
export async function inspectSqlSchemaHealth(
  database: SqlHealthDatabase,
  expectedMigration: string,
): Promise<SqlSchemaHealth> {
  if (!MIGRATION_FILENAME_PATTERN.test(expectedMigration)) {
    throw new Error("D1 expected migration is missing or invalid");
  }
  const row = await database
    .prepare(
      `SELECT
        COUNT(*) AS applied_migration_count,
        MAX(CASE WHEN name = ? THEN 1 ELSE 0 END) AS expected_migration_applied,
        (SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1) AS latest_migration
       FROM d1_migrations`,
    )
    .bind(expectedMigration)
    .first<{
      applied_migration_count: number;
      expected_migration_applied: number;
      latest_migration: string | null;
    }>();
  const appliedMigrationCount = Number(row?.applied_migration_count);
  const latestMigration =
    typeof row?.latest_migration === "string" ? row.latest_migration : null;
  const expectedApplied = Number(row?.expected_migration_applied) === 1;
  if (
    !Number.isSafeInteger(appliedMigrationCount) ||
    appliedMigrationCount < 0 ||
    (appliedMigrationCount > 0 &&
      (!latestMigration ||
        !MIGRATION_FILENAME_PATTERN.test(latestMigration))) ||
    (appliedMigrationCount === 0 && latestMigration !== null)
  ) {
    throw new Error("D1 migration ledger returned an unexpected result");
  }
  return {
    status:
      latestMigration === expectedMigration
        ? "current"
        : expectedApplied
          ? "drifted"
          : "behind",
    expectedMigration,
    latestMigration,
    appliedMigrationCount,
  };
}

export async function inspectSqlDatabaseAndSchemaHealth(
  database: SqlHealthDatabase,
  expectedMigration: string,
): Promise<SqlSchemaHealth> {
  await assertSqlDatabaseHealth(database);
  return inspectSqlSchemaHealth(database, expectedMigration);
}
