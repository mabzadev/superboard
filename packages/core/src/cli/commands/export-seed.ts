import { resolve } from "node:path";

import { defineCommand } from "citty";
import consola from "consola";
import type { Kysely } from "kysely";
import { sql } from "kysely";

import { createDatabase } from "../../database/connection.js";
import { runMigrations } from "../../database/migrations/runner.js";
import { BylineRepository } from "../../database/repositories/byline.js";
import { ContentRepository } from "../../database/repositories/content.js";
import { MediaRepository } from "../../database/repositories/media.js";
import { OptionsRepository } from "../../database/repositories/options.js";
import { TaxonomyRepository } from "../../database/repositories/taxonomy.js";
import type { Database } from "../../database/types.js";
import { validateIdentifier } from "../../database/validate.js";
import { getI18nConfig, isI18nEnabled } from "../../i18n/config.js";
import { SchemaRegistry } from "../../schema/registry.js";
import type { FieldType } from "../../schema/types.js";
import type {
	SeedFile,
	SeedCollection,
	SeedField,
	SeedTaxonomy,
	SeedTaxonomyTerm,
	SeedMenu,
	SeedMenuItem,
	SeedWidgetArea,
	SeedWidget,
	SeedContentEntry,
	SeedByline,
	SeedBylineCredit,
} from "../../seed/types.js";
import { isMissingTableError } from "../../utils/db-errors.js";
import { slugify } from "../../utils/slugify.js";

const SETTINGS_PREFIX = "site:";

export const exportSeedCommand = defineCommand({
	meta: {
		name: "export-seed",
		description: "Export database schema and content as a seed file",
	},
	args: {
		database: {
			type: "string",
			alias: "d",
			description: "Database path",
			default: "./data.db",
		},
		cwd: {
			type: "string",
			description: "Working directory",
			default: process.cwd(),
		},
		"with-content": {
			type: "string",
			description: "Include content (all or comma-separated collection names)",
			required: false,
		},
		pretty: {
			type: "boolean",
			description: "Pretty print JSON output",
			default: true,
		},
	},
	async run({ args }) {
		const cwd = resolve(args.cwd);

		const dbPath = resolve(cwd, args.database);
		consola.info(`Database: ${dbPath}`);

		const db = createDatabase({ url: `file:${dbPath}` });

		try {
			await runMigrations(db);
		} catch (error) {
			consola.error("Migration failed:", error);
			await db.destroy();
			process.exit(1);
		}

		try {
			const seed = await exportSeed(db, args["with-content"]);

			const output = args.pretty ? JSON.stringify(seed, null, "\t") : JSON.stringify(seed);

			console.log(output);
		} catch (error) {
			consola.error("Export failed:", error);
			await db.destroy();
			process.exit(1);
		}

		await db.destroy();
	},
});

export async function exportSeed(db: Kysely<Database>, withContent?: string): Promise<SeedFile> {
	const seed: SeedFile = {
		$schema: "https://emdashcms.com/seed.schema.json",
		version: "1",
		meta: {
			name: "Exported Seed",
			description: "Exported from existing EmDash database",
		},
	};

	seed.settings = await exportSettings(db);

	seed.collections = await exportCollections(db);

	const { i18nEnabled, defaultLocale } = await detectLocaleInfo(db, seed.collections);

	if (defaultLocale) seed.defaultLocale = defaultLocale;

	seed.taxonomies = await exportTaxonomies(db, i18nEnabled);

	seed.menus = await exportMenus(db, i18nEnabled);

	seed.widgetAreas = await exportWidgetAreas(db);

	const { bylines, groupToSeedId } = await exportBylines(db);
	if (bylines.length > 0) {
		seed.bylines = bylines;
	}

	if (withContent !== undefined) {
		const includeAll = withContent === "" || withContent === "true" || withContent === "all";
		const collections = includeAll
			? null
			: withContent
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);

		seed.content = await exportContent(
			db,
			seed.collections || [],
			collections,
			groupToSeedId,
			i18nEnabled,
		);
	}

	return seed;
}

async function exportBylines(
	db: Kysely<Database>,
): Promise<{ bylines: SeedByline[]; groupToSeedId: Map<string, string> }> {
	const bylineRepo = new BylineRepository(db);
	const bylines: SeedByline[] = [];
	const groupToSeedId = new Map<string, string>();
	const usedSeedIds = new Set<string>();

	let cursor: string | undefined;
	do {
		const result = await bylineRepo.findMany({ limit: 100, cursor });
		for (const byline of result.items) {
			const group = byline.translationGroup ?? byline.id;
			if (groupToSeedId.has(group)) continue;

			let seedId = `byline:${byline.slug}`;
			if (usedSeedIds.has(seedId)) seedId = `byline:${byline.slug}:${group}`;
			usedSeedIds.add(seedId);
			groupToSeedId.set(group, seedId);

			bylines.push({
				id: seedId,
				slug: byline.slug,
				displayName: byline.displayName,
				bio: byline.bio || undefined,
				websiteUrl: byline.websiteUrl || undefined,
				isGuest: byline.isGuest || undefined,
			});
		}
		cursor = result.nextCursor;
	} while (cursor);

	return { bylines, groupToSeedId };
}

