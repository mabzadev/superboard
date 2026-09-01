import { applySeed, SchemaRegistry, type SeedFile } from "emdash";

import seedJson from "../../seed/seed.json";

const VIEWS_BOOTSTRAP_KEY = Symbol.for("superboard:views-bootstrap");
const VIEWS_BOOTSTRAP_VERSION = "1.0.0";
const seed = seedJson as unknown as SeedFile;

interface ViewsBootstrapState {
	promises: WeakMap<object, Promise<void>>;
}

export function ensureSuperBoardViews(db: Parameters<typeof applySeed>[0]): Promise<void> {
	const root = globalThis as typeof globalThis & { [VIEWS_BOOTSTRAP_KEY]?: ViewsBootstrapState };
	const state = (root[VIEWS_BOOTSTRAP_KEY] ??= { promises: new WeakMap() });
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
