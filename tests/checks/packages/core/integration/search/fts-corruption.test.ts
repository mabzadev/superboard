import type { Kysely } from "kysely";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import { FTSManager } from "../../../../../../packages/core/src/search/fts-manager.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("FTS corruption on publish (SQLITE_CORRUPT_VTAB)", () => {
	let db: Kysely<Database>;
	let registry: SchemaRegistry;
	let repo: ContentRepository;
	let ftsManager: FTSManager;

	beforeEach(async () => {
		db = await setupTestDatabase();
		registry = new SchemaRegistry(db);
		repo = new ContentRepository(db);
		ftsManager = new FTSManager(db);

		await registry.createCollection({
			slug: "pages",
			label: "Pages",
			labelSingular: "Page",
			supports: ["drafts", "revisions", "search"],
		});
		await registry.createField("pages", {
			slug: "title",
			label: "Title",
			type: "string",
			required: true,
			searchable: true,
		});
		await registry.createField("pages", {
			slug: "content",
			label: "Content",
			type: "portableText",
			searchable: true,
		});

		await ftsManager.enableSearch("pages");
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("does not corrupt the FTS index when a published page is edited and re-published", async () => {
		const created = await repo.create({
			type: "pages",
			slug: "about",
			status: "draft",
			data: {
				title: "About",
				content: [
					{
						_type: "block",
						_key: "a",
						style: "normal",
						children: [{ _type: "span", _key: "s", text: "Initial about page body." }],
					},
				],
			},
		});

		await repo.publish("pages", created.id);

		await repo.update("pages", created.id, {
			data: {
				title: "About v2",
				content: [
					{
						_type: "block",
						_key: "a",
						style: "normal",
						children: [
							{
								_type: "span",
								_key: "s",
								text: "Revised body with different searchable terms.",
							},
						],
					},
				],
			},
		});

		await expect(
			sql
				.raw(`INSERT INTO _emdash_fts_pages(_emdash_fts_pages) VALUES('integrity-check')`)
				.execute(db),
		).resolves.toBeDefined();

		await expect(repo.publish("pages", created.id)).resolves.toBeDefined();

		await expect(
			sql
				.raw(`INSERT INTO _emdash_fts_pages(_emdash_fts_pages) VALUES('integrity-check')`)
				.execute(db),
		).resolves.toBeDefined();

		const docsize = await sql<{ count: number }>`
			SELECT COUNT(*) as count FROM "_emdash_fts_pages_docsize"
		`.execute(db);
		expect(docsize.rows[0]?.count).toBe(1);
	});

	it("survives the full trash lifecycle (soft-delete -> restore -> integrity-check)", async () => {
		const created = await repo.create({
			type: "pages",
			slug: "trashable",
			status: "draft",
			data: {
				title: "Trashable",
				content: [
					{
						_type: "block",
						_key: "a",
						style: "normal",
						children: [{ _type: "span", _key: "s", text: "Body before trash." }],
					},
				],
			},
		});

		await repo.publish("pages", created.id);

		await expect(repo.delete("pages", created.id)).resolves.toBe(true);
		await expect(
			sql
				.raw(`INSERT INTO _emdash_fts_pages(_emdash_fts_pages) VALUES('integrity-check')`)
				.execute(db),
		).resolves.toBeDefined();

		await expect(repo.restore("pages", created.id)).resolves.toEqual(
			expect.objectContaining({ id: created.id }),
		);
		await expect(
			sql
				.raw(`INSERT INTO _emdash_fts_pages(_emdash_fts_pages) VALUES('integrity-check')`)
				.execute(db),
		).resolves.toBeDefined();

		const docsizeAfterRestore = await sql<{ count: number }>`
			SELECT COUNT(*) as count FROM "_emdash_fts_pages_docsize"
		`.execute(db);
		expect(docsizeAfterRestore.rows[0]?.count).toBe(1);

		await repo.update("pages", created.id, {
			data: {
				title: "Restored and edited",
				content: [
					{
						_type: "block",
						_key: "a",
						style: "normal",
						children: [{ _type: "span", _key: "s", text: "Body after restore." }],
					},
				],
			},
		});
		await expect(
			sql
				.raw(`INSERT INTO _emdash_fts_pages(_emdash_fts_pages) VALUES('integrity-check')`)
				.execute(db),
		).resolves.toBeDefined();
	});

	it("survives permanent delete of a soft-deleted row without corrupting the index", async () => {
		const created = await repo.create({
			type: "pages",
			slug: "purgeable",
			status: "draft",
			data: {
				title: "Purgeable",
				content: [
					{
						_type: "block",
						_key: "a",
						style: "normal",
						children: [{ _type: "span", _key: "s", text: "Will be purged." }],
					},
				],
			},
		});
		await repo.publish("pages", created.id);
		await expect(repo.delete("pages", created.id)).resolves.toBe(true);

		await expect(repo.permanentDelete("pages", created.id)).resolves.toBe(true);
		await expect(
			sql
				.raw(`INSERT INTO _emdash_fts_pages(_emdash_fts_pages) VALUES('integrity-check')`)
				.execute(db),
		).resolves.toBeDefined();

		const docsize = await sql<{ count: number }>`
			SELECT COUNT(*) as count FROM "_emdash_fts_pages_docsize"
		`.execute(db);
		expect(docsize.rows[0]?.count).toBe(0);
	});

	it("survives editing a row while it's in the trash without corrupting the index", async () => {
		const created = await repo.create({
			type: "pages",
			slug: "edit-while-trashed",
			status: "draft",
			data: {
				title: "Trashed",
				content: [],
			},
		});
		await repo.publish("pages", created.id);
		await expect(repo.delete("pages", created.id)).resolves.toBe(true);

		await sql`
			UPDATE ec_pages
			SET title = 'edited while trashed'
			WHERE id = ${created.id}
		`.execute(db);

		await expect(
			sql
				.raw(`INSERT INTO _emdash_fts_pages(_emdash_fts_pages) VALUES('integrity-check')`)
				.execute(db),
		).resolves.toBeDefined();
	});

	it("survives many edit/publish cycles without corrupting the index", async () => {
		const created = await repo.create({
			type: "pages",
			slug: "stress",
			status: "draft",
			data: { title: "Stress", content: [] },
		});

		await repo.publish("pages", created.id);

		for (let i = 0; i < 25; i++) {
			await repo.update("pages", created.id, {
				data: {
					title: `Stress ${i}`,
					content: [
						{
							_type: "block",
							_key: `b${i}`,
							style: "normal",
							children: [
								{
									_type: "span",
									_key: `s${i}`,
									text: `Iteration ${i} unique-token-${i} alpha beta gamma`,
								},
							],
						},
					],
				},
			});
			await repo.publish("pages", created.id);
		}

		await expect(
			sql
				.raw(`INSERT INTO _emdash_fts_pages(_emdash_fts_pages) VALUES('integrity-check')`)
				.execute(db),
		).resolves.toBeDefined();
	});
});
