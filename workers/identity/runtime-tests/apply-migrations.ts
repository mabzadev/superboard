import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll } from "vitest";
import type { IdentityEnv } from "../src/types";

beforeAll(async () => applyD1Migrations(
  (env as IdentityEnv).DB,
  (env as IdentityEnv & { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS,
));
