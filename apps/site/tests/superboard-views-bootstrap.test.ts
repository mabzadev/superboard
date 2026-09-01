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

async function countViews(): Promise<number> {
	const result = await db
		.selectFrom(db.dynamic.ref("ec_views"))
		.select(({ fn }) => fn.countAll<number>().as("count"))
		.executeTakeFirst();
	return result?.count ?? 0;
}
