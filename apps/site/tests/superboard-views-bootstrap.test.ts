import { applySeed, type SeedFile } from "emdash";
import { afterEach, expect, test } from "vitest";

import baseline from "../../../config/superboard-plugin-independence-baseline.json";
import { handleContentList } from "../../../packages/core/src/api/handlers/content.js";
import { contentListQuery } from "../../../packages/core/src/api/schemas/content.js";
import { MenuRepository } from "../../../packages/core/src/database/repositories/menu.js";
import {
	setupTestDatabase,
	teardownTestDatabase,
} from "../../../packages/core/tests/utils/test-db.js";
import legacyMenu from "../seed/legacy-superboard-menu.json";
import seedJson from "../seed/seed.json";
import { ensureNativeFrontMenus } from "../src/lib/native-front-menu-bootstrap.js";
import {
	ensureSuperBoardViews,
	restrictSuperBoardViewFilters,
} from "../src/lib/superboard-views.js";

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
	expect(viewCount?.count).toBe(127);
	expect(menuCount?.count).toBeGreaterThan(80);
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
	expect(after).toBe(127);
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
		.select(["path", "name", "route_id", "renderer_id", "bindings"])
		.execute();
	const edited = entries.find(({ path }) => path === "/analytics/views");
	const marker = await db
		.selectFrom("options")
		.select("value")
		.where("name", "=", "superboard_views_bootstrap")
		.executeTakeFirst();

	expect(entries).toHaveLength(127);
	for (const entry of entries) {
		const inventoried = baseline.plugins
			.flatMap((plugin) => plugin.routes)
			.find((route) => route.route_id === entry.route_id);
		expect(
			inventoried?.renderers ??
				(entry.route_id === "superboard.mcp"
					? ["supbrd-plugmod-mcp.renderer.admin_surface"]
					: entry.route_id === "superboard.notifications"
						? ["supbrd-plugmod-marketing.renderer.admin_surface"]
						: entry.route_id.startsWith("superboard.plugins_vocostar_")
							? ["supbrd-plugmod-vocostar.renderer.admin_surface"]
							: []),
			entry.path,
		).toContain(entry.renderer_id);
		expect(JSON.parse(String(entry.bindings)).data_sources.length, entry.path).toBeGreaterThan(0);
	}
	expect(edited?.name).toBe("Edited Analytics Views");
	expect(JSON.parse(String(edited?.bindings)).data_sources).toEqual([
		"supbrd-plugmod-analytics.data_source.operator_custom",
	]);
	expect(marker?.value).toBe(JSON.stringify("5.0.0"));
});

async function countViews(): Promise<number> {
	const result = await db
		.selectFrom(db.dynamic.ref("ec_views"))
		.select(({ fn }) => fn.countAll<number>().as("count"))
		.executeTakeFirst();
	return result?.count ?? 0;
}

test("only active plugin Views are paginated and disabling preserves customizations", async () => {
	db = await setupTestDatabase();
	await ensureSuperBoardViews(db);
	await db
		.updateTable(db.dynamic.ref("ec_views"))
		.set({ name: "Custom analytics page" })
		.where("path", "=", "/analytics/views")
		.execute();
	const url = new URL("https://site.test/_emdash/api/content/views?limit=1&locale=en");
	restrictSuperBoardViewFilters(url, ["supbrd-plugmod-analytics"]);
	const first = await handleContentList(
		db,
		"views",
		contentListQuery.parse(Object.fromEntries(url.searchParams)),
	);
	expect(first.success).toBe(true);
	if (!first.success) throw new Error("content list failed");
	expect(first.data.items).toHaveLength(1);
	expect(first.data.items.every((item) => item.data.plugin_id === "supbrd-plugmod-analytics")).toBe(
		true,
	);
	const disabled = new URL("https://site.test/_emdash/api/content/views?locale=en");
	restrictSuperBoardViewFilters(disabled, []);
	const hidden = await handleContentList(
		db,
		"views",
		contentListQuery.parse(Object.fromEntries(disabled.searchParams)),
	);
	expect(hidden.success && hidden.data.items).toEqual([]);
	const active = new URL("https://site.test/_emdash/api/content/views?limit=100&locale=en");
	restrictSuperBoardViewFilters(active, ["supbrd-plugmod-analytics"]);
	const restored = await handleContentList(
		db,
		"views",
		contentListQuery.parse(Object.fromEntries(active.searchParams)),
	);
	expect(
		restored.success &&
			restored.data.items.some((item) => item.data.name === "Custom analytics page"),
	).toBe(true);
	expect(await countViews()).toBe(127);
});