async function detectLocaleInfo(
	db: Kysely<Database>,
	collections: SeedCollection[],
): Promise<{ i18nEnabled: boolean; defaultLocale: string | undefined }> {
	const config = getI18nConfig();
	if (isI18nEnabled() && config) {
		return { i18nEnabled: true, defaultLocale: config.defaultLocale };
	}

	const locales = new Set<string>();
	const collectDistinctLocales = async (tableRef: ReturnType<typeof sql.ref>): Promise<void> => {
		const result = await sql<{ locale: string | null }>`
			SELECT DISTINCT locale FROM ${tableRef}
		`.execute(db);
		for (const row of result.rows) {
			if (row.locale) locales.add(row.locale);
		}
	};

	await collectDistinctLocales(sql.ref("_emdash_taxonomy_defs"));
	await collectDistinctLocales(sql.ref("_emdash_menus"));

	for (const collection of collections) {
		validateIdentifier(collection.slug, "collection slug");
		try {
			await collectDistinctLocales(sql.ref(`ec_${collection.slug}`));
		} catch (error) {
			if (!isMissingTableError(error)) throw error;
		}
	}

	return {
		i18nEnabled: locales.size > 1,
		defaultLocale: locales.size === 1 ? [...locales][0] : undefined,
	};
}

async function exportSettings(db: Kysely<Database>): Promise<SeedFile["settings"]> {
	const options = new OptionsRepository(db);
	const allOptions = await options.getByPrefix(SETTINGS_PREFIX);

	const settings: Record<string, unknown> = {};
	for (const [key, value] of allOptions) {
		const settingKey = key.replace(SETTINGS_PREFIX, "");
		settings[settingKey] = value;
	}

	return Object.keys(settings).length > 0 ? settings : undefined;
}

async function exportCollections(db: Kysely<Database>): Promise<SeedCollection[]> {
	const registry = new SchemaRegistry(db);
	const collections = await registry.listCollections();
	const result: SeedCollection[] = [];

	for (const collection of collections) {
		const fields = await registry.listFields(collection.id);

		const seedCollection: SeedCollection = {
			slug: collection.slug,
			label: collection.label,
			labelSingular: collection.labelSingular || undefined,
			description: collection.description || undefined,
			icon: collection.icon || undefined,
			admin: collection.admin,
			supports: collection.supports.length > 0 ? collection.supports : undefined,
			urlPattern: collection.urlPattern || undefined,
			routable: collection.routable === false ? false : undefined,
			hidden: collection.hidden || undefined,
			sortOrder: collection.sortOrder,
			fields: fields.map(
				(field): SeedField => ({
					slug: field.slug,
					label: field.label,
					type: field.type,
					required: field.required || undefined,
					unique: field.unique || undefined,
					searchable: field.searchable || undefined,
					indexed: field.indexed || undefined,
					defaultValue: field.defaultValue,
					validation: field.validation ? { ...field.validation } : undefined,
					widget: field.widget || undefined,
					options: field.options || undefined,
				}),
			),
		};

		result.push(seedCollection);
	}

	return result;
}

