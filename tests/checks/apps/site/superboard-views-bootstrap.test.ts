import { applySeed, type SeedFile } from "emdash";
import { afterEach, expect, test } from "vitest";

import legacyAuthenticationMenus from "../../../../apps/site/seed/legacy-authentication-menus.json";
import legacyProductMenus from "../../../../apps/site/seed/legacy-product-menus.json";
import legacyMenu from "../../../../apps/site/seed/legacy-superboard-menu.json";
import seedJson from "../../../../apps/site/seed/seed.json";
import { CORE_OPERATOR_SURFACES } from "../../../../apps/site/src/lib/core-front-contract.js";
import { ensureNativeFrontMenus } from "../../../../apps/site/src/lib/native-front-menu-bootstrap.js";
import { nativeFrontPluginCatalog } from "../../../../apps/site/src/lib/native-front-plugins.js";
import { retiredFrontPageDestination } from "../../../../apps/site/src/lib/retired-front-pages.js";
import {
	ensureSuperBoardViews,
	restrictSuperBoardViewFilters,
} from "../../../../apps/site/src/lib/superboard-views.js";
import {
	canonicalFrontHref,
	canonicalFrontPath,
} from "../../../../packages/contracts/src/front-paths.js";
import { handleContentList } from "../../../../packages/core/src/api/handlers/content.js";
import { contentListQuery } from "../../../../packages/core/src/api/schemas/content.js";
import { MenuRepository } from "../../../../packages/core/src/database/repositories/menu.js";
import baseline from "../../../../scripts/config/superboard-plugin-independence-baseline.json";
import { setupTestDatabase, teardownTestDatabase } from "../../packages/core/utils/test-db.js";

let db: Awaited<ReturnType<typeof setupTestDatabase>>;
const declaredViews = nativeFrontPluginCatalog()
	.filter((plugin) => plugin.plugin_id !== "supbrd-core")
	.flatMap((plugin) =>
		plugin.surfaces.map((surface) => ({ ...surface, plugin_id: plugin.plugin_id })),
	);

test("plugin routes have one canonical namespace and no duplicate destination", async () => {
	db = await setupTestDatabase();
	const prefixes: Record<string, string> = {
		"supbrd-plug-user": "/auth",
		"supbrd-plug-content": "/data",
		"supbrd-plugmod-files": "/data",
		"supbrd-plug-products": "/monetization",
		"supbrd-plugmod-billing": "/monetization",
		"supbrd-plugmod-marketing": "/communication",
		"supbrd-plugmod-email": "/communication",
		"supbrd-plugmod-flows": "/acquisition",
		"supbrd-plugmod-paywalls": "/acquisition",
		"supbrd-plugmod-onboardings": "/acquisition",
		"supbrd-plugmod-dynamic-links": "/acquisition",
		"supbrd-plugmod-support": "/support",
		"supbrd-plugmod-analytics": "/analytics",
	};
	const destinations = new Set<string>();
	for (const view of declaredViews) {
		const prefix = prefixes[view.plugin_id] ?? "/core";
		expect(view.path_pattern === prefix || view.path_pattern.startsWith(`${prefix}/`)).toBe(true);
		expect(destinations.has(view.path_pattern)).toBe(false);
		destinations.add(view.path_pattern);
	}
});

test("upgrading renamed views keeps canonical records and does not recreate trashed aliases", async () => {
	db = await setupTestDatabase();
	await applySeed(db, seedJson as unknown as SeedFile, { includeContent: true });
	const view = seedJson.content.views.find((entry) => entry.data.path === "/auth/referrals");
	if (!view) throw new Error("Referrals fixture missing");
	await applySeed(
		db,
		{
			version: "1",
			defaultLocale: "en",
			content: {
				views: [
					{
						...view,
						id: "old-referrals",
						slug: "old-referrals",
						data: { ...view.data, path: "/app/referrals" },
					},
				],
			},
		},
		{ includeContent: true },
	);
	await ensureSuperBoardViews(db);
	const rows = await db
		.selectFrom(db.dynamic.ref("ec_views"))
		.select(["path", "deleted_at"])
		.where("locale", "=", "en")
		.where("route_id", "=", view.data.route_id)
		.execute();
	expect(rows.filter((row) => row.deleted_at === null)).toEqual([
		{ path: "/auth/referrals", deleted_at: null },
	]);
	expect(rows.find((row) => row.path === "/app/referrals")?.deleted_at).toBeTruthy();
	await ensureSuperBoardViews(db);
	expect(
		await db
			.selectFrom(db.dynamic.ref("ec_views"))
			.select(["path", "deleted_at"])
			.where("locale", "=", "en")
			.where("route_id", "=", view.data.route_id)
			.execute(),
	).toEqual(rows);
});

