import type { Kysely } from "kysely";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import { FTSManager } from "../../../../../../packages/core/src/search/fts-manager.js";
import { searchWithDb } from "../../../../../../packages/core/src/search/query.js";
import { createPostFixture } from "../../utils/fixtures.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

describe("search snippet sanitization", () => {
	let db: Kysely<Database>;
	let repo: ContentRepository;

	beforeEach(async () => {
		db = await setupTestDatabaseWithCollections();
		repo = new ContentRepository(db);

		const registry = new SchemaRegistry(db);
		const ftsManager = new FTSManager(db);
		await registry.updateField("post", "title", { searchable: true });
		await ftsManager.enableSearch("post");
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("escapes `<` and `>` in matched content so a `<script>` title cannot execute", async () => {
		await repo.create(
			createPostFixture({
				slug: "xss-attempt",
				status: "published",
				data: { title: "Hello <script>alert(1)</script> world" },
			}),
		);

		const { items } = await searchWithDb(db, "alert", {
			collections: ["post"],
		});

		expect(items).toHaveLength(1);
		const snippet = items[0]!.snippet ?? "";

		expect(snippet).not.toContain("<script>");
		expect(snippet).not.toContain("</script>");
		expect(snippet).toContain("&lt;script&gt;");
	});

	it("escapes ampersands so `<3` and `&amp;` round-trip correctly", async () => {
		await repo.create(
			createPostFixture({
				slug: "ampersand",
				status: "published",
				data: { title: "Tom & Jerry: 2 < 3 forever" },
			}),
		);

		const { items } = await searchWithDb(db, "Jerry", {
			collections: ["post"],
		});

		expect(items).toHaveLength(1);
		const snippet = items[0]!.snippet ?? "";

		expect(snippet).toContain("&amp;");
		expect(snippet).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);

		expect(snippet).toContain("&lt;");
	});

	it("does not crash when the snippet column is NULL", async () => {
		const registry = new SchemaRegistry(db);
		await registry.updateField("post", "content", { searchable: true });
		const ftsManager = new FTSManager(db);
		await ftsManager.enableSearch("post");

		await repo.create(
			createPostFixture({
				slug: "no-title",
				status: "published",
				data: {
					title: null,
					content: [
						{
							_type: "block",
							style: "normal",
							children: [{ _type: "span", text: "Quokka spotted today" }],
						},
					],
				},
			}),
		);

		const { items } = await searchWithDb(db, "Quokka", {
			collections: ["post"],
		});

		expect(items).toHaveLength(1);
		expect(typeof items[0]!.snippet === "string" || items[0]!.snippet === undefined).toBe(true);
	});

	it("preserves `<mark>` highlight tags as live HTML", async () => {
		await repo.create(
			createPostFixture({
				slug: "highlight",
				status: "published",
				data: { title: "The quick brown fox jumps" },
			}),
		);

		const { items } = await searchWithDb(db, "fox", {
			collections: ["post"],
		});

		expect(items).toHaveLength(1);
		const snippet = items[0]!.snippet ?? "";

		expect(snippet).toContain("<mark>");
		expect(snippet).toContain("</mark>");
		expect(snippet).toMatch(/<mark>fox<\/mark>/i);
	});
});
