import { applySeed, SchemaRegistry, type SeedFile } from "emdash";

import seedJson from "../../seed/seed.json";

const VIEWS_BOOTSTRAP_KEY = Symbol.for("superboard:views-bootstrap");
const VIEWS_BOOTSTRAP_VERSION = "2.1.0";
const seed = seedJson as unknown as SeedFile;

interface ViewsBootstrapState {
	version: string;
	promises: WeakMap<object, Promise<void>>;
}

interface ViewBootstrapRow {
	path: string;
	renderer_id: string | null;
	bindings: unknown;
	presentation: unknown;
}

interface ViewBootstrapDatabase {
	selectFrom(table: "ec_views"): {
		select(columns: readonly (keyof ViewBootstrapRow)[]): {
			execute(): Promise<ViewBootstrapRow[]>;
		};
	};
	updateTable(table: "ec_views"): {
		set(values: Record<string, string>): {
			where(
				column: "path",
				operator: "=",
				value: string,
			): {
				execute(): Promise<unknown>;
			};
		};
	};
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

async function upgradeViewRenderers(db: Parameters<typeof applySeed>[0]): Promise<void> {
	const viewsDb = db as unknown as ViewBootstrapDatabase;
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
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
