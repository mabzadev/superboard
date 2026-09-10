import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll } from "vitest";
beforeAll(async()=>applyD1Migrations(env.DB,(env as Env&{TEST_MIGRATIONS:D1Migration[]}).TEST_MIGRATIONS));
