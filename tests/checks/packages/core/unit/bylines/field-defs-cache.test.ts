import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { ulid } from "ulidx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getBylineFieldDefs,
	resetBylineFieldDefsCacheForTests,
	setBylineFieldDefsReclaimDeadlineForTests,
} from "../../../../../../packages/core/src/bylines/field-defs-cache.js";
import { runMigrations } from "../../../../../../packages/core/src/database/migrations/runner.js";
import type { Database as EmDashDatabase } from "../../../../../../packages/core/src/database/types.js";
import { BylineSchemaRegistry } from "../../../../../../packages/core/src/schema/byline-registry.js";

const VERSION_KEY = "byline_fields_version";

async function setVersion(db: Kysely<EmDashDatabase>, value: number): Promise<void> {
	await sql`
		INSERT INTO options (name, value)
		VALUES (${VERSION_KEY}, ${String(value)})
		ON CONFLICT(name) DO UPDATE SET value = ${String(value)}
	`.execute(db);
}

async function insertFieldDirect(
	db: Kysely<EmDashDatabase>,
	slug: string,
	label = slug,
): Promise<void> {
	await db
		.insertInto("_emdash_byline_fields")
		.values({
			id: ulid(),
			slug,
			label,
			type: "string",
			required: 0,
			translatable: 1,
			validation: null,
			sort_order: 0,
		})
		.execute();
}

describe("getBylineFieldDefs — dirty-version bypass (#1174 BUG 1)", () => {
	let db: Kysely<EmDashDatabase>;

	beforeEach(async () => {
		const sqlite = new Database(":memory:");
		db = new Kysely<EmDashDatabase>({ dialect: new SqliteDialect({ database: sqlite }) });
		await runMigrations(db);
		resetBylineFieldDefsCacheForTests();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await db.destroy();
	});

	it("coalesces concurrent cold global reads onto a single query", async () => {
		await insertFieldDirect(db, "shared_field");

		const original = BylineSchemaRegistry.prototype.listFields;
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		vi.spyOn(BylineSchemaRegistry.prototype, "listFields").mockImplementation(
			async function (this: BylineSchemaRegistry) {
				calls += 1;
				await gate;
				return original.call(this);
			},
		);

		const first = getBylineFieldDefs(db);
		const second = getBylineFieldDefs(db);

		release();
		const results = await Promise.all([first, second]);

		expect(calls).toBe(1);
		expect(results[0].map((f) => f.slug)).toEqual(["shared_field"]);
		expect(results[1].map((f) => f.slug)).toEqual(["shared_field"]);
	});

	it("a stranded owner (cancelled request) does not poison later byline hydrations", async () => {
		await insertFieldDirect(db, "f1");
		setBylineFieldDefsReclaimDeadlineForTests(100);

		const original = BylineSchemaRegistry.prototype.listFields;
		let calls = 0;
		vi.spyOn(BylineSchemaRegistry.prototype, "listFields").mockImplementation(
			async function (this: BylineSchemaRegistry) {
				calls += 1;
				if (calls === 1) {
					await new Promise(() => {});
				}
				return original.call(this);
			},
		);

		const stranded = getBylineFieldDefs(db);
		void stranded.catch(() => {});

		await new Promise((resolve) => setTimeout(resolve, 10));

		const recovered = await getBylineFieldDefs(db);
		expect(recovered.map((f) => f.slug)).toEqual(["f1"]);
		expect(calls).toBeGreaterThanOrEqual(2);
	});

	it("returns fresh defs when the global cache was primed under the same odd version", async () => {
		await setVersion(db, 11);
		const beforeInsert = await getBylineFieldDefs(db);
		expect(beforeInsert).toHaveLength(0);

		await insertFieldDirect(db, "ghost_field");

		const afterInsert = await getBylineFieldDefs(db);
		expect(afterInsert.map((f) => f.slug)).toContain("ghost_field");
	});

	it("does not write the global holder while the version is odd", async () => {
		await setVersion(db, 0);
		await getBylineFieldDefs(db);

		await setVersion(db, 1);
		await insertFieldDirect(db, "in_flight_field");
		await getBylineFieldDefs(db);

		await setVersion(db, 2);
		await insertFieldDirect(db, "after_clean_field");

		const final = await getBylineFieldDefs(db);
		expect(final.map((f) => f.slug).toSorted()).toEqual(["after_clean_field", "in_flight_field"]);
	});

	it("a second concurrent mutator's markClean still advances the version (no concurrent-collapse)", async () => {
		await setVersion(db, 0);
		resetBylineFieldDefsCacheForTests();
		expect(await getBylineFieldDefs(db)).toHaveLength(0);

		await sql`
			UPDATE options SET value = '1' WHERE name = ${VERSION_KEY}
		`.execute(db);
		await sql`
			UPDATE options SET value = CASE WHEN CAST(value AS INTEGER) % 2 = 0
				THEN CAST(CAST(value AS INTEGER) + 1 AS TEXT)
				ELSE value END
			WHERE name = ${VERSION_KEY}
		`.execute(db);
		expect(await new BylineSchemaRegistry(db).getVersion()).toBe(1);

		await insertFieldDirect(db, "field_a");
		await sql`
			UPDATE options SET value = '2' WHERE name = ${VERSION_KEY}
		`.execute(db);
		expect((await getBylineFieldDefs(db)).map((f) => f.slug)).toEqual(["field_a"]);

		await insertFieldDirect(db, "field_b");
		await sql`
			UPDATE options SET value = CASE WHEN CAST(value AS INTEGER) % 2 = 0
				THEN CAST(CAST(value AS INTEGER) + 2 AS TEXT)
				ELSE CAST(CAST(value AS INTEGER) + 1 AS TEXT) END
			WHERE name = ${VERSION_KEY}
		`.execute(db);

		expect((await getBylineFieldDefs(db)).map((f) => f.slug).toSorted()).toEqual([
			"field_a",
			"field_b",
		]);
	});

	it("missing version row: production markVersionDirty path initialises the row and busts the cache", async () => {
		await db.deleteFrom("options").where("name", "=", VERSION_KEY).execute();
		expect(await getBylineFieldDefs(db)).toHaveLength(0);

		const registry = new BylineSchemaRegistry(db);
		const r = registry as unknown as { markVersionDirty(): Promise<void> };
		await r.markVersionDirty();
		await insertFieldDirect(db, "first_field");

		expect(await registry.getVersion()).toBe(1);
		expect((await getBylineFieldDefs(db)).map((f) => f.slug)).toContain("first_field");
	});
});
