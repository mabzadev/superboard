import { canonicalFrontPath } from "@superboard/contracts/front-paths";
import { applySeed, SchemaRegistry, validateSeed, type SeedFile } from "emdash";

import seedJson from "../../seed/seed.json";
import { ensureNativeFrontMenus } from "./native-front-menu-bootstrap.js";
import { nativeFrontPluginCatalog } from "./native-front-plugins.js";

const VIEWS_BOOTSTRAP_KEY = Symbol.for("superboard:views-bootstrap");
const VIEWS_BOOTSTRAP_VERSION = "10.2.2";
const seed = readSeedFile(seedJson);

interface ViewsBootstrapState {
	version: string;
	promises: WeakMap<object, Promise<void>>;
}

interface ViewBootstrapRow {
	id: string;
	plugin_id: string;
	deleted_at: string | null;
	locale: string;
	route_id: string;
	path: string;
	renderer_id: string | null;
	bindings: unknown;
	presentation: unknown;
}

export function ensureSuperBoardViews(db: Parameters<typeof applySeed>[0]): Promise<void> {
	const root = globalThis as typeof globalThis & { [VIEWS_BOOTSTRAP_KEY]?: ViewsBootstrapState };
	const previous = root[VIEWS_BOOTSTRAP_KEY];
	const state: ViewsBootstrapState =
		previous?.version === VIEWS_BOOTSTRAP_VERSION
			? previous
			: {
					version: VIEWS_BOOTSTRAP_VERSION,
					promises: new WeakMap<object, Promise<void>>(),
				};
	root[VIEWS_BOOTSTRAP_KEY] = state;
	let promise = state.promises.get(db);
	if (!promise) {
		promise = bootstrapSuperBoardViews(db).catch((error: unknown) => {
			state.promises.delete(db);
			throw error;
		});
		state.promises.set(db, promise);
	}
	return promise;
}

async function bootstrapSuperBoardViews(db: Parameters<typeof applySeed>[0]): Promise<void> {
	const marker = await db
		.selectFrom("options")
		.select("value")
		.where("name", "=", "superboard_views_bootstrap")
		.executeTakeFirst();
	if (marker?.value === JSON.stringify(VIEWS_BOOTSTRAP_VERSION)) return;

	const registry = new SchemaRegistry(db);
	const viewCollection = seed.collections?.filter(({ slug }) => slug === "views") ?? [];
	const viewContent = seed.content?.views ?? [];
	if (viewCollection.length !== 1 || viewContent.length === 0) {
		throw new Error("SUPERBOARD_VIEWS_SEED_INVALID");
	}
	const existingPaths = new Set<string>();
	if (await registry.getCollection("views")) {
		const locales = [
			...new Set(viewContent.map((view) => view.locale ?? seed.defaultLocale ?? "en")),
		];
		const existingViews = await db
			.$extendTables<{ ec_views: ViewBootstrapRow }>()
			.selectFrom("ec_views")
			.select(["path", "locale"])
			.where("locale", "in", locales)
			.execute();
		for (const view of existingViews)
			existingPaths.add(`${view.locale}:${canonicalFrontPath(view.path)}`);
	}
	const missingViews = viewContent.filter(
		(view) =>
			!existingPaths.has(
				`${view.locale ?? seed.defaultLocale ?? "en"}:${canonicalFrontPath(String(view.data.path))}`,
			),
	);
	await applySeed(
		db,
		{
			version: seed.version,
			defaultLocale: seed.defaultLocale,
			collections: viewCollection,
			content: { views: missingViews },
		},
		{ includeContent: true, onConflict: "skip" },
	);
	if (!(await registry.getField("views", "renderer_id"))) {
		await registry.createField("views", {
			slug: "renderer_id",
			label: "Renderer",
			type: "string",
			required: true,
			defaultValue: "",
		});
	}
	await registry.updateCollection("views", { admin: viewCollection[0]?.admin });
	await registry.updateField("views", "renderer_id", { sortOrder: 5 });
	await registry.updateField("views", "presentation", {
		label: "Additional content",
		sortOrder: 6,
	});
	await registry.updateField("views", "bindings", { sortOrder: 7 });
	await upgradeViewRenderers(db);
	await installPluginViews(db);

	await ensureNativeFrontMenus(db, seed.menus ?? []);

	for (const slug of ["pages", "posts"]) {
		const collection = await registry.getCollection(slug);
		if (collection && !collection.hidden) {
			await registry.updateCollection(slug, { hidden: true });
		}
	}

	await db
		.insertInto("options")
		.values({ name: "superboard_views_bootstrap", value: JSON.stringify(VIEWS_BOOTSTRAP_VERSION) })
		.onConflict((conflict) =>
			conflict.column("name").doUpdateSet({ value: JSON.stringify(VIEWS_BOOTSTRAP_VERSION) }),
		)
		.execute();
}