function declaredDestination(url: string) {
	const segments = new URL(canonicalFrontHref(url), "https://site.test").pathname.split("/");
	return [...declaredViews, ...CORE_OPERATOR_SURFACES].find((view) => {
		const pattern = view.path_pattern.split("/");
		return (
			pattern.length === segments.length &&
			pattern.every((segment, index) => segment.startsWith(":") || segment === segments[index])
		);
	});
}

test("a views upgrade preserves an operator's existing Flows view and navigation", async () => {
	db = await setupTestDatabase();
	await applySeed(
		db,
		{
			...seedJson,
			content: {
				views: seedJson.content.views.filter((view) => view.data.path !== "/acquisition/users"),
			},
		} as unknown as SeedFile,
		{
			includeContent: true,
			onConflict: "skip",
		},
	);
	const flow = seedJson.content.views.find(
		(view) => view.data.plugin_id === "supbrd-plugmod-flows",
	);
	if (!flow) throw new Error("Flows fixture not found");
	await applySeed(
		db,
		{
			version: "1",
			defaultLocale: "en",
			content: {
				views: [
					{
						id: "custom-flow-participants",
						slug: "custom-flow-participants",
						status: "published",
						data: {
							...flow.data,
							route_id: "superboard.flows_users",
							path: "/flows/users",
							name: "My participant workspace",
						},
					},
				],
			},
		},
		{ includeContent: true },
	);
	const repository = new MenuRepository(db);
	const menu = (await repository.findByName("superboard-admin", { locale: "en" }))[0];
	if (!menu) throw new Error("Menu not initialized");
	await repository.setItems(menu.id, "en", [
		{ type: "custom", label: "My participants", customUrl: "/flows/users" },
	]);
	const before = await repository.findItems(menu.id);
	await ensureSuperBoardViews(db);
	expect(
		await db
			.selectFrom(db.dynamic.ref("ec_views"))
			.select("name")
			.where("path", "=", "/acquisition/users")
			.where("locale", "=", "en")
			.execute(),
	).toEqual([{ name: "My participant workspace" }]);
	expect(await repository.findItems(menu.id)).toEqual(
		before.map((item) => ({ ...item, customUrl: "/acquisition/users" })),
	);
});

test("existing product menus use canonical destinations while historical links remain routable", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: legacyProductMenus });
	const repo = new MenuRepository(db);
	const menus = await repo.findByName("superboard-admin");
	for (const menu of menus) {
		const before = await repo.findItems(menu.id);
		await ensureNativeFrontMenus(db, seedJson.menus);
		const after = await repo.findItems(menu.id);
		const section = (url: string) => {
			let item = after.find((entry) => entry.customUrl === url);
			while (item?.parentId) item = after.find((entry) => entry.id === item?.parentId);
			return item?.label;
		};
		expect(section("/acquisition/paywalls")).toBe("Acquisition");
		expect(section("/acquisition/dynamic-links")).toBe("Acquisition");
		const acquisition = after.find((item) => item.label === "Acquisition" && !item.parentId)!;
		expect(
			after.filter((item) => item.parentId === acquisition.id).map((item) => item.customUrl),
		).toEqual([
			"/acquisition/paywalls",
			"/acquisition/onboardings",
			"/acquisition/dynamic-links",
			"/acquisition/settings",
		]);
		expect(section("/monetization/products")).toBe(
			menu.locale === "fr" ? "Monétisation" : "Monetization",
		);
		expect(section("/support/inbox")).toBe("Support");
		expect(section("/communication/campaigns")).toBe("Communication");
		expect(section("/auth/referrals")).toBe("Authentification");
		expect(section("/analytics/remote-config")).toBe("Analytics");
		for (const item of before.filter((entry) => !entry.customUrl?.endsWith("/account"))) {
			const destination = retiredFrontPageDestination(item.customUrl ?? "") ?? item.customUrl;
			expect(
				after.some((entry) => entry.customUrl === destination) ||
					Boolean(destination && declaredDestination(destination)),
				`Historical destination ${destination} remains routable`,
			).toBe(true);
		}
		await ensureNativeFrontMenus(db, seedJson.menus);
		expect(await repo.findItems(menu.id)).toEqual(after);
	}
});