test("a caller cannot opt a disabled plugin into the Views list", async () => {
	db = await setupTestDatabase();
	await ensureSuperBoardViews(db);
	const url = new URL("https://site.test/_emdash/api/content/views?locale=en");
	url.searchParams.set(
		"fieldFilters",
		JSON.stringify({ plugin_id: { in: ["supbrd-plugmod-paywalls", "supbrd-plug-settings"] } }),
	);
	restrictSuperBoardViewFilters(url, ["supbrd-plugmod-analytics"]);
	const result = await handleContentList(
		db,
		"views",
		contentListQuery.parse(Object.fromEntries(url.searchParams)),
	);
	expect(result.success && result.data.items).toEqual([]);
});

test("every inventoried plugin route owns a retained editable View, including parameterized and menu-less routes", async () => {
	db = await setupTestDatabase();
	await ensureSuperBoardViews(db);
	const views = await db
		.selectFrom(db.dynamic.ref("ec_views"))
		.select(["id", "plugin_id", "route_id", "path", "renderer_id"])
		.execute();
	for (const plugin of baseline.plugins) {
		for (const route of plugin.routes) {
			const matching = views.filter((view) => view.route_id === route.route_id);
			expect(matching, route.path).toHaveLength(1);
			expect(matching[0]).toMatchObject({ plugin_id: plugin.plugin_id, path: route.path });
		}
	}
	const paywall = views.find((view) => view.path === "/paywalls");
	expect(paywall).toBeDefined();
	await db
		.updateTable(db.dynamic.ref("ec_views"))
		.set({ name: "My retained paywall view" })
		.where("id", "=", paywall!.id)
		.execute();
	await ensureSuperBoardViews(db);
	expect(
		await db
			.selectFrom(db.dynamic.ref("ec_views"))
			.select("name")
			.where("id", "=", paywall!.id)
			.executeTakeFirst(),
	).toEqual({ name: "My retained paywall view" });
});

test("the legacy default menu becomes native bilingual front navigation and later edits survive", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: [legacyMenu] });
	await ensureSuperBoardViews(db);
	const repo = new MenuRepository(db);
	const menus = await repo.findByName("superboard-admin");
	expect(menus.map((menu) => menu.locale).toSorted()).toEqual(["en", "fr"]);
	const french = menus.find((menu) => menu.locale === "fr")!;
	expect(french.label).toBe("Navigation du front");
	const items = await repo.findItems(french.id);
	expect(items.some((item) => item.label === "Utilisateurs et accès")).toBe(true);
	expect(items.some((item) => item.customUrl === "/support/configuration")).toBe(true);
	await repo.setItems(french.id, "fr", [
		{ type: "custom", label: "Mes chiffres", customUrl: "/analytics" },
	]);
	await ensureNativeFrontMenus(db, seedJson.menus);
	expect((await repo.findItems(french.id)).map((item) => item.label)).toEqual(["Mes chiffres"]);
});

test("customized legacy EmDash navigation is not replaced during upgrade", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: [legacyMenu] });
	const repo = new MenuRepository(db);
	const menu = (await repo.findByName("superboard-admin", { locale: "en" }))[0]!;
	await repo.setItems(menu.id, "en", [
		{ type: "custom", label: "My overview", customUrl: "/analytics" },
	]);
	await ensureSuperBoardViews(db);
	expect((await repo.findItems(menu.id)).map((item) => item.label)).toEqual(["My overview"]);
});
