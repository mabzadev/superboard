import { applySeed, type SeedFile } from "emdash";
import { afterEach, expect, test } from "vitest";

import {
	setupTestDatabase,
	teardownTestDatabase,
} from "../../../packages/core/tests/utils/test-db.js";
import seedJson from "../seed/seed.json";
import { ensureSuperBoardViews } from "../src/lib/superboard-views.js";

let db: Awaited<ReturnType<typeof setupTestDatabase>>;

afterEach(async () => {
	await teardownTestDatabase(db);
});

test("an existing EmDash instance upgrades from Pages and Posts to Views", async () => {
	db = await setupTestDatabase();
	await applySeed(db, {
		version: "1",
		collections: [
			{
				slug: "pages",
				label: "Pages",
				labelSingular: "Page",
				fields: [{ slug: "title", label: "Title", type: "string" }],
			},
			{
				slug: "posts",
				label: "Posts",
				labelSingular: "Post",
				fields: [{ slug: "title", label: "Title", type: "string" }],
			},
		],
	});

	await ensureSuperBoardViews(db);

	const collections = await db
		.selectFrom("_emdash_collections")
		.select(["slug", "hidden"])
		.where("slug", "in", ["pages", "posts", "views"])
		.orderBy("slug")
		.execute();
	const viewCount = await db
		.selectFrom(db.dynamic.ref("ec_views"))
		.select(({ fn }) => fn.countAll<number>().as("count"))
		.executeTakeFirst();
	const menuCount = await db
		.selectFrom("_emdash_menu_items")
		.innerJoin("_emdash_menus", "_emdash_menus.id", "_emdash_menu_items.menu_id")
		.select(({ fn }) => fn.countAll<number>().as("count"))
		.where("_emdash_menus.name", "=", "superboard-admin")
		.executeTakeFirst();

	expect(collections).toEqual([
		{ slug: "pages", hidden: 1 },
		{ slug: "posts", hidden: 1 },
		{ slug: "views", hidden: 0 },
	]);
	expect(viewCount?.count).toBe(71);
	expect(menuCount?.count).toBe(80);
});

test("the Views bootstrap resumes after the schema was created without content", async () => {
	db = await setupTestDatabase();
	await applySeed(db, seedJson as unknown as SeedFile, {
		includeContent: false,
		onConflict: "skip",
	});
	const before = await countViews();

	await ensureSuperBoardViews(db);

	const after = await countViews();
	expect(before).toBe(0);
	expect(after).toBe(71);
});

test("the Views bootstrap upgrades existing renderer bindings without overwriting edits", async () => {
	db = await setupTestDatabase();
	const legacySeed = {
		...seedJson,
		collections: seedJson.collections.map((collection) => ({
			...collection,
			fields: collection.fields.filter(({ slug }) => slug !== "renderer_id"),
		})),
		content: {
			views: seedJson.content.views.map((view) => {
				const { renderer_id: _rendererId, ...data } = view.data;
				return {
					...view,
					data: { ...data, bindings: { commands: [], data_sources: [] } },
				};
			}),
		},
	};
	await applySeed(db, legacySeed as unknown as SeedFile, {
		includeContent: true,
		onConflict: "skip",
	});
	await db
		.updateTable(db.dynamic.ref("ec_views"))
		.set({
			bindings: JSON.stringify({
				commands: [],
				data_sources: ["supbrd-plugmod-analytics.data_source.operator_custom"],
			}),
			name: "Edited Analytics Views",
		})
		.where("path", "=", "/analytics/views")
		.execute();
	await db
		.insertInto("options")
		.values({ name: "superboard_views_bootstrap", value: JSON.stringify("1.0.0") })
		.execute();

	await ensureSuperBoardViews(db);

	const entries = await db
		.selectFrom(db.dynamic.ref("ec_views"))
		.select(["path", "name", "renderer_id", "bindings"])
		.execute();
	const edited = entries.find(({ path }) => path === "/analytics/views");
	const marker = await db
		.selectFrom("options")
		.select("value")
		.where("name", "=", "superboard_views_bootstrap")
		.executeTakeFirst();

	expect(entries).toHaveLength(71);
	for (const entry of entries) {
		expect(entry.renderer_id, entry.path).toMatch(/\.renderer\.admin_surface$/u);
		expect(JSON.parse(String(entry.bindings)).data_sources.length, entry.path).toBeGreaterThan(0);
	}
	expect(edited?.name).toBe("Edited Analytics Views");
	expect(JSON.parse(String(edited?.bindings)).data_sources).toEqual([
		"supbrd-plugmod-analytics.data_source.operator_custom",
	]);
	expect(marker?.value).toBe(JSON.stringify("2.1.0"));
});

async function countViews(): Promise<number> {
	const result = await db
		.selectFrom(db.dynamic.ref("ec_views"))
		.select(({ fn }) => fn.countAll<number>().as("count"))
		.executeTakeFirst();
	return result?.count ?? 0;
}