test("authentication navigation groups users and access, exposes settings and preserves custom menus", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: legacyAuthenticationMenus });
	await ensureNativeFrontMenus(db, seedJson.menus);
	const repo = new MenuRepository(db);
	for (const menu of await repo.findByName("superboard-admin")) {
		const items = await repo.findItems(menu.id);
		const auth = items.find((item) => item.label === "Authentification");
		expect(auth).toBeDefined();
		const entries = items.filter((item) => item.parentId === auth?.id);
		expect(entries.map((item) => item.customUrl)).toEqual([
			"/auth/users",
			`/auth/apps?lang=${menu.locale}`,
			`/auth/settings?lang=${menu.locale}`,
			`/auth/logs?lang=${menu.locale}`,
		]);
		const users = entries[0];
		expect(items.find((item) => item.customUrl === "/auth/customers")?.parentId).toBe(users?.id);
		expect(items.some((item) => item.customUrl === `/identity/${menu.locale}/account`)).toBe(false);
		expect(retiredFrontPageDestination(`/identity/${menu.locale}/dashboard`)).toBe(
			`/identity/${menu.locale}/settings`,
		);
	}
});

test("a customized link to the old authentication overview keeps its identity and label", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: legacyAuthenticationMenus });
	const repo = new MenuRepository(db);
	const menu = (await repo.findByName("superboard-admin", { locale: "en" }))[0];
	if (!menu) throw new Error("Menu is missing");
	await repo.setItems(menu.id, "en", [
		{ type: "custom", label: "My sign-in settings", customUrl: "/identity/en/dashboard" },
	]);
	const before = (await repo.findItems(menu.id))[0];
	await ensureNativeFrontMenus(db, seedJson.menus);
	const after = await repo.findItems(menu.id);
	expect(after).toHaveLength(1);
	expect(after[0]).toMatchObject({
		id: before?.id,
		label: "My sign-in settings",
		customUrl: "/auth/settings?lang=en",
	});
});

test("retiring duplicate analytics pages upgrades saved menus without replacing custom links", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: seedJson.menus });
	const repo = new MenuRepository(db);
	const menus = await repo.findByName("superboard-admin");
	const retainedIds = new Set<string>();
	for (const menu of menus) {
		await repo.setItems(menu.id, menu.locale, [
			{ type: "custom", label: `My statistics ${menu.locale}`, customUrl: "/dashboard" },
			{ type: "custom", label: "Duplicate overview", customUrl: "/dashboard", parentIndex: 0 },
			{
				type: "custom",
				label: "Saved dashboards",
				customUrl: "/analytics/dashboards",
				parentIndex: 0,
			},
			{ type: "custom", label: "My reports", customUrl: "/analytics/reports", parentIndex: 0 },
		]);
		for (const item of await repo.findItems(menu.id))
			if (item.label === "My reports") retainedIds.add(item.id);
	}
	await db
		.insertInto("options")
		.values({ name: "superboard_views_bootstrap", value: JSON.stringify("5.0.0") })
		.execute();
	await ensureSuperBoardViews(db);
	for (const menu of menus) {
		const items = await repo.findItems(menu.id);
		expect(items.map((item) => item.customUrl)).toEqual(["/analytics", "/analytics/reports"]);
		expect(items[0]?.label).toBe(`My statistics ${menu.locale}`);
		expect(retainedIds.has(items[1]?.id ?? "")).toBe(true);
		await ensureNativeFrontMenus(db, seedJson.menus);
		expect(await repo.findItems(menu.id)).toEqual(items);
	}
});

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
	expect(viewCount?.count).toBe(declaredViews.length);
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
	expect(after).toBe(declaredViews.length);
});

