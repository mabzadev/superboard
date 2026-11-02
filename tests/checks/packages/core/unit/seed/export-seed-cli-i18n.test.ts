import type { Kysely } from "kysely";
import { sql } from "kysely";
import { ulid } from "ulidx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportSeed } from "../../../../../../packages/core/src/cli/commands/export-seed.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setI18nConfig } from "../../../../../../packages/core/src/i18n/config.js";
import { validateSeed } from "../../../../../../packages/core/src/seed/validate.js";
import {
	setupTestDatabase,
	setupTestDatabaseWithCollections,
	teardownTestDatabase,
} from "../../utils/test-db.js";

async function insertTaxonomyDef(
	db: Kysely<Database>,
	args: { id: string; name: string; label: string; locale: string; group: string },
) {
	await db
		.insertInto("_emdash_taxonomy_defs")
		.values({
			id: args.id,
			name: args.name,
			label: args.label,
			hierarchical: 0,
			collections: JSON.stringify(["post"]),
			created_at: new Date().toISOString(),
			locale: args.locale,
			translation_group: args.group,
		})
		.execute();
}

async function insertTerm(
	db: Kysely<Database>,
	args: { id: string; name: string; slug: string; label: string; locale: string; group: string },
) {
	await db
		.insertInto("taxonomies")
		.values({
			id: args.id,
			name: args.name,
			slug: args.slug,
			label: args.label,
			parent_id: null,
			data: null,
			locale: args.locale,
			translation_group: args.group,
		})
		.execute();
}

async function insertMenu(
	db: Kysely<Database>,
	args: { id: string; name: string; label: string; locale: string; group: string },
) {
	const now = new Date().toISOString();
	await db
		.insertInto("_emdash_menus")
		.values({
			id: args.id,
			name: args.name,
			label: args.label,
			created_at: now,
			updated_at: now,
			locale: args.locale,
			translation_group: args.group,
		})
		.execute();
}

