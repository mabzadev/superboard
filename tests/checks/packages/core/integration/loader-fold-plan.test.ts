import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { runMigrations } from "../../../../../packages/core/src/database/migrations/runner.js";
import { BylineRepository } from "../../../../../packages/core/src/database/repositories/byline.js";
import { ContentRepository } from "../../../../../packages/core/src/database/repositories/content.js";
import { TaxonomyRepository } from "../../../../../packages/core/src/database/repositories/taxonomy.js";
import type { Database as DatabaseSchema } from "../../../../../packages/core/src/database/types.js";
import { emdashLoader } from "../../../../../packages/core/src/loader.js";
import { runWithContext } from "../../../../../packages/core/src/request-context.js";
import { SchemaRegistry } from "../../../../../packages/core/src/schema/registry.js";

interface CapturedQuery {
	sql: string;
	parameters: readonly unknown[];
}

let sqlite: Database.Database;
let db: Kysely<DatabaseSchema>;
let captured: CapturedQuery[];

beforeEach(async () => {
	captured = [];
	sqlite = new Database(":memory:");
	db = new Kysely<DatabaseSchema>({
		dialect: new SqliteDialect({ database: sqlite }),
		log(event) {
			if (event.level === "query") {
				captured.push({
					sql: event.query.sql,
					parameters: event.query.parameters,
				});
			}
		},
	});

	await runMigrations(db);
	const registry = new SchemaRegistry(db);
	await registry.createCollection({ slug: "post", label: "Posts", labelSingular: "Post" });
	await registry.createField("post", { slug: "title", label: "Title", type: "string" });

	// eslint-disable-next-line typescript/no-explicit-any -- schema type vs Database type
	const anyDb = db as any;
	const content = new ContentRepository(anyDb);
	const tax = new TaxonomyRepository(anyDb);
	const byline = new BylineRepository(anyDb);
	const post = await content.create({
		type: "post",
		slug: "tagged",
		data: { title: "Tagged" },
		locale: "en",
	});
	await anyDb
		.updateTable("ec_post")
		.set({ status: "published" })
		.where("id", "=", post.id)
		.execute();
	const attachedBylines: string[] = [];
	for (let i = 0; i < 8; i++) {
		const term = await tax.create({
			name: "tag",
			slug: `tag-${i}`,
			label: `Tag ${i}`,
			locale: "en",
		});
		if (i < 2) await tax.attachToEntry("post", post.id, term.id);
		const author = await byline.create({
			displayName: `Author ${i}`,
			slug: `author-${i}`,
			locale: "en",
		});
		if (i < 2) attachedBylines.push(author.id);
	}
	await byline.setContentBylines(
		"post",
		post.id,
		attachedBylines.map((bylineId) => ({ bylineId, roleLabel: "Author" })),
	);
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

function explain(query: CapturedQuery): string {
	const rows = sqlite
		.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
		.all(...query.parameters.map(bindable)) as { detail: string }[];
	return rows.map((r) => r.detail).join("\n");
}

function assertPivotDrivenFold(plan: string): void {
	expect(plan, "taxonomy subquery must not scan taxonomies by locale").not.toContain(
		"idx_taxonomies_locale",
	);
	expect(plan, "taxonomy subquery must probe taxonomies by translation_group").toContain(
		"idx_taxonomies_translation_group",
	);
	expect(plan, "byline subquery must not scan bylines by locale").not.toContain(
		"idx__emdash_bylines_locale",
	);
	expect(plan, "byline subquery must probe bylines by translation_group").toContain(
		"idx_bylines_group_locale_unique",
	);
}

function foldedQueryPlan(): string {
	const foldedQuery = captured.find((q) => q.sql.includes("_emdash_terms"));
	expect(foldedQuery, "expected the loader to emit a folded query").toBeDefined();
	return explain(foldedQuery!);
}

it("drives folded hydration from the pivot on loadCollection, not term/byline-by-locale", async () => {
	const loader = emdashLoader();
	await runWithContext({ editMode: false, db }, () =>
		loader.loadCollection({ filter: { type: "post" } }),
	);
	assertPivotDrivenFold(foldedQueryPlan());
});

it("drives folded hydration from the pivot on loadEntry, not term/byline-by-locale", async () => {
	const loader = emdashLoader();
	captured = [];
	await runWithContext({ editMode: false, db }, () =>
		loader.loadEntry({ filter: { type: "post", id: "tagged", locale: "en" } }),
	);
	assertPivotDrivenFold(foldedQueryPlan());
});
