import type { Kysely } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { ContentRepository } from "../../../../../packages/core/src/database/repositories/content.js";
import { TaxonomyRepository } from "../../../../../packages/core/src/database/repositories/taxonomy.js";
import type { Database } from "../../../../../packages/core/src/database/types.js";
import {
	buildTaxonomyPivotQuery,
	emdashLoader,
	resetTaxonomyNamesCache,
} from "../../../../../packages/core/src/loader.js";
import { runWithContext } from "../../../../../packages/core/src/request-context.js";
import {
	describeEachDialect,
	setupForDialectWithCollections,
	teardownForDialect,
	type DialectName,
	type DialectTestContext,
} from "../utils/test-db.js";

describeEachDialect("Loader taxonomy pivot-drive", (dialectName: DialectName) => {
	let ctx: DialectTestContext;
	let db: Kysely<Database>;
	let content: ContentRepository;
	let tax: TaxonomyRepository;
	let termSeq = 0;

	beforeEach(async () => {
		ctx = await setupForDialectWithCollections(dialectName);
		db = ctx.db;
		await db
			.updateTable("_emdash_taxonomy_defs")
			.set({ collections: JSON.stringify(["post"]) })
			.where("name", "in", ["category", "tag"])
			.execute();
		resetTaxonomyNamesCache();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema vs Database type
		content = new ContentRepository(db as any);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema vs Database type
		tax = new TaxonomyRepository(db as any);
		termSeq = 0;
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	async function term(name: string, slug: string) {
		const id = `tax_${name}_${slug}_${termSeq++}`;
		await db
			.insertInto("taxonomies" as never)
			.values({ id, name, slug, label: slug, translation_group: id } as never)
			.execute();
		return id;
	}

	async function createPost(
		title: string,
		opts: {
			status?: string;
			publishedAt?: string;
			createdAt?: string;
			locale?: string;
		} = {},
	) {
		return content.create({
			type: "post",
			slug: `${title.toLowerCase().replace(/\s+/g, "-")}-${termSeq}`,
			data: { title },
			status: opts.status ?? "published",
			publishedAt: opts.publishedAt,
			createdAt: opts.createdAt,
			locale: opts.locale,
		});
	}

	function load(where: Record<string, unknown>, extra: Record<string, unknown> = {}) {
		const loader = emdashLoader();
		return runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({
				filter: { type: "post", where: where as never, ...extra },
			}),
		);
	}

	function titles(result: { entries: { data: Record<string, unknown> }[] }) {
		return result.entries.map((e) => e.data.title);
	}

	const sortAsc = (values: unknown[]) =>
		values.toSorted((a, b) => String(a).localeCompare(String(b)));

	it("selective term: returns only the one tagged entry", async () => {
		const news = await term("category", "news");
		const hit = await createPost("Hit");
		for (let i = 0; i < 20; i++) await createPost(`Filler ${i}`);
		await tax.attachToEntry("post", hit.id, news);

		const result = await load({ category: "news" });
		expect(titles(result)).toEqual(["Hit"]);
	});

	it("broad term (~half the collection): returns every tagged entry", async () => {
		const news = await term("category", "news");
		const tagged: string[] = [];
		for (let i = 0; i < 10; i++) {
			const post = await createPost(`Post ${i}`);
			if (i % 2 === 0) {
				await tax.attachToEntry("post", post.id, news);
				tagged.push(`Post ${i}`);
			}
		}

		const result = await load({ category: "news" });
		expect(sortAsc(titles(result))).toEqual(sortAsc(tagged));
	});

	it("OR within a taxonomy: dedups an entry tagged with two matched terms", async () => {
		const news = await term("category", "news");
		const sports = await term("category", "sports");
		const both = await createPost("Both");
		await tax.attachToEntry("post", both.id, news);
		await tax.attachToEntry("post", both.id, sports);

		const result = await load({ category: ["news", "sports"] });
		expect(titles(result)).toEqual(["Both"]);
	});

	it("multi-term AND: only entries tagged in every requested taxonomy match", async () => {
		const news = await term("category", "news");
		const featured = await term("tag", "featured");
		const both = await createPost("Both");
		const newsOnly = await createPost("News Only");
		await tax.attachToEntry("post", both.id, news);
		await tax.attachToEntry("post", both.id, featured);
		await tax.attachToEntry("post", newsOnly.id, news);

		const result = await load({ category: ["news"], tag: ["featured"] });
		expect(titles(result)).toEqual(["Both"]);
	});

	it("sorts by published_at (indexed) descending", async () => {
		const news = await term("category", "news");
		const a = await createPost("Old", { publishedAt: "2020-01-01T00:00:00Z" });
		const b = await createPost("New", { publishedAt: "2024-01-01T00:00:00Z" });
		const c = await createPost("Mid", { publishedAt: "2022-01-01T00:00:00Z" });
		for (const p of [a, b, c]) await tax.attachToEntry("post", p.id, news);

		const result = await load({ category: "news" }, { orderBy: { published_at: "desc" } });
		expect(titles(result)).toEqual(["New", "Mid", "Old"]);
	});

	it("sorts by created_at (indexed, loader default) descending", async () => {
		const news = await term("category", "news");
		const a = await createPost("First", { createdAt: "2020-01-01T00:00:00Z" });
		const b = await createPost("Third", { createdAt: "2024-01-01T00:00:00Z" });
		const c = await createPost("Second", { createdAt: "2022-01-01T00:00:00Z" });
		for (const p of [a, b, c]) await tax.attachToEntry("post", p.id, news);

		const result = await load({ category: "news" });
		expect(titles(result)).toEqual(["Third", "Second", "First"]);
	});

	it("sorts by updated_at (temp-sort path, not denormalized) descending", async () => {
		const news = await term("category", "news");
		const a = await createPost("A");
		const b = await createPost("B");
		for (const p of [a, b]) await tax.attachToEntry("post", p.id, news);
		await db
			.updateTable("ec_post" as never)
			.set({ updated_at: "2020-01-01T00:00:00Z" } as never)
			.where("id" as never, "=", a.id)
			.execute();
		await db
			.updateTable("ec_post" as never)
			.set({ updated_at: "2024-01-01T00:00:00Z" } as never)
			.where("id" as never, "=", b.id)
			.execute();

		const result = await load({ category: "news" }, { orderBy: { updated_at: "desc" } });
		expect(titles(result)).toEqual(["B", "A"]);
	});

	it("filters by locale", async () => {
		const group = "tax_category_news_group";
		await db
			.insertInto("taxonomies" as never)
			.values({
				id: group,
				name: "category",
				slug: "news",
				label: "News",
				locale: "en",
				translation_group: group,
			} as never)
			.execute();
		await db
			.insertInto("taxonomies" as never)
			.values({
				id: "tax_category_news_fr",
				name: "category",
				slug: "news",
				label: "Actualités",
				locale: "fr",
				translation_group: group,
			} as never)
			.execute();

		const en = await createPost("English", { locale: "en" });
		const fr = await createPost("French", { locale: "fr" });
		await tax.attachToEntry("post", en.id, group);
		await tax.attachToEntry("post", fr.id, group);

		expect(titles(await load({ category: "news" }, { locale: "fr" }))).toEqual(["French"]);
		expect(titles(await load({ category: "news" }, { locale: "en" }))).toEqual(["English"]);
	});

	it("filters by status: a draft query returns drafts, published returns published", async () => {
		const news = await term("category", "news");
		const pub = await createPost("Published", { status: "published" });
		const draft = await createPost("Draft", { status: "draft" });
		await tax.attachToEntry("post", pub.id, news);
		await tax.attachToEntry("post", draft.id, news);

		expect(titles(await load({ category: "news" }, { status: "published" }))).toEqual([
			"Published",
		]);
		expect(titles(await load({ category: "news" }, { status: "draft" }))).toEqual(["Draft"]);
	});

	async function desyncEcRow(id: string, set: Record<string, string | null>): Promise<void> {
		await db
			.updateTable("ec_post" as never)
			.set(set as never)
			.where("id" as never, "=", id)
			.execute();
	}

	it("drops a row the pivot admits but ec_* has soft-deleted", async () => {
		const news = await term("category", "news");
		const post = await createPost("Ghost");
		await tax.attachToEntry("post", post.id, news);
		await desyncEcRow(post.id, { deleted_at: "2024-01-01T00:00:00Z" });

		const result = await load({ category: "news" });
		expect(titles(result)).toEqual([]);
	});

	it("drops a row the pivot says published but ec_* has as draft", async () => {
		const news = await term("category", "news");
		const post = await createPost("SecretDraft");
		await tax.attachToEntry("post", post.id, news);
		await desyncEcRow(post.id, { status: "draft" });

		const result = await load({ category: "news" }, { status: "published" });
		expect(titles(result)).toEqual([]);
	});

	it("drops a row whose ec_* locale no longer matches the filter", async () => {
		const news = await term("category", "news");
		const post = await createPost("MovedLocale", { locale: "en" });
		await tax.attachToEntry("post", post.id, news);
		await desyncEcRow(post.id, { locale: "fr" });

		const result = await load({ category: "news" }, { locale: "en" });
		expect(titles(result)).toEqual([]);
	});

	it("under-fills (never returns wrong rows) when a stale row consumes a LIMIT slot", async () => {
		const news = await term("category", "news");
		const valid: string[] = [];
		for (let i = 0; i < 3; i++) {
			const post = await createPost(`Valid ${i}`, {
				publishedAt: `2020-0${i + 1}-01T00:00:00Z`,
			});
			await tax.attachToEntry("post", post.id, news);
			valid.push(`Valid ${i}`);
		}
		const stale = await createPost("Stale", { publishedAt: "2020-09-01T00:00:00Z" });
		await tax.attachToEntry("post", stale.id, news);
		await desyncEcRow(stale.id, { status: "draft" });

		const result = await load({ category: "news" }, { orderBy: { published_at: "desc" } });
		expect(titles(result)).not.toContain("Stale");
		expect(sortAsc(titles(result))).toEqual(sortAsc(valid));
	});

	it("publish re-stamps the pivot so the entry appears in a published listing", async () => {
		const news = await term("category", "news");
		const post = await createPost("Draft", { status: "draft" });
		await tax.attachToEntry("post", post.id, news);

		expect(titles(await load({ category: "news" }, { status: "published" }))).toEqual([]);

		await content.publish("post", post.id);
		expect(titles(await load({ category: "news" }, { status: "published" }))).toEqual(["Draft"]);
	});

	it("soft-delete then restore re-stamps the pivot both ways", async () => {
		const news = await term("category", "news");
		const post = await createPost("Toggle");
		await tax.attachToEntry("post", post.id, news);
		expect(titles(await load({ category: "news" }))).toEqual(["Toggle"]);

		await content.delete("post", post.id);
		expect(titles(await load({ category: "news" }))).toEqual([]);

		await content.restore("post", post.id);
		expect(titles(await load({ category: "news" }))).toEqual(["Toggle"]);
	});

	it("schedule updates taxonomy-filtered status from the content row", async () => {
		const news = await term("category", "news");
		const post = await createPost("Later", { status: "draft" });
		await tax.attachToEntry("post", post.id, news);

		const future = new Date(Date.now() + 86_400_000).toISOString();
		await content.schedule("post", post.id, future);

		expect(titles(await load({ category: "news" }, { status: "published" }))).toEqual([]);
		expect(titles(await load({ category: "news" }, { status: "scheduled" }))).toEqual(["Later"]);
	});

	it("paginates by keyset cursor over the pivot sort key without overlap", async () => {
		const news = await term("category", "news");
		const created: string[] = [];
		for (let i = 0; i < 5; i++) {
			const post = await createPost(`P${i}`, { publishedAt: `2020-0${i + 1}-01T00:00:00Z` });
			await tax.attachToEntry("post", post.id, news);
			created.push(`P${i}`);
		}
		const expectedOrder = created.toReversed();

		const seen: string[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 3; page++) {
			const result: Awaited<ReturnType<typeof load>> = await load(
				{ category: "news" },
				{ orderBy: { published_at: "desc" }, limit: 2, ...(cursor ? { cursor } : {}) },
			);
			seen.push(...titles(result));
			cursor = (result as { nextCursor?: string }).nextCursor;
			if (!cursor) break;
		}
		expect(seen).toEqual(expectedOrder);
		expect(new Set(seen).size).toBe(seen.length);
	});

	it("paginates the OR-within-taxonomy (GROUP BY + HAVING cursor) path", async () => {
		const news = await term("category", "news");
		const sports = await term("category", "sports");
		const created: string[] = [];
		for (let i = 0; i < 5; i++) {
			const post = await createPost(`Q${i}`, { publishedAt: `2021-0${i + 1}-01T00:00:00Z` });
			await tax.attachToEntry("post", post.id, news);
			await tax.attachToEntry("post", post.id, sports);
			created.push(`Q${i}`);
		}
		const expectedOrder = created.toReversed();

		const seen: string[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 4; page++) {
			const result: Awaited<ReturnType<typeof load>> = await load(
				{ category: ["news", "sports"] },
				{ orderBy: { published_at: "desc" }, limit: 2, ...(cursor ? { cursor } : {}) },
			);
			seen.push(...titles(result));
			cursor = (result as { nextCursor?: string }).nextCursor;
			if (!cursor) break;
		}
		expect(seen).toEqual(expectedOrder);
		expect(new Set(seen).size).toBe(seen.length);
	});

	it("ANDs a byline filter with the taxonomy filter on the pivot path", async () => {
		const news = await term("category", "news");
		const both = await createPost("Bob News");
		const taxOnly = await createPost("News Only");
		const bylineOnly = await createPost("Bob Only");
		await tax.attachToEntry("post", both.id, news);
		await tax.attachToEntry("post", taxOnly.id, news);
		await tax.attachToEntry("post", bylineOnly.id, news);
		const credit = async (id: string, group: string) =>
			db
				.insertInto("_emdash_content_bylines" as never)
				.values({
					id: `cb_${id}`,
					collection_slug: "post",
					content_id: id,
					byline_id: group,
					sort_order: 0,
				} as never)
				.execute();
		await credit(both.id, "byline_bob");
		await credit(bylineOnly.id, "byline_alice");

		const result = await load({ category: "news", byline: "byline_bob" });
		expect(titles(result)).toEqual(["Bob News"]);
	});

	it("builder serves the trash shape (deleted_at IS NOT NULL)", async () => {
		const news = await term("category", "news");
		const live = await createPost("Live");
		const trashed = await createPost("Trashed");
		await tax.attachToEntry("post", live.id, news);
		await tax.attachToEntry("post", trashed.id, news);
		await content.delete("post", trashed.id);

		const rows = await buildTaxonomyPivotQuery({
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema vs Database type
			db: db as any,
			collection: "post",
			tableName: "ec_post",
			groupSets: [[news]],
			orderBy: undefined,
			cursor: undefined,
			locale: undefined,
			status: undefined,
			deletedIsNull: false,
			bylineGroups: null,
			fetchLimit: undefined,
			offset: undefined,
		}).execute(db);

		expect(rows.rows.map((r) => (r.title as string) ?? r.slug)).toEqual(["Trashed"]);
	});

	it("builder serves an all-statuses live shape (status undefined)", async () => {
		const news = await term("category", "news");
		const pub = await createPost("Pub", { status: "published" });
		const draft = await createPost("Draft", { status: "draft" });
		await tax.attachToEntry("post", pub.id, news);
		await tax.attachToEntry("post", draft.id, news);

		const rows = await buildTaxonomyPivotQuery({
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema vs Database type
			db: db as any,
			collection: "post",
			tableName: "ec_post",
			groupSets: [[news]],
			orderBy: undefined,
			cursor: undefined,
			locale: undefined,
			status: undefined,
			deletedIsNull: true,
			bylineGroups: null,
			fetchLimit: undefined,
			offset: undefined,
		}).execute(db);

		const seen = sortAsc(rows.rows.map((r) => r.status as string));
		expect(seen).toEqual(["draft", "published"]);
	});
});
