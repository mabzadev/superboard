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
	const bindings: Record<string, unknown> = { ...env };
	const migrations: unknown = JSON.parse(String(bindings.HEALTH_MIGRATIONS_JSON));
	if (!migrations || typeof migrations !== "object" || Array.isArray(migrations))
		throw new Error("Invalid test migration inventory");
	for (const [name, migration] of Object.entries(migrations)) {
		if (
			!Array.isArray(migration) ||
			!migration.every(
				(item) =>
					item &&
					typeof item === "object" &&
					typeof item.name === "string" &&
					Array.isArray(item.queries) &&
					item.queries.every((query: unknown) => typeof query === "string"),
			)
		)
			throw new Error("Invalid test migrations");
		await applyD1Migrations(
			bindings[`HEALTH_${name.replaceAll("-", "_").toUpperCase()}_DB`],
			migration,
		);
	}
});