async function installPluginViews(db: Parameters<typeof applySeed>[0]): Promise<void> {
	const viewsDb = db.$extendTables<{ ec_views: ViewBootstrapRow }>();
	const existing = await viewsDb
		.selectFrom("ec_views")
		.select(["id", "route_id", "path", "locale", "plugin_id", "deleted_at"])
		.execute();
	const surfaces = new Map(
		nativeFrontPluginCatalog().flatMap((plugin) =>
			plugin.surfaces.map(
				(surface) => [`${plugin.plugin_id}:${surface.path_pattern}`, surface] as const,
			),
		),
	);
	const canonicalRows = new Map(
		existing
			.filter((row) => !row.deleted_at && row.path === canonicalFrontPath(row.path))
			.map((row) => [`${row.locale}:${row.plugin_id}:${row.path}`, row]),
	);
	for (const row of existing.filter((entry) => !entry.deleted_at)) {
		const path = canonicalFrontPath(row.path);
		const surface = surfaces.get(`${row.plugin_id}:${path}`);
		if (!surface) continue;
		const key = `${row.locale}:${row.plugin_id}:${path}`;
		const current = canonicalRows.get(key);
		if (current && current.id !== row.id) {
			await viewsDb
				.updateTable("ec_views")
				.set({ deleted_at: new Date().toISOString() })
				.where("id", "=", row.id)
				.where("locale", "=", row.locale)
				.execute();
			continue;
		}
		canonicalRows.set(key, row);
		if (row.path !== path || row.route_id !== surface.route_id) {
			await viewsDb
				.updateTable("ec_views")
				.set({ path, route_id: surface.route_id })
				.where("id", "=", row.id)
				.where("locale", "=", row.locale)
				.execute();
			row.path = path;
			row.route_id = surface.route_id;
		}
	}
	const routes = new Set(existing.map((view) => String(view.route_id)));
	const paths = new Set(existing.map((view) => String(view.path)));
	const views = nativeFrontPluginCatalog().flatMap((plugin) => {
		if (plugin.plugin_id === "supbrd-core") return [];
		return plugin.surfaces
			.filter((surface) => !routes.has(surface.route_id) && !paths.has(surface.path_pattern))
			.map((surface) => ({
				id: `view:plugin:${surface.route_id}`,
				slug: `plugin-${surface.route_id.replaceAll(/[^a-z0-9]+/gu, "-")}`,
				status: "published" as const,
				data: {
					name: surface.title,
					plugin_id: plugin.plugin_id,
					route_id: surface.route_id,
					path: surface.path_pattern,
					description: "",
					renderer_id: surface.renderer_id,
					presentation: { schema_version: "1.0.0", blocks: [] },
					bindings: {
						data_sources: [],
						commands: [],
					},
				},
			}));
	});
	if (views.length)
		await applySeed(
			db,
			{ version: seed.version, defaultLocale: seed.defaultLocale, content: { views } },
			{ includeContent: true, onConflict: "skip" },
		);
}

async function upgradeViewRenderers(db: Parameters<typeof applySeed>[0]): Promise<void> {
	const viewsDb = db.$extendTables<{ ec_views: ViewBootstrapRow }>();
	const currentViews = await viewsDb
		.selectFrom("ec_views")
		.select(["path", "renderer_id", "presentation"])
		.execute();
	const byPath = new Map(currentViews.map((view) => [String(view.path), view]));

	for (const definition of seedJson.content.views) {
		const current = byPath.get(definition.data.path);
		if (!current) continue;
		const rendererId = String(current.renderer_id ?? "").trim();
		const updatePresentation =
			definition.data.path === "/analytics/remote-config" &&
			isLegacyRemoteConfigPresentation(current.presentation);
		if (rendererId && !updatePresentation) continue;

		await viewsDb
			.updateTable("ec_views")
			.set({
				...(rendererId ? {} : { renderer_id: definition.data.renderer_id }),
				...(updatePresentation
					? { presentation: JSON.stringify(definition.data.presentation) }
					: {}),
			})
			.where("path", "=", definition.data.path)
			.execute();
	}
}

function isLegacyRemoteConfigPresentation(value: unknown): boolean {
	const presentation = jsonRecord(value);
	const blocks = array(presentation?.blocks);
	const notice = jsonRecord(blocks[0]);
	const columns = jsonRecord(blocks[1]);
	const cards = array(columns?.columns);
	return (
		blocks.length === 2 &&
		notice?.title === "Stable assignments" &&
		jsonRecord(cards[0])?.title === "Publish parameter"
	);
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
	if (isViewRecord(value)) {
		return value;
	}
	if (typeof value !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return isViewRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function restrictSuperBoardViewFilters(url: URL, activePluginIds: readonly string[]): void {
	const encoded = url.searchParams.get("fieldFilters");
	let filters: Record<string, unknown> = {};
	if (encoded) {
		try {
			const parsed: unknown = JSON.parse(encoded);
			if (!isViewRecord(parsed)) return;
			filters = parsed;
		} catch {
			return;
		}
	}
	const requested = filters.plugin_id;
	const allowed = ["supbrd-core", ...activePluginIds].filter((id) => {
		if (requested === undefined) return true;
		if (typeof requested === "string") return requested === id;
		if (
			requested &&
			typeof requested === "object" &&
			"in" in requested &&
			Array.isArray(requested.in)
		)
			return requested.in.includes(id);
		return false;
	});
	filters.plugin_id = { in: allowed.length ? allowed : ["__no_active_plugin__"] };
	url.searchParams.set("fieldFilters", JSON.stringify(filters));
}

function isViewRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSeedFile(value: unknown): asserts value is SeedFile {
	const validation = validateSeed(value);
	if (!validation.valid)
		throw new Error(`SUPERBOARD_VIEWS_SEED_INVALID:${validation.errors.join(",")}`);
}

function readSeedFile(value: unknown): SeedFile {
	assertSeedFile(value);
	return value;
}
