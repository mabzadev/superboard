import { createDialect } from "@emdash-cms/cloudflare/db/d1";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { runMigrations } from "emdash/db";
import { Kysely } from "kysely";
import { beforeAll } from "vitest";

beforeAll(async () => {
	await runMigrations(
		new Kysely({ dialect: createDialect({ binding: "DB", session: "disabled" }) }),
	);
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
