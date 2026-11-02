import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { runMigrations } from "../../../../../packages/core/src/database/migrations/runner.js";
import { TaxonomyRepository } from "../../../../../packages/core/src/database/repositories/taxonomy.js";
import type { Database as DatabaseSchema } from "../../../../../packages/core/src/database/types.js";

interface CapturedQuery {
	sql: string;
	parameters: readonly unknown[];
}

let sqlite: Database.Database;
let db: Kysely<DatabaseSchema>;
let repo: TaxonomyRepository;
let captured: CapturedQuery[];
let parentGroup: string;

beforeEach(async () => {
	captured = [];
	sqlite = new Database(":memory:");
	db = new Kysely<DatabaseSchema>({
		dialect: new SqliteDialect({ database: sqlite }),
		log(event) {
			if (event.level === "query") {
				captured.push({ sql: event.query.sql, parameters: event.query.parameters });
			}
		},
	});

	await runMigrations(db);
	repo = new TaxonomyRepository(db);

	for (let i = 0; i < 40; i++) {
		await repo.create({ name: "tag", slug: `tag-${i}`, label: `Tag ${i}`, locale: "en" });
	}
	const parent = await repo.create({
		name: "category",
		slug: "news",
		label: "News",
		locale: "en",
	});
	parentGroup = parent.translationGroup ?? parent.id;
	for (let i = 0; i < 3; i++) {
		await repo.create({
			name: "category",
			slug: `child-${i}`,
			label: `Child ${i}`,
			parentId: parentGroup,
			locale: "en",
		});
	}
});

afterEach(async () => {
	await db.destroy();
});

function bindable(p: unknown): unknown {
	if (typeof p === "boolean") return p ? 1 : 0;
	if (p instanceof Date) return p.toISOString();
	if (p === undefined) return null;
	return p;
}

function queryOf(match: (sql: string) => boolean): CapturedQuery {
	const query = captured.findLast((q) => match(q.sql));
	expect(query, "expected a matching query to have been emitted").toBeDefined();
	return query!;
}

function planOf(match: (sql: string) => boolean): string {
	const query = queryOf(match);
	const rows = sqlite
		.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
		.all(...query.parameters.map(bindable)) as { detail: string }[];
	return rows.map((r) => r.detail).join("\n");
}

it("seeks findByName through the composite index rather than scanning the locale", async () => {
	captured = [];
	await repo.findByName("category", { locale: "en" });

	const plan = planOf((sql) => sql.includes('"name" = ?') && sql.includes("sort_order"));
	expect(plan).toContain("idx_taxonomies_name_locale");
	expect(plan).not.toContain("idx_taxonomies_locale");
	expect(plan).not.toContain("SCAN taxonomies");
	expect(plan).toContain("TEMP B-TREE");
});

it("bounds manual keyset pages while seeking the taxonomy index", async () => {
	const terms = await repo.findByName("category", { locale: "en" });
	const cursor = terms[0]!;
	const match = (query: string) => query.includes('"sort_order" > ?') && query.includes("limit ?");

	captured = [];
	await repo.findPageByName("category", {
		locale: "en",
		limit: 2,
		cursor: {
			sortOrder: cursor.sortOrder,
			label: cursor.label,
			id: cursor.id,
		},
	});

	const query = queryOf(match);
	expect(query.parameters.at(-1)).toBe(3);
	const plan = planOf(match);
	expect(plan).toContain("idx_taxonomies_name_locale");
	expect(plan).not.toContain("idx_taxonomies_locale");
	expect(plan).not.toContain("SCAN taxonomies");
	expect(plan).toContain("TEMP B-TREE");
});

it("seeks findChildren through the parent index", async () => {
	captured = [];
	await repo.findChildren(parentGroup, "en");

	const plan = planOf((sql) => sql.includes('"parent_id" = ?') && sql.includes("sort_order"));
	expect(plan).toContain("idx_taxonomies_parent");
	expect(plan).not.toContain("SCAN taxonomies");
	expect(plan).toContain("TEMP B-TREE");
});