test("the Views bootstrap preserves editorial edits without copying plugin connections into storage", async () => {
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

	expect(entries).toHaveLength(declaredViews.length);
	for (const entry of entries) {
		const declared = declaredViews.find((view) => view.route_id === entry.route_id);
		expect(declared, `Declared renderer for ${String(entry.route_id)}`).toBeDefined();
		expect(entry.renderer_id).toBe(declared?.renderer_id);
	}
	const unedited = entries.filter((entry) => entry.path !== "/analytics/views");
	expect(unedited.flatMap((entry) => JSON.parse(String(entry.bindings)).data_sources)).toEqual([]);
	expect(edited?.name).toBe("Edited Analytics Views");
	expect(JSON.parse(String(edited?.bindings)).data_sources).toEqual([
		"supbrd-plugmod-analytics.data_source.operator_custom",
	]);
	expect(marker?.value).toEqual(expect.any(String));
	expect(marker?.value).not.toBe(JSON.stringify("1.0.0"));
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
	expect(await countViews()).toBe(declaredViews.length);
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
			const path = canonicalFrontPath(route.path);
			const matching = views.filter(
				(view) => view.plugin_id === plugin.plugin_id && view.path === path,
			);
			expect(matching).toHaveLength(1);
			const declared = declaredViews.find(
				(view) => view.plugin_id === plugin.plugin_id && view.path_pattern === path,
			);
			expect(matching[0]?.route_id).toBe(declared?.route_id);
		}
	}
	const paywall = views.find((view) => view.path === "/acquisition/paywalls");
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
	for (const menu of menus) {
		const destinations = (await repo.findItems(menu.id)).map((item) => item.customUrl);
		expect(destinations).not.toContain("/dashboard");
		expect(destinations).not.toContain("/analytics/dashboards");
		expect(destinations).not.toContain("/app/members");
		expect(destinations).toContain("/analytics");
	}
	const french = menus.find((menu) => menu.locale === "fr")!;
	expect(french.label).toBe("Navigation du front");
	const items = await repo.findItems(french.id);
	expect(items.some((item) => item.label === "Authentification")).toBe(true);
	expect(items.some((item) => item.customUrl === "/support/configuration")).toBe(false);
	expect(items.some((item) => item.customUrl === "/support/settings")).toBe(true);
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

test("retiring members upgrades installed menus while preserving user links and custom children", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: seedJson.menus });
	const repo = new MenuRepository(db);
	const menus = await repo.findByName("superboard-admin");
	for (const menu of menus) {
		await repo.setItems(menu.id, menu.locale, [
			{ type: "custom", label: "My users", customUrl: "/app/users" },
			{ type: "custom", label: "Duplicate members", customUrl: "/app/members" },
			{ type: "custom", label: "My group", customUrl: "/app/members/" },
			{ type: "custom", label: "My customers", customUrl: "/app/customers", parentIndex: 2 },
		]);
	}
	await db
		.insertInto("options")
		.values({ name: "superboard_views_bootstrap", value: JSON.stringify("6.0.0") })
		.execute();
	await ensureSuperBoardViews(db);
	for (const menu of menus) {
		const items = await repo.findItems(menu.id);
		expect(items.map(({ customUrl }) => customUrl)).toEqual([
			"/auth/users",
			"/auth/users",
			"/auth/customers",
		]);
		expect(items.map(({ label }) => label)).toEqual(["My users", "My group", "My customers"]);
		expect(items[2]?.parentId).toBe(items[1]?.id);
		await ensureNativeFrontMenus(db, seedJson.menus);
		expect(await repo.findItems(menu.id)).toEqual(items);
	}
});

test("Communication settings is a direct sidebar destination after upgrading a nested menu", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: seedJson.menus });
	const repo = new MenuRepository(db);
	for (const menu of await repo.findByName("superboard-admin")) {
		await repo.setItems(menu.id, menu.locale, [
			{ type: "custom", label: "Communication", customUrl: "/communication/campaigns" },
			{ type: "custom", label: "Channels", customUrl: "/communication/channels", parentIndex: 0 },
			{
				type: "custom",
				label: menu.locale === "fr" ? "Paramètres marketing" : "Marketing settings",
				customUrl: "/communication/settings",
				parentIndex: 1,
			},
			{ type: "custom", label: "Custom link", customUrl: "/analytics" },
		]);
		const before = await repo.findItems(menu.id);
		await ensureNativeFrontMenus(db, seedJson.menus);
		const after = await repo.findItems(menu.id);
		const root = after.find((item) => item.customUrl === "/communication/campaigns")!;
		const settings = after.filter((item) => item.customUrl === "/communication/settings");
		expect(settings).toHaveLength(1);
		expect(settings[0]).toMatchObject({
			id: before.find((item) => item.customUrl === "/communication/settings")!.id,
			parentId: root.id,
			label: menu.locale === "fr" ? "Paramètres" : "Settings",
		});
		expect(after.find((item) => item.label === "Custom link")).toEqual(
			before.find((item) => item.label === "Custom link"),
		);
		await ensureNativeFrontMenus(db, seedJson.menus);
		expect(await repo.findItems(menu.id)).toEqual(after);
	}
});

