import { it, expect, beforeEach, afterEach } from "vitest";

import { handleContentCreate } from "../../../../../packages/core/src/api/index.js";
import { SeoRepository } from "../../../../../packages/core/src/database/repositories/seo.js";
import { emdashLoader } from "../../../../../packages/core/src/loader.js";
import { runWithContext } from "../../../../../packages/core/src/request-context.js";
import { SchemaRegistry } from "../../../../../packages/core/src/schema/registry.js";
import {
	describeEachDialect,
	setupForDialect,
	teardownForDialect,
	type DialectTestContext,
} from "../utils/test-db.js";

describeEachDialect("Loader on wide-schema collections (#1600)", (dialect) => {
	let ctx: DialectTestContext;
	let seoRepo: SeoRepository;
	const COLLECTION = "wide_collection";
	const USER_FIELD_COUNT = 95;

	beforeEach(async () => {
		ctx = await setupForDialect(dialect);
		const registry = new SchemaRegistry(ctx.db);

		await registry.createCollection({
			slug: COLLECTION,
			label: "Wide Collection",
			labelSingular: "Wide Entry",
		});
		await registry.createField(COLLECTION, {
			slug: "title",
			label: "Title",
			type: "string",
		});
		for (let i = 1; i <= USER_FIELD_COUNT; i++) {
			await registry.createField(COLLECTION, {
				slug: `field_${i}`,
				label: `Field ${i}`,
				type: "string",
			});
		}
		await ctx.db
			.updateTable("_emdash_collections")
			.set({ has_seo: 1 })
			.where("slug", "=", COLLECTION)
			.execute();

		seoRepo = new SeoRepository(ctx.db);
	});

	afterEach(async () => {
		await teardownForDialect(ctx);
	});

	function load(idOrSlug: string) {
		const loader = emdashLoader();
		return runWithContext({ db: ctx.db }, () =>
			loader.loadEntry!({ filter: { type: COLLECTION, id: idOrSlug } }),
		);
	}

	it("loads an entry from a collection with 95+ flat user columns", async () => {
		const data: Record<string, string> = { title: "Wide Entry" };
		for (let i = 1; i <= USER_FIELD_COUNT; i++) {
			data[`field_${i}`] = `value-${i}`;
		}
		const result = await handleContentCreate(ctx.db, COLLECTION, {
			data,
			status: "published",
		});
		if (!result.success) throw new Error("Failed to create entry");
		const slug = result.data!.item.slug!;

		const loaded = await load(slug);

		expect(loaded).toBeDefined();
		expect((loaded as { data: Record<string, unknown> }).data.title).toBe("Wide Entry");
		const loadedData = (loaded as { data: Record<string, unknown> }).data;
		expect(loadedData.field_1).toBe("value-1");
		expect(loadedData.field_50).toBe("value-50");
		expect(loadedData.field_95).toBe("value-95");
	});

	it("still attaches data.seo on wide collections (folded JSON column)", async () => {
		const data: Record<string, string> = { title: "Wide With SEO" };
		for (let i = 1; i <= USER_FIELD_COUNT; i++) {
			data[`field_${i}`] = `value-${i}`;
		}
		const result = await handleContentCreate(ctx.db, COLLECTION, {
			data,
			status: "published",
		});
		if (!result.success) throw new Error("Failed to create entry");
		const item = result.data!.item;

		await seoRepo.upsert(COLLECTION, item.id, {
			noIndex: true,
			canonical: "https://example.com/wide",
			title: "Wide SEO Title",
		});

		const loaded = await load(item.slug!);
		const loadedData = (loaded as { data: Record<string, unknown> }).data;
		const seo = loadedData.seo as Record<string, unknown> | undefined;

		expect(seo).toBeDefined();
		expect(seo!.noIndex).toBe(true);
		expect(seo!.canonical).toBe("https://example.com/wide");
		expect(seo!.title).toBe("Wide SEO Title");
	});

	it("omits data.seo when no SEO row exists, even on wide collections", async () => {
		const data: Record<string, string> = { title: "No SEO" };
		for (let i = 1; i <= USER_FIELD_COUNT; i++) {
			data[`field_${i}`] = `value-${i}`;
		}
		const result = await handleContentCreate(ctx.db, COLLECTION, {
			data,
			status: "published",
		});
		if (!result.success) throw new Error("Failed to create entry");
		const slug = result.data!.item.slug!;

		const loaded = await load(slug);
		const loadedData = (loaded as { data: Record<string, unknown> }).data;

		expect(loadedData.seo).toBeUndefined();
	});
});
