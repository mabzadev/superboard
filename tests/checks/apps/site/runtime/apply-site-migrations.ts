import { createDialect } from "@emdash-cms/cloudflare/db/d1";
import { env } from "cloudflare:workers";
import { runMigrations } from "emdash/db";
import { Kysely } from "kysely";
import { beforeAll } from "vitest";

const MIGRATIONS_TABLE_SCHEMA = `CREATE TABLE IF NOT EXISTS "d1_migrations" (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT UNIQUE,
	applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`;

type Migration = { name: string; queries: string[] };

function isMigration(item: unknown): item is Migration {
	return (
		typeof item === "object" &&
		item !== null &&
		"name" in item &&
		typeof item.name === "string" &&
		"queries" in item &&
		Array.isArray(item.queries) &&
		item.queries.every((query: unknown) => typeof query === "string")
	);
}

function readMigrations(value: unknown): Migration[] {
	if (!Array.isArray(value)) throw new Error("Invalid test migrations");
	const items: unknown[] = value;
	const migrations = items.filter(isMigration);
	if (migrations.length !== items.length) throw new Error("Invalid test migrations");
	return migrations;
}

beforeAll(async () => {
	await runMigrations(
		new Kysely({ dialect: createDialect({ binding: "DB", session: "disabled" }) }),
	);
	const database = env.DB;
	await database.prepare(MIGRATIONS_TABLE_SCHEMA).run();
	const applied = new Set(
		(
			await database.prepare(`SELECT name FROM "d1_migrations";`).all<{ name: string }>()
		).results.map(({ name }) => name),
	);
	const record = database.prepare(`INSERT INTO "d1_migrations" (name) VALUES (?);`);
	for (const migration of readMigrations(env.TEST_MIGRATIONS)) {
		if (applied.has(migration.name)) continue;
		await database.batch([
			...migration.queries.map((query) => database.prepare(query)),
			record.bind(migration.name),
		]);
	}
});