test("Acquisition settings upgrades its menu entry without losing custom links", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: seedJson.menus });
	const repo = new MenuRepository(db);
	for (const menu of await repo.findByName("superboard-admin")) {
		await repo.setItems(menu.id, menu.locale, [
			{ type: "custom", label: "Acquisition", customUrl: "/acquisition/paywalls" },
			{
				type: "custom",
				label: menu.locale === "fr" ? "Paramètres des parcours" : "Journey settings",
				customUrl: "/acquisition/settings/environments",
				parentIndex: 0,
			},
			{ type: "custom", label: "Custom", customUrl: "/analytics", parentIndex: 1 },
			{
				type: "custom",
				label: "My paywall",
				customUrl: "/acquisition/paywalls?item=custom",
				parentIndex: 0,
			},
		]);
		await ensureNativeFrontMenus(db, seedJson.menus);
		const items = await repo.findItems(menu.id);
		expect(items.find((item) => item.customUrl === "/acquisition/settings")).toMatchObject({
			label: menu.locale === "fr" ? "Paramètres" : "Settings",
		});
		expect(items.find((item) => item.label === "Custom")?.customUrl).toBe("/analytics");
		expect(items.find((item) => item.label === "My paywall")?.customUrl).toBe(
			"/acquisition/paywalls?item=custom",
		);
		await ensureNativeFrontMenus(db, seedJson.menus);
		expect(await repo.findItems(menu.id)).toEqual(items);
	}
});

test("Analytics settings is a direct sidebar destination after upgrading a nested menu", async () => {
	db = await setupTestDatabase();
	await applySeed(db, { version: "1", menus: seedJson.menus });
	const repo = new MenuRepository(db);
	for (const menu of await repo.findByName("superboard-admin")) {
		await repo.setItems(menu.id, menu.locale, [
			{ type: "custom", label: "Analytics", customUrl: "/analytics" },
			{ type: "custom", label: "Channels", customUrl: "/analytics/reports", parentIndex: 0 },
			{
				type: "custom",
				label: menu.locale === "fr" ? "Paramètres des statistiques" : "Statistics settings",
				customUrl: "/analytics/settings",
				parentIndex: 1,
			},
			{ type: "custom", label: "Custom link", customUrl: "/support/inbox" },
		]);
		const before = await repo.findItems(menu.id);
		await ensureNativeFrontMenus(db, seedJson.menus);
		const after = await repo.findItems(menu.id);
		const root = after.find((item) => item.customUrl === "/analytics")!;
		const settings = after.filter((item) => item.customUrl === "/analytics/settings");
		expect(settings).toHaveLength(1);
		expect(settings[0]).toMatchObject({
			id: before.find((item) => item.customUrl === "/analytics/settings")!.id,
			parentId: root.id,
			label: menu.locale === "fr" ? "Paramètres" : "Settings",
		});
		expect(after.find((item) => item.label === "Custom link")).toEqual(
			before.find((item) => item.label === "Custom link"),
		);
		await ensureNativeFrontMenus(db, seedJson.menus);
		expect(await repo.findItems(menu.id)).toEqual(after);
	}
});

test("Support navigation groups its operational destinations under one section", async () => {
	db = await setupTestDatabase();
	await ensureSuperBoardViews(db);
	const repository = new MenuRepository(db);
	for (const menu of await repository.findByName("superboard-admin")) {
		const items = await repository.findItems(menu.id);
		const support = items.find(
			(item) => item.customUrl === "/support/inbox" && item.parentId === null,
		);
		expect(support).toBeDefined();
		expect(
			items
				.filter((item) => item.parentId === support!.id)
				.map((item) => item.customUrl)
				.toSorted(),
		).toEqual([
			"/support/automations",
			"/support/captain",
			"/support/channels",
			"/support/contacts",
			"/support/help-center",
			"/support/inbox",
			"/support/integrations",
			"/support/proactive-support",
			"/support/quality",
			"/support/reports",
			"/support/settings",
			"/support/workforce",
		]);
		await ensureNativeFrontMenus(db, seedJson.menus);
		expect(
			(await repository.findItems(menu.id)).filter((item) => item.parentId === support!.id),
		).toEqual(items.filter((item) => item.parentId === support!.id));
	}
});