async function exportTaxonomies(
	db: Kysely<Database>,
	i18nEnabled: boolean,
): Promise<SeedTaxonomy[]> {
	const defs = await db
		.selectFrom("_emdash_taxonomy_defs")
		.selectAll()
		.orderBy(["name", "locale"])
		.execute();

	const result: SeedTaxonomy[] = [];
	const termRepo = new TaxonomyRepository(db);

	const defGroupToSeedId = new Map<string, string>();

	for (const def of defs) {
		const defSeedId =
			i18nEnabled && def.locale ? `tax:${def.name}:${def.locale}` : `tax:${def.name}`;

		const terms = await termRepo.findByName(def.name, { locale: def.locale });

		const groupToSlug = new Map<string, string>();
		for (const term of terms) groupToSlug.set(term.translationGroup ?? term.id, term.slug);

		const termGroupToSeedId = new Map<string, string>();

		const seedTerms: SeedTaxonomyTerm[] = [];
		for (const term of terms) {
			const termSeedId =
				i18nEnabled && term.locale
					? `term:${def.name}:${term.slug}:${term.locale}`
					: `term:${def.name}:${term.slug}`;

			const seedTerm: SeedTaxonomyTerm = {
				id: termSeedId,
				slug: term.slug,
				label: term.label,
				description: typeof term.data?.description === "string" ? term.data.description : undefined,
			};

			if (term.parentId) seedTerm.parent = groupToSlug.get(term.parentId);

			if (i18nEnabled && term.locale) {
				seedTerm.locale = term.locale;
				if (term.translationGroup) {
					const anchor = termGroupToSeedId.get(term.translationGroup);
					if (anchor) seedTerm.translationOf = anchor;
					else termGroupToSeedId.set(term.translationGroup, termSeedId);
				}
			}

			seedTerms.push(seedTerm);
		}

		seedTerms.sort((a, b) => Number(!!a.translationOf) - Number(!!b.translationOf));

		const taxonomy: SeedTaxonomy = {
			id: defSeedId,
			name: def.name,
			label: def.label,
			labelSingular: def.label_singular || undefined,
			hierarchical: def.hierarchical === 1,
			collections: def.collections ? JSON.parse(def.collections) : [],
		};

		if (i18nEnabled && def.locale) {
			taxonomy.locale = def.locale;
			if (def.translation_group) {
				const anchor = defGroupToSeedId.get(def.translation_group);
				if (anchor) taxonomy.translationOf = anchor;
				else defGroupToSeedId.set(def.translation_group, defSeedId);
			}
		}

		if (seedTerms.length > 0) taxonomy.terms = seedTerms;

		result.push(taxonomy);
	}

	result.sort((a, b) => Number(!!a.translationOf) - Number(!!b.translationOf));

	return result;
}

async function exportMenus(db: Kysely<Database>, i18nEnabled: boolean): Promise<SeedMenu[]> {
	const menus = await db
		.selectFrom("_emdash_menus")
		.selectAll()
		.orderBy(["name", "locale"])
		.execute();

	const result: SeedMenu[] = [];
	const groupToSeedId = new Map<string, string>();
	const itemGroupToSeedId = new Map<string, string>();
	const usedItemSeedIds = new Set<string>();

	for (const menu of menus) {
		const seedId =
			i18nEnabled && menu.locale ? `menu:${menu.name}:${menu.locale}` : `menu:${menu.name}`;

		const items = await db
			.selectFrom("_emdash_menu_items")
			.selectAll()
			.where("menu_id", "=", menu.id)
			.orderBy("sort_order", "asc")
			.execute();

		const seedItems = buildMenuItemTree(items, {
			i18nEnabled,
			menuName: menu.name,
			menuLocale: menu.locale ?? null,
			itemGroupToSeedId,
			usedItemSeedIds,
		});

		const seedMenu: SeedMenu = {
			id: seedId,
			name: menu.name,
			label: menu.label,
			items: seedItems,
		};

		if (i18nEnabled && menu.locale) {
			seedMenu.locale = menu.locale;
			if (menu.translation_group) {
				const anchor = groupToSeedId.get(menu.translation_group);
				if (anchor) seedMenu.translationOf = anchor;
				else groupToSeedId.set(menu.translation_group, seedId);
			}
		}

		result.push(seedMenu);
	}

	result.sort((a, b) => Number(!!a.translationOf) - Number(!!b.translationOf));

	return result;
}

function isWidgetType(t: string): t is SeedWidget["type"] {
	return t === "content" || t === "menu" || t === "component";
}

