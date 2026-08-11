const MIGRATION_FILENAME_PATTERN = /^\d+[a-z0-9_-]*\.sql$/iu;

export function d1RuntimeBindings(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new Error("Runtime D1 migrations are empty");
  }
  const names = migrations.map((migration) => String(migration?.name || ""));
  if (
    names.some((name) => !MIGRATION_FILENAME_PATTERN.test(name)) ||
    new Set(names).size !== names.length
  ) {
    throw new Error("Runtime D1 migrations contain invalid or duplicate names");
  }
  return {
    D1_EXPECTED_MIGRATION: names.at(-1),
    TEST_MIGRATIONS: migrations,
  };
}