describe("exportSeed: CLI (no runtime i18n config) stays locale-aware (#1330)", () => {
	let db: Kysely<Database>;

	beforeEach(() => {
		setI18nConfig(null);
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
		setI18nConfig(null);
	});

	it("suffixes taxonomy def + term ids per locale instead of colliding", async () => {
		db = await setupTestDatabase();

		const enGroup = ulid();
		const enDefId = ulid();
		const arDefId = ulid();
		await insertTaxonomyDef(db, {
			id: enDefId,
			name: "genre",
			label: "Categories",
			locale: "en",
			group: enGroup,
		});
		await insertTaxonomyDef(db, {
			id: arDefId,
			name: "genre",
			label: "التصنيفات",
			locale: "ar",
			group: enGroup,
		});

		const enTermGroup = ulid();
		await insertTerm(db, {
			id: ulid(),
			name: "genre",
			slug: "news",
			label: "News",
			locale: "en",
			group: enTermGroup,
		});
		await insertTerm(db, {
			id: ulid(),
			name: "genre",
			slug: "news",
			label: "أخبار",
			locale: "ar",
			group: enTermGroup,
		});

		const seed = await exportSeed(db);

		const cats = seed.taxonomies?.filter((t) => t.name === "genre") ?? [];
		expect(cats).toHaveLength(2);

		const ids = cats.map((t) => t.id);
		expect(new Set(ids).size).toBe(2);
		expect(new Set(ids)).toEqual(new Set(["tax:genre:en", "tax:genre:ar"]));

		const anchor = cats.find((t) => !t.translationOf);
		const translation = cats.find((t) => t.translationOf);
		expect(anchor?.locale).toBeDefined();
		expect(translation?.translationOf).toBe(anchor?.id);

		const termIds = cats.flatMap((t) => (t.terms ?? []).map((term) => term.id));
		expect(termIds).toEqual(expect.arrayContaining(["term:genre:news:en", "term:genre:news:ar"]));
		expect(new Set(termIds).size).toBe(termIds.length);

		const result = validateSeed(seed);
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
	});

	it("suffixes menu ids per locale instead of colliding", async () => {
		db = await setupTestDatabase();

		const group = ulid();
		await insertMenu(db, {
			id: ulid(),
			name: "primary",
			label: "Primary",
			locale: "en",
			group,
		});
		await insertMenu(db, {
			id: ulid(),
			name: "primary",
			label: "الرئيسية",
			locale: "ar",
			group,
		});

		const seed = await exportSeed(db);

		const menus = seed.menus?.filter((m) => m.name === "primary") ?? [];
		expect(menus).toHaveLength(2);
		const ids = menus.map((m) => m.id);
		expect(new Set(ids)).toEqual(new Set(["menu:primary:en", "menu:primary:ar"]));

		const anchor = menus.find((m) => !m.translationOf);
		const translation = menus.find((m) => m.translationOf);
		expect(translation?.translationOf).toBe(anchor?.id);

		const result = validateSeed(seed);
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
	});

	it("suffixes content entry ids per locale instead of colliding", async () => {
		db = await setupTestDatabaseWithCollections();

		const now = new Date().toISOString();
		const group = ulid();
		await db
			.insertInto("ec_post")
			.values({
				id: ulid(),
				slug: "hello",
				status: "published",
				created_at: now,
				updated_at: now,
				version: 1,
				locale: "en",
				translation_group: group,
				title: "Hello",
			} as never)
			.execute();
		await db
			.insertInto("ec_post")
			.values({
				id: ulid(),
				slug: "hello",
				status: "published",
				created_at: now,
				updated_at: now,
				version: 1,
				locale: "ar",
				translation_group: group,
				title: "مرحبا",
			} as never)
			.execute();

		const seed = await exportSeed(db, "post");

		const posts = seed.content?.post ?? [];
		expect(posts).toHaveLength(2);
		const ids = posts.map((p) => p.id);
		expect(new Set(ids)).toEqual(new Set(["post:hello:en", "post:hello:ar"]));

		const anchor = posts.find((p) => !p.translationOf);
		const translation = posts.find((p) => p.translationOf);
		expect(translation?.translationOf).toBe(anchor?.id);

		const result = validateSeed(seed);
		expect(result.errors).toEqual([]);
		expect(result.valid).toBe(true);
	});

	it("does not crash when a collection row outlives its dropped ec_* table", async () => {
		db = await setupTestDatabaseWithCollections();

		await sql`DROP TABLE ec_post`.execute(db);

		const seed = await exportSeed(db);

		expect(seed.collections?.some((c) => c.slug === "post")).toBe(true);
	});

	it("keeps bare ids for genuinely single-locale projects", async () => {
		db = await setupTestDatabase();

		await insertTaxonomyDef(db, {
			id: ulid(),
			name: "genre",
			label: "Categories",
			locale: "en",
			group: ulid(),
		});

		const seed = await exportSeed(db);
		const cat = seed.taxonomies?.find((t) => t.name === "genre");
		expect(cat?.id).toBe("tax:genre");
		expect(cat?.locale).toBeUndefined();
		expect(cat?.translationOf).toBeUndefined();
	});

	it("self-describes the default locale for a single-locale non-en project (#1421)", async () => {
		db = await setupTestDatabase();

		await db.updateTable("_emdash_taxonomy_defs").set({ locale: "de" }).execute();
		await insertTaxonomyDef(db, {
			id: ulid(),
			name: "genre",
			label: "Kategorien",
			locale: "de",
			group: ulid(),
		});

		const seed = await exportSeed(db);

		expect(seed.defaultLocale).toBe("de");
		const cat = seed.taxonomies?.find((t) => t.name === "genre");
		expect(cat?.id).toBe("tax:genre");
		expect(cat?.locale).toBeUndefined();
	});

	it("omits defaultLocale for multi-locale data (rows self-describe their locale)", async () => {
		db = await setupTestDatabase();

		const group = ulid();
		await insertMenu(db, { id: ulid(), name: "primary", label: "Primary", locale: "en", group });
		await insertMenu(db, { id: ulid(), name: "primary", label: "الرئيسية", locale: "ar", group });

		const seed = await exportSeed(db);

		expect(seed.defaultLocale).toBeUndefined();
	});
});