function buildMenuItemTree(
	items: Array<{
		id: string;
		parent_id: string | null;
		type: string;
		label: string;
		custom_url: string | null;
		reference_collection: string | null;
		reference_id: string | null;
		target: string | null;
		title_attr: string | null;
		css_classes: string | null;
		locale?: string | null;
		translation_group?: string | null;
	}>,
	i18nCtx: {
		i18nEnabled: boolean;
		menuName: string;
		menuLocale: string | null;
		itemGroupToSeedId: Map<string, string>;
		usedItemSeedIds: Set<string>;
	},
): SeedMenuItem[] {
	const childMap = new Map<string | null, typeof items>();

	for (const item of items) {
		const parentId = item.parent_id;
		if (!childMap.has(parentId)) {
			childMap.set(parentId, []);
		}
		childMap.get(parentId)!.push(item);
	}

	function makeSeedId(item: (typeof items)[number]): string {
		const base = slugify(item.label || "") || item.id;
		const locale = i18nCtx.i18nEnabled ? (item.locale ?? i18nCtx.menuLocale) : null;
		const candidate = locale
			? `item:${i18nCtx.menuName}:${base}:${locale}`
			: `item:${i18nCtx.menuName}:${base}`;
		if (!i18nCtx.usedItemSeedIds.has(candidate)) {
			i18nCtx.usedItemSeedIds.add(candidate);
			return candidate;
		}
		const fallback = locale
			? `item:${i18nCtx.menuName}:${base}:${item.id}:${locale}`
			: `item:${i18nCtx.menuName}:${base}:${item.id}`;
		i18nCtx.usedItemSeedIds.add(fallback);
		return fallback;
	}

	function buildLevel(parentId: string | null): SeedMenuItem[] {
		const children = childMap.get(parentId) || [];
		const result = children.map((item) => {
			const seedItem: SeedMenuItem = {
				type: item.type,
				label: item.label || undefined,
			};

			if (item.type === "custom") {
				seedItem.url = item.custom_url || undefined;
			} else {
				seedItem.ref = item.reference_id || undefined;
				seedItem.collection = item.reference_collection || undefined;
			}

			if (item.target === "_blank") {
				seedItem.target = "_blank";
			}
			if (item.title_attr) {
				seedItem.titleAttr = item.title_attr;
			}
			if (item.css_classes) {
				seedItem.cssClasses = item.css_classes;
			}

			if (i18nCtx.i18nEnabled) {
				const itemLocale = item.locale ?? i18nCtx.menuLocale;
				const seedId = makeSeedId(item);
				seedItem.id = seedId;
				if (itemLocale) seedItem.locale = itemLocale;
				if (item.translation_group) {
					const anchor = i18nCtx.itemGroupToSeedId.get(item.translation_group);
					if (anchor && anchor !== seedId) seedItem.translationOf = anchor;
					else if (!anchor) i18nCtx.itemGroupToSeedId.set(item.translation_group, seedId);
				}
			}

			const itemChildren = buildLevel(item.id);
			if (itemChildren.length > 0) {
				seedItem.children = itemChildren;
			}

			return seedItem;
		});

		return result;
	}

	return buildLevel(null);
}

async function exportWidgetAreas(db: Kysely<Database>): Promise<SeedWidgetArea[]> {
	const areas = await db.selectFrom("_emdash_widget_areas").selectAll().execute();

	const result: SeedWidgetArea[] = [];

	for (const area of areas) {
		const widgets = await db
			.selectFrom("_emdash_widgets")
			.selectAll()
			.where("area_id", "=", area.id)
			.orderBy("sort_order", "asc")
			.execute();

		const seedWidgets: SeedWidget[] = widgets
			.filter((w) => isWidgetType(w.type))
			.map((widget) => {
				const wType: SeedWidget["type"] = isWidgetType(widget.type) ? widget.type : "content";
				const seedWidget: SeedWidget = {
					type: wType,
				};

				if (widget.title) {
					seedWidget.title = widget.title;
				}

				if (widget.type === "content" && widget.content) {
					seedWidget.content = JSON.parse(widget.content);
				} else if (widget.type === "menu" && widget.menu_name) {
					seedWidget.menuName = widget.menu_name;
				} else if (widget.type === "component") {
					if (widget.component_id) {
						seedWidget.componentId = widget.component_id;
					}
					if (widget.component_props) {
						seedWidget.props = JSON.parse(widget.component_props);
					}
				}

				return seedWidget;
			});

		result.push({
			name: area.name,
			label: area.label,
			description: area.description || undefined,
			widgets: seedWidgets,
		});
	}

	return result;
}

