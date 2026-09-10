import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

const runtimeEnv = env as unknown as {
  REFERENCE_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(runtimeEnv.REFERENCE_DB, runtimeEnv.TEST_MIGRATIONS);
