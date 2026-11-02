import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { runMigrations } from "../../../../../../packages/core/src/database/migrations/runner.js";
import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import type { ContentBylineFilter } from "../../../../../../packages/core/src/database/repositories/types.js";
import type { Database as DatabaseSchema } from "../../../../../../packages/core/src/database/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";

interface CapturedQuery {
	sql: string;
	parameters: readonly unknown[];
}

let sqlite: Database.Database;
let db: Kysely<DatabaseSchema>;
let repo: ContentRepository;
let captured: CapturedQuery[];

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
	const registry = new SchemaRegistry(db);
	await registry.createCollection({ slug: "posts", label: "Posts", labelSingular: "Post" });
	repo = new ContentRepository(db);
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

async function planOfPageQuery(bylineFilter: ContentBylineFilter): Promise<string> {
	captured = [];
	await repo.findMany("posts", { where: { locale: "en", bylineFilter }, limit: 20 });

	const query = captured.findLast((q) => q.sql.includes("limit") && q.sql.includes("_bylines"));
	expect(query, "expected a byline-filtered page query to have been emitted").toBeDefined();
	const rows = sqlite
		.prepare(`EXPLAIN QUERY PLAN ${query!.sql}`)
		.all(...query!.parameters.map(bindable)) as { detail: string }[];
	return rows.map((r) => r.detail).join("\n");
}

const GROUP = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

it("seeks the junction and the byline row for a selected byline", async () => {
	const plan = await planOfPageQuery({ mode: "any", bylineIds: [GROUP], locale: "en" });

	expect(plan).toContain("sqlite_autoindex__emdash_content_bylines_2");
	expect(plan).toContain("idx_bylines_group_locale_unique");
	expect(plan).not.toContain("SCAN cb");
	expect(plan).not.toContain("SCAN b");
	expect(plan).not.toContain("TEMP B-TREE");
});

it("seeks the junction for the no-byline filter", async () => {
	const plan = await planOfPageQuery({ mode: "none", locale: "en" });

	expect(plan).toContain("idx_content_bylines_content");
	expect(plan).toContain("idx_bylines_group_locale_unique");
	expect(plan).not.toContain("SCAN cb");
	expect(plan).not.toContain("SCAN b");
	expect(plan).not.toContain("TEMP B-TREE");
});

it("seeks the author's byline when inference is opted into", async () => {
	const plan = await planOfPageQuery({
		mode: "any",
		bylineIds: [GROUP],
		includeInferred: true,
		locale: "en",
	});

	expect(plan).toContain("idx_bylines_group_locale_unique");
	expect(plan).not.toContain("SCAN cb");
	expect(plan).not.toContain("SCAN b");
	expect(plan).not.toContain("TEMP B-TREE");
});

it("seeks every probe for the no-byline filter with inference opted into", async () => {
	const plan = await planOfPageQuery({ mode: "none", includeInferred: true, locale: "en" });

	expect(plan).toContain("idx_bylines_user_id_locale_unique");
	expect(plan).not.toContain("SCAN cb");
	expect(plan).not.toContain("SCAN b");
	expect(plan).not.toContain("TEMP B-TREE");
});

it("keeps the outer sort index in every filter shape", async () => {
	const shapes: ContentBylineFilter[] = [
		{ mode: "any", bylineIds: [GROUP], locale: "en" },
		{ mode: "none", locale: "en" },
		{ mode: "any", bylineIds: [GROUP], includeInferred: true, locale: "en" },
		{ mode: "none", includeInferred: true, locale: "en" },
	];

	for (const shape of shapes) {
		const plan = await planOfPageQuery(shape);
		expect(plan, JSON.stringify(shape)).not.toContain("SCAN ec_posts");
		expect(plan, JSON.stringify(shape)).not.toContain("USE TEMP B-TREE FOR ORDER BY");
	}
});