async function exportContent(
	db: Kysely<Database>,
	collections: SeedCollection[],
	includeCollections: string[] | null,
	bylineGroupToSeedId: Map<string, string>,
	i18nEnabled: boolean,
): Promise<Record<string, SeedContentEntry[]>> {
	const content: Record<string, SeedContentEntry[]> = {};
	const contentRepo = new ContentRepository(db);
	const taxonomyRepo = new TaxonomyRepository(db);
	const mediaRepo = new MediaRepository(db);

	const mediaMap = new Map<
		string,
		{ url: string; filename: string; alt?: string; caption?: string }
	>();
	try {
		let cursor: string | undefined;
		do {
			const result = await mediaRepo.findMany({
				limit: 100,
				cursor,
				status: "all",
			});
			for (const media of result.items) {
				mediaMap.set(media.id, {
					url: `/_emdash/api/media/file/${media.storageKey}`,
					filename: media.filename,
					alt: media.alt || undefined,
					caption: media.caption || undefined,
				});
			}
			cursor = result.nextCursor;
		} while (cursor);
	} catch {}

	for (const collection of collections) {
		if (includeCollections && !includeCollections.includes(collection.slug)) {
			continue;
		}

		const entries: SeedContentEntry[] = [];
		let cursor: string | undefined;

		const translationGroupToSeedId = new Map<string, string>();

		do {
			const result = await contentRepo.findMany(collection.slug, {
				limit: 100,
				cursor,
			});

			for (const item of result.items) {
				const seedId = item.slug
					? i18nEnabled && item.locale
						? `${collection.slug}:${item.slug}:${item.locale}`
						: `${collection.slug}:${item.slug}`
					: item.id;

				const processedData = processDataForExport(item.data, collection.fields, mediaMap);

				const entry: SeedContentEntry = {
					id: seedId,
					slug: item.slug?.trim() ? item.slug : collection.routable === false ? undefined : item.id,
					status: item.status === "published" || item.status === "draft" ? item.status : undefined,
					data: processedData,
				};

				if (i18nEnabled && item.locale) {
					entry.locale = item.locale;

					if (item.translationGroup) {
						const sourceSeedId = translationGroupToSeedId.get(item.translationGroup);
						if (sourceSeedId) {
							entry.translationOf = sourceSeedId;
						} else {
							translationGroupToSeedId.set(item.translationGroup, seedId);
						}
					}
				}

				const taxonomies = await getTaxonomyAssignments(taxonomyRepo, collection.slug, item.id);
				if (Object.keys(taxonomies).length > 0) {
					entry.taxonomies = taxonomies;
				}

				const bylines = await getBylineCredits(db, collection.slug, item.id, bylineGroupToSeedId);
				if (bylines.length > 0) {
					entry.bylines = bylines;
				}

				entries.push(entry);
			}

			cursor = result.nextCursor;
		} while (cursor);

		if (i18nEnabled && entries.length > 0) {
			entries.sort((a, b) => {
				if (a.translationOf && !b.translationOf) return 1;
				if (!a.translationOf && b.translationOf) return -1;
				return 0;
			});
		}

		if (entries.length > 0) {
			content[collection.slug] = entries;
		}
	}

	return content;
}

function processDataForExport(
	data: Record<string, unknown>,
	fields: SeedField[],
	mediaMap: Map<string, { url: string; filename: string; alt?: string; caption?: string }>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	const fieldTypes = new Map<string, FieldType>();
	for (const field of fields) {
		fieldTypes.set(field.slug, field.type);
	}

	for (const [key, value] of Object.entries(data)) {
		const fieldType = fieldTypes.get(key);

		if (fieldType === "image" && value && typeof value === "object") {
			const imageValue = value as { id?: string; src?: string; alt?: string };
			if (imageValue.id) {
				const mediaInfo = mediaMap.get(imageValue.id);
				if (mediaInfo) {
					result[key] = {
						$media: {
							url: mediaInfo.url,
							filename: mediaInfo.filename,
							alt: imageValue.alt || mediaInfo.alt,
							caption: mediaInfo.caption,
						},
					};
					continue;
				}
			}
			result[key] = value;
		} else if (fieldType === "reference" && typeof value === "string") {
			result[key] = `$ref:${value}`;
		} else if (Array.isArray(value)) {
			result[key] = value.map((item) => {
				if (typeof item === "string" && fieldType === "reference") {
					return `$ref:${item}`;
				}
				return item;
			});
		} else {
			result[key] = value;
		}
	}

	return result;
}

async function getBylineCredits(
	db: Kysely<Database>,
	collection: string,
	entryId: string,
	groupToSeedId: Map<string, string>,
): Promise<SeedBylineCredit[]> {
	const rows = await db
		.selectFrom("_emdash_content_bylines")
		.select(["byline_id", "role_label"])
		.where("collection_slug", "=", collection)
		.where("content_id", "=", entryId)
		.orderBy("sort_order", "asc")
		.execute();

	const credits: SeedBylineCredit[] = [];
	for (const row of rows) {
		const seedId = groupToSeedId.get(row.byline_id);
		if (!seedId) continue;
		const credit: SeedBylineCredit = { byline: seedId };
		if (row.role_label) credit.roleLabel = row.role_label;
		credits.push(credit);
	}

	return credits;
}

async function getTaxonomyAssignments(
	taxonomyRepo: TaxonomyRepository,
	collection: string,
	entryId: string,
): Promise<Record<string, string[]>> {
	const terms = await taxonomyRepo.getTermsForEntry(collection, entryId);
	const result: Record<string, string[]> = {};

	for (const term of terms) {
		if (!result[term.name]) {
			result[term.name] = [];
		}
		result[term.name].push(term.slug);
	}

	return result;
}
