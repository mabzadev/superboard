import { applySeed, SchemaRegistry, validateSeed, type SeedFile } from "emdash";

import seedJson from "../../seed/seed.json";
import { nativeFrontPluginCatalog } from "./native-front-plugins.js";
import { superBoardRuntimePluginCatalog } from "./superboard-plugin-catalog.js";

const VIEWS_BOOTSTRAP_KEY = Symbol.for("superboard:views-bootstrap");
const VIEWS_BOOTSTRAP_VERSION = "3.1.0";
const seed = readSeedFile(seedJson);

interface ViewsBootstrapState {
	version: string;
	promises: WeakMap<object, Promise<void>>;
}

interface ViewBootstrapRow {
	id: string;
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
	await applySeed(
		db,
		{
			version: seed.version,
			defaultLocale: seed.defaultLocale,
			collections: viewCollection,
			content: { views: viewContent },
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
	await registry.updateField("views", "renderer_id", { sortOrder: 5 });
	await registry.updateField("views", "presentation", {
		label: "Additional content",
		sortOrder: 6,
	});
	await registry.updateField("views", "bindings", { sortOrder: 7 });
	await upgradeViewRenderers(db);
	await installPluginViews(db);

	const menu = await db
		.selectFrom("_emdash_menus")
		.select("id")
		.where("name", "=", "superboard-admin")
		.executeTakeFirst();
	if (!menu && seed.menus) {
		await applySeed(
			db,
			{
				version: seed.version,
				defaultLocale: seed.defaultLocale,
				menus: seed.menus,
			},
			{ onConflict: "skip" },
		);
	}

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
		.select(["id", "route_id", "path"])
		.execute();
	const surfaces = new Map(
		nativeFrontPluginCatalog().flatMap((plugin) =>
			plugin.surfaces.map((surface) => [surface.route_id, surface] as const),
		),
	);
	const legacyPaths = new Map(
		seedJson.content.views.map((view) => [view.data.route_id, view.data.path]),
	);
	for (const row of existing) {
		const surface = surfaces.get(String(row.route_id));
		if (
			surface &&
			row.path === legacyPaths.get(String(row.route_id)) &&
			row.path !== surface.path_pattern
		) {
			await viewsDb
				.updateTable("ec_views")
				.set({ path: surface.path_pattern })
				.where("id", "=", row.id)
				.execute();
			row.path = surface.path_pattern;
		}
	}
	const routes = new Set(existing.map((view) => String(view.route_id)));
	const paths = new Set(existing.map((view) => String(view.path)));
	const manifests = new Map(
		superBoardRuntimePluginCatalog().plugins.map(({ manifest }) => [manifest.plugin_id, manifest]),
	);
	const views = nativeFrontPluginCatalog().flatMap((plugin) => {
		if (plugin.plugin_id === "supbrd-core") return [];
		const manifest = manifests.get(plugin.plugin_id);
		if (!manifest) throw new Error(`PLUGIN_VIEW_MANIFEST_MISSING:${plugin.plugin_id}`);
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
						data_sources: manifest.data_sources.map((source) => source.data_source_id),
						commands: manifest.commands.map((command) => command.command_id),
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
		.select(["path", "renderer_id", "bindings", "presentation"])
		.execute();
	const byPath = new Map(currentViews.map((view) => [String(view.path), view]));

	for (const definition of seedJson.content.views) {
		const current = byPath.get(definition.data.path);
		if (!current) continue;
		const rendererId = String(current.renderer_id ?? "").trim();
		const bindings = jsonRecord(current.bindings);
		const updateBindings =
			!bindings ||
			(array(bindings.data_sources).length === 0 && array(bindings.commands).length === 0);
		const updatePresentation =
			definition.data.path === "/analytics/remote-config" &&
			isLegacyRemoteConfigPresentation(current.presentation);
		if (rendererId && !updateBindings && !updatePresentation) continue;

		await viewsDb
			.updateTable("ec_views")
			.set({
				...(rendererId ? {} : { renderer_id: definition.data.renderer_id }),
				...(updateBindings ? { bindings: JSON.stringify(definition.data.bindings) } : {}),
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
