import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import { TaxonomyRepository } from "../../../../../../packages/core/src/database/repositories/taxonomy.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

vi.mock("../../../../../../packages/core/src/loader.js", () => ({
	getDb: vi.fn(),
}));

import { getDb } from "../../../../../../packages/core/src/loader.js";
import { runWithContext } from "../../../../../../packages/core/src/request-context.js";
import {
	getAllTermsForEntries,
	getEntryTerms,
	getTermsForEntries,
	invalidateTermCache,
} from "../../../../../../packages/core/src/taxonomies/index.js";

describe("getAllTermsForEntries", () => {
	let db: Kysely<Database>;
	let taxRepo: TaxonomyRepository;
	let contentRepo: ContentRepository;

	beforeEach(async () => {
		db = await setupTestDatabaseWithCollections();
		taxRepo = new TaxonomyRepository(db);
		contentRepo = new ContentRepository(db);
		vi.mocked(getDb).mockResolvedValue(db);
		invalidateTermCache();
	});

	afterEach(async () => {
		invalidateTermCache();
		await teardownTestDatabase(db);
		vi.restoreAllMocks();
	});

	it("returns empty map for empty entry list", async () => {
		const result = await getAllTermsForEntries("post", []);
		expect(result.size).toBe(0);
	});

	it("short-circuits without querying when no assignments exist", async () => {
		await taxRepo.create({ name: "tag", slug: "a", label: "A" });

		const post = await contentRepo.create({
			type: "post",
			slug: "p1",
			data: { title: "P1" },
		});

		const result = await getAllTermsForEntries("post", [post.id]);

		expect(result.get(post.id)).toEqual({});
	});

	it("hydrates terms grouped by taxonomy name in a single query", async () => {
		const tag1 = await taxRepo.create({ name: "tag", slug: "web", label: "Web" });
		const tag2 = await taxRepo.create({ name: "tag", slug: "ai", label: "AI" });
		const cat = await taxRepo.create({ name: "category", slug: "news", label: "News" });

		const p1 = await contentRepo.create({
			type: "post",
			slug: "p1",
			data: { title: "P1" },
		});
		const p2 = await contentRepo.create({
			type: "post",
			slug: "p2",
			data: { title: "P2" },
		});

		await taxRepo.attachToEntry("post", p1.id, tag1.id);
		await taxRepo.attachToEntry("post", p1.id, tag2.id);
		await taxRepo.attachToEntry("post", p1.id, cat.id);
		await taxRepo.attachToEntry("post", p2.id, tag1.id);

		invalidateTermCache();

		const result = await getAllTermsForEntries("post", [p1.id, p2.id]);

		expect(result.size).toBe(2);

		const p1Terms = result.get(p1.id)!;
		expect(Object.keys(p1Terms).toSorted()).toEqual(["category", "tag"]);
		expect(p1Terms.tag.map((t) => t.slug).toSorted()).toEqual(["ai", "web"]);
		expect(p1Terms.category.map((t) => t.slug)).toEqual(["news"]);

		const p2Terms = result.get(p2.id)!;
		expect(Object.keys(p2Terms)).toEqual(["tag"]);
		expect(p2Terms.tag.map((t) => t.slug)).toEqual(["web"]);
	});

	it("scopes results to the requested collection", async () => {
		const tag = await taxRepo.create({ name: "tag", slug: "shared", label: "Shared" });

		const post = await contentRepo.create({
			type: "post",
			slug: "p",
			data: { title: "P" },
		});
		const page = await contentRepo.create({
			type: "page",
			slug: "pg",
			data: { title: "Pg" },
		});

		await taxRepo.attachToEntry("post", post.id, tag.id);
		await taxRepo.attachToEntry("page", page.id, tag.id);

		invalidateTermCache();

		const postTerms = await getAllTermsForEntries("post", [post.id, page.id]);
		expect(postTerms.get(post.id)?.tag?.[0].slug).toBe("shared");
		expect(postTerms.get(page.id)).toEqual({});
	});

	it("returns empty arrays for entries with no terms", async () => {
		const tag = await taxRepo.create({ name: "tag", slug: "one", label: "One" });
		const p1 = await contentRepo.create({
			type: "post",
			slug: "p1",
			data: { title: "P1" },
		});
		const p2 = await contentRepo.create({
			type: "post",
			slug: "p2",
			data: { title: "P2" },
		});
		await taxRepo.attachToEntry("post", p1.id, tag.id);

		invalidateTermCache();

		const result = await getAllTermsForEntries("post", [p1.id, p2.id]);
		expect(result.get(p1.id)?.tag?.[0].slug).toBe("one");
		expect(result.get(p2.id)).toEqual({});
	});

	it("primes the request cache so getEntryTerms doesn't re-query", async () => {
		await db
			.updateTable("_emdash_taxonomy_defs")
			.set({ collections: JSON.stringify(["posts", "post"]) })
			.where("name", "=", "tag")
			.execute();

		const tag = await taxRepo.create({ name: "tag", slug: "web", label: "Web" });
		const p1 = await contentRepo.create({
			type: "post",
			slug: "p1",
			data: { title: "P1" },
		});
		const p2 = await contentRepo.create({
			type: "post",
			slug: "p2",
			data: { title: "P2" },
		});
		await taxRepo.attachToEntry("post", p1.id, tag.id);

		invalidateTermCache();

		const getDbSpy = vi.mocked(getDb);

		await runWithContext({ editMode: false }, async () => {
			await getAllTermsForEntries("post", [p1.id, p2.id]);

			const callsAfterBatch = getDbSpy.mock.calls.length;

			const p1Tags = await getEntryTerms("post", p1.id, "tag");
			const p2Tags = await getEntryTerms("post", p2.id, "tag");
			const p1All = await getEntryTerms("post", p1.id);

			expect(getDbSpy.mock.calls.length).toBe(callsAfterBatch);

			expect(p1Tags.map((t) => t.slug)).toEqual(["web"]);
			expect(p2Tags).toEqual([]);
			expect(p1All.map((t) => t.slug)).toEqual(["web"]);
		});
	});

	it("does not leak primed entries across requests", async () => {
		await db
			.updateTable("_emdash_taxonomy_defs")
			.set({ collections: JSON.stringify(["posts", "post"]) })
			.where("name", "=", "tag")
			.execute();

		const tag = await taxRepo.create({ name: "tag", slug: "web", label: "Web" });
		const p1 = await contentRepo.create({
			type: "post",
			slug: "p1",
			data: { title: "P1" },
		});
		await taxRepo.attachToEntry("post", p1.id, tag.id);

		invalidateTermCache();

		await runWithContext({ editMode: false }, async () => {
			await getAllTermsForEntries("post", [p1.id]);
		});

		const getDbSpy = vi.mocked(getDb);
		const callsBeforeSecondRequest = getDbSpy.mock.calls.length;

		await runWithContext({ editMode: false }, async () => {
			await getEntryTerms("post", p1.id, "tag");
		});

		expect(getDbSpy.mock.calls.length).toBeGreaterThan(callsBeforeSecondRequest);
	});

	it("getTermsForEntries serves primed entries from cache without re-querying", async () => {
		await db
			.updateTable("_emdash_taxonomy_defs")
			.set({ collections: JSON.stringify(["posts", "post"]) })
			.where("name", "=", "tag")
			.execute();

		const tag = await taxRepo.create({ name: "tag", slug: "web", label: "Web" });
		const p1 = await contentRepo.create({ type: "post", slug: "p1", data: { title: "P1" } });
		const p2 = await contentRepo.create({ type: "post", slug: "p2", data: { title: "P2" } });
		await taxRepo.attachToEntry("post", p1.id, tag.id);

		invalidateTermCache();
		const getDbSpy = vi.mocked(getDb);

		await runWithContext({ editMode: false }, async () => {
			await getAllTermsForEntries("post", [p1.id, p2.id]);
			const callsAfterBatch = getDbSpy.mock.calls.length;

			const map = await getTermsForEntries("post", [p1.id, p2.id], "tag");

			expect(getDbSpy.mock.calls.length).toBe(callsAfterBatch);
			expect(map.get(p1.id)!.map((t) => t.slug)).toEqual(["web"]);
			expect(map.get(p2.id)).toEqual([]);
		});
	});

	it("getTermsForEntries returns private copies that can't poison the cache", async () => {
		await db
			.updateTable("_emdash_taxonomy_defs")
			.set({ collections: JSON.stringify(["posts", "post"]) })
			.where("name", "=", "tag")
			.execute();

		const tagA = await taxRepo.create({ name: "tag", slug: "a", label: "A" });
		const tagB = await taxRepo.create({ name: "tag", slug: "b", label: "B" });
		const p1 = await contentRepo.create({ type: "post", slug: "p1", data: { title: "P1" } });
		await taxRepo.attachToEntry("post", p1.id, tagA.id);
		await taxRepo.attachToEntry("post", p1.id, tagB.id);

		invalidateTermCache();

		await runWithContext({ editMode: false }, async () => {
			await getAllTermsForEntries("post", [p1.id]);

			const first = await getTermsForEntries("post", [p1.id], "tag");
			const arr = first.get(p1.id)!;
			expect(arr.map((t) => t.slug).toSorted()).toEqual(["a", "b"]);

			arr.length = 0;
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- deliberate junk for the mutation test
			arr.push({ slug: "junk" } as unknown as (typeof arr)[number]);

			const viaEntry = await getEntryTerms("post", p1.id, "tag");
			expect(viaEntry.map((t) => t.slug).toSorted()).toEqual(["a", "b"]);

			const second = await getTermsForEntries("post", [p1.id], "tag");
			expect(
				second
					.get(p1.id)!
					.map((t) => t.slug)
					.toSorted(),
			).toEqual(["a", "b"]);
		});
	});
});
