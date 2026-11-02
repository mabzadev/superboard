import { imageSize } from "image-size";
import type { Kysely } from "kysely";
import mime from "mime/lite";
import { ulid } from "ulidx";

import { BylineRepository } from "../database/repositories/byline.js";
import { ContentRepository } from "../database/repositories/content.js";
import { MediaRepository } from "../database/repositories/media.js";
import { RedirectRepository } from "../database/repositories/redirect.js";
import { RevisionRepository } from "../database/repositories/revision.js";
import { TaxonomyRepository } from "../database/repositories/taxonomy.js";
import { withTransaction } from "../database/transaction.js";
import type { Database } from "../database/types.js";
import type { MediaValue } from "../fields/types.js";
import { getI18nConfig, resolveConfiguredLocale } from "../i18n/config.js";
import { ssrfSafeFetch, validateExternalUrl } from "../import/ssrf.js";
import { markContentMediaUsageCollectionStaleSafely } from "../media/usage/content-refresh.js";
import { SchemaRegistry } from "../schema/registry.js";
import { FTSManager } from "../search/fts-manager.js";
import { setSiteSettings } from "../settings/index.js";
import type { Storage } from "../storage/types.js";
import type {
	SeedFile,
	SeedApplyOptions,
	SeedApplyResult,
	SeedCollection,
	SeedTaxonomyTerm,
	SeedMenuItem,
	SeedWidget,
	SeedMediaReference,
	SeedBylineAvatar,
} from "./types.js";

async function applyDisplayDateFields(
	registry: SchemaRegistry,
	collection: SeedCollection,
): Promise<void> {
	if (collection.titleField === undefined && collection.dateField === undefined) return;
	await registry.updateCollection(collection.slug, {
		titleField: collection.titleField,
		dateField: collection.dateField,
	});
}

const FILE_EXTENSION_PATTERN = /\.([a-z0-9]+)(?:\?|$)/i;
import { validateSeed } from "./validate.js";

const EXTENSION_PATTERN = /\.[^.]+$/;

const QUERY_PARAM_PATTERN = /\?.*$/;

const SANITIZE_PATTERN = /[^a-zA-Z0-9_-]/g;

const MULTIPLE_HYPHENS_PATTERN = /-+/g;

export async function applySeed(
	db: Kysely<Database>,
	seed: SeedFile,
	options: SeedApplyOptions = {},
): Promise<SeedApplyResult> {
	const validation = validateSeed(seed);
	if (!validation.valid) {
		throw new Error(`Invalid seed file:\n${validation.errors.join("\n")}`);
	}

	const {
		includeContent = false,
		storage,
		skipMediaDownload = false,
		onConflict = "skip",
	} = options;

	const result: SeedApplyResult = {
		collections: { created: 0, skipped: 0, updated: 0 },
		fields: { created: 0, skipped: 0, updated: 0 },
		taxonomies: { created: 0, terms: 0 },
		bylines: { created: 0, skipped: 0, updated: 0 },
		menus: { created: 0, items: 0 },
		redirects: { created: 0, skipped: 0, updated: 0 },
		widgetAreas: { created: 0, widgets: 0 },
		sections: { created: 0, skipped: 0, updated: 0 },
		settings: { applied: 0 },
		content: { created: 0, skipped: 0, updated: 0 },
		media: { created: 0, skipped: 0 },
	};

	const mediaContext: MediaContext = {
		db,
		storage: storage ?? null,
		skipMediaDownload,
		mediaCache: new Map(),
	};

	const seedIdMap = new Map<string, string>();
	const seedBylineIdMap = new Map<string, string>();
	const staleMarkedContentCollections = new Set<string>();
	const failedStaleContentCollections = new Set<string>();

	const defaultLocale = getI18nConfig()?.defaultLocale ?? seed.defaultLocale ?? "en";
	const markSeedContentCollectionStale = async (collectionSlug: string): Promise<void> => {
		if (staleMarkedContentCollections.has(collectionSlug)) return;
		const marked = await markContentMediaUsageCollectionStaleSafely(
			db,
			collectionSlug,
			"CONTENT_USAGE_STALE",
		);
		if (marked) {
			staleMarkedContentCollections.add(collectionSlug);
			failedStaleContentCollections.delete(collectionSlug);
		} else {
			failedStaleContentCollections.add(collectionSlug);
		}
	};
	const retryFailedSeedContentStaleMarks = async (): Promise<void> => {
		for (const collectionSlug of failedStaleContentCollections) {
			const marked = await markContentMediaUsageCollectionStaleSafely(
				db,
				collectionSlug,
				"CONTENT_USAGE_STALE",
			);
			if (marked) {
				staleMarkedContentCollections.add(collectionSlug);
				failedStaleContentCollections.delete(collectionSlug);
			}
		}
	};

	if (seed.settings) {
		await setSiteSettings(seed.settings, db);
		result.settings.applied = Object.keys(seed.settings).length;
	}

	if (seed.collections) {
		const registry = new SchemaRegistry(db);

		for (const collection of seed.collections) {
			const existing = await registry.getCollection(collection.slug);

			if (existing) {
				if (onConflict === "error") {
					throw new Error(`Conflict: collection "${collection.slug}" already exists`);
				}

				if (onConflict === "update") {
					await registry.updateCollection(collection.slug, {
						label: collection.label,
						labelSingular: collection.labelSingular,
						description: collection.description,
						icon: collection.icon,
						admin: collection.admin,
						supports: collection.supports || [],
						urlPattern: collection.urlPattern,
						routable: collection.routable,
						hidden: collection.hidden,
						sortOrder: collection.sortOrder,
						commentsEnabled: collection.commentsEnabled,
					});
					result.collections.updated++;

					for (const field of collection.fields) {
						const existingField = await registry.getField(collection.slug, field.slug);
						if (existingField) {
							await registry.updateField(collection.slug, field.slug, {
								label: field.label,
								type: field.type,
								required: field.required || false,
								unique: field.unique || false,
								searchable: field.searchable || false,
								indexed: field.indexed || false,
								defaultValue: field.defaultValue,
								validation: field.validation,
								widget: field.widget,
								options: field.options,
							});
							result.fields.updated++;
						} else {
							await registry.createField(collection.slug, {
								slug: field.slug,
								label: field.label,
								type: field.type,
								required: field.required || false,
								unique: field.unique || false,
								searchable: field.searchable || false,
								indexed: field.indexed || false,
								defaultValue: field.defaultValue,
								validation: field.validation,
								widget: field.widget,
								options: field.options,
							});
							result.fields.created++;
						}
					}

					await applyDisplayDateFields(registry, collection);
					continue;
				}

				result.collections.skipped++;
				result.fields.skipped += collection.fields.length;
				continue;
			}

			const fields = collection.fields.map((field) => ({
				slug: field.slug,
				label: field.label,
				type: field.type,
				required: field.required || false,
				unique: field.unique || false,
				searchable: field.searchable || false,
				indexed: field.indexed || false,
				defaultValue: field.defaultValue,
				validation: field.validation,
				widget: field.widget,
				options: field.options,
			}));

			await registry.createSeedCollection(
				{
					slug: collection.slug,
					label: collection.label,
					labelSingular: collection.labelSingular,
					description: collection.description,
					icon: collection.icon,
					admin: collection.admin,
					supports: collection.supports || [],
					urlPattern: collection.urlPattern,
					routable: collection.routable,
					hidden: collection.hidden,
					sortOrder: collection.sortOrder,
					commentsEnabled: collection.commentsEnabled,
				},
				fields,
			);
			await applyDisplayDateFields(registry, collection);
			result.collections.created++;
			result.fields.created += fields.length;
		}
	}

	if (seed.taxonomies) {
		const defSeedIdMap = new Map<string, { id: string; translationGroup: string }>();
		const termSeedIdMap = new Map<string, string>();

		for (const taxonomy of seed.taxonomies) {
			const defLocale = resolveConfiguredLocale(taxonomy.locale ?? defaultLocale);

			const existingDef = await db
				.selectFrom("_emdash_taxonomy_defs")
				.selectAll()
				.where("name", "=", taxonomy.name)
				.where("locale", "=", defLocale)
				.executeTakeFirst();

			let defId: string;
			let defTranslationGroup: string;

			if (existingDef) {
				defId = existingDef.id;
				defTranslationGroup = existingDef.translation_group ?? existingDef.id;
				if (onConflict === "error") {
					throw new Error(`Conflict: taxonomy "${taxonomy.name}" (${defLocale}) already exists`);
				}
				if (onConflict === "update") {
					await db
						.updateTable("_emdash_taxonomy_defs")
						.set({
							label: taxonomy.label,
							label_singular: taxonomy.labelSingular ?? null,
							hierarchical: taxonomy.hierarchical ? 1 : 0,
							collections: JSON.stringify(taxonomy.collections),
						})
						.where("id", "=", existingDef.id)
						.execute();
				}
			} else {
				defId = ulid();
				defTranslationGroup = defId;
				if (taxonomy.translationOf) {
					const source = defSeedIdMap.get(taxonomy.translationOf);
					if (source) defTranslationGroup = source.translationGroup;
					else
						console.warn(
							`taxonomy "${taxonomy.name}" (${defLocale}): translationOf "${taxonomy.translationOf}" not found yet; minting a fresh group.`,
						);
				}
				await db
					.insertInto("_emdash_taxonomy_defs")
					.values({
						id: defId,
						name: taxonomy.name,
						label: taxonomy.label,
						label_singular: taxonomy.labelSingular ?? null,
						hierarchical: taxonomy.hierarchical ? 1 : 0,
						collections: JSON.stringify(taxonomy.collections),
						locale: defLocale,
						translation_group: defTranslationGroup,
					})
					.execute();
				result.taxonomies.created++;
			}

			if (taxonomy.id)
				defSeedIdMap.set(taxonomy.id, { id: defId, translationGroup: defTranslationGroup });

			if (includeContent && taxonomy.terms && taxonomy.terms.length > 0) {
				const termRepo = new TaxonomyRepository(db);

				if (taxonomy.hierarchical) {
					await applyHierarchicalTerms(
						termRepo,
						taxonomy.name,
						defLocale,
						taxonomy.terms,
						termSeedIdMap,
						result,
						onConflict,
					);
				} else {
					for (const term of taxonomy.terms) {
						const termLocale = resolveConfiguredLocale(term.locale ?? defLocale);
						const existing = await termRepo.findBySlug(taxonomy.name, term.slug, termLocale);
						if (existing) {
							if (onConflict === "error") {
								throw new Error(
									`Conflict: taxonomy term "${term.slug}" in "${taxonomy.name}" (${termLocale}) already exists`,
								);
							}
							if (onConflict === "update") {
								await termRepo.update(existing.id, {
									label: term.label,
									data: term.description ? { description: term.description } : {},
								});
								result.taxonomies.terms++;
							}
							if (term.id) termSeedIdMap.set(term.id, existing.id);
						} else {
							const translationOf = term.translationOf
								? termSeedIdMap.get(term.translationOf)
								: undefined;
							const created = await termRepo.create({
								name: taxonomy.name,
								slug: term.slug,
								label: term.label,
								data: term.description ? { description: term.description } : undefined,
								locale: termLocale,
								translationOf,
							});
							if (term.id) termSeedIdMap.set(term.id, created.id);
							result.taxonomies.terms++;
						}
					}
				}
			}
		}

		const { invalidateTaxonomyDefsCache } = await import("../taxonomies/index.js");
		invalidateTaxonomyDefsCache();
	}

	if (includeContent && seed.bylines) {
		const bylineRepo = new BylineRepository(db);
		for (const byline of seed.bylines) {
			const existing = await bylineRepo.findBySlug(byline.slug);
			if (existing) {
				if (onConflict === "error") {
					throw new Error(`Conflict: byline "${byline.slug}" already exists`);
				}

				if (onConflict === "update") {
					const avatar = byline.avatar ? await resolveSeedBylineAvatar(db, byline.avatar) : null;
					try {
						const updated = await bylineRepo.update(existing.id, {
							displayName: byline.displayName,
							bio: byline.bio ?? null,
							websiteUrl: byline.websiteUrl ?? null,
							isGuest: byline.isGuest,
							...(avatar ? { avatarMediaId: avatar.id } : {}),
						});
						if (!updated) {
							throw new Error(`Byline "${byline.slug}" disappeared during update`);
						}
					} catch (error) {
						if (avatar?.created) await deleteMediaRow(db, avatar.id);
						throw error;
					}
					seedBylineIdMap.set(byline.id, existing.id);
					result.bylines.updated++;
					if (avatar?.created) result.media.created++;
					continue;
				}

				seedBylineIdMap.set(byline.id, existing.id);
				result.bylines.skipped++;
				continue;
			}

			const avatar = byline.avatar ? await resolveSeedBylineAvatar(db, byline.avatar) : null;
			let createdId: string;
			try {
				const created = await bylineRepo.create({
					slug: byline.slug,
					displayName: byline.displayName,
					bio: byline.bio ?? null,
					websiteUrl: byline.websiteUrl ?? null,
					isGuest: byline.isGuest,
					avatarMediaId: avatar?.id ?? null,
				});
				createdId = created.id;
			} catch (error) {
				if (avatar?.created) await deleteMediaRow(db, avatar.id);
				throw error;
			}
			seedBylineIdMap.set(byline.id, createdId);
			result.bylines.created++;
			if (avatar?.created) result.media.created++;
		}
	}

	if (includeContent && seed.content) {
		const contentRepo = new ContentRepository(db);
		const schemaRegistry = new SchemaRegistry(db);

		try {
			for (const [collectionSlug, entries] of Object.entries(seed.content)) {
				const collectionRoutable =
					(await schemaRegistry.getCollection(collectionSlug))?.routable !== false;
				for (const entry of entries) {
					const entrySlug =
						typeof entry.slug === "string" && entry.slug.trim().length > 0 ? entry.slug : null;
					const entryLocale = resolveConfiguredLocale(entry.locale ?? defaultLocale);

					const existing = entrySlug
						? await contentRepo.findBySlug(collectionSlug, entrySlug, entryLocale)
						: await contentRepo.findById(collectionSlug, entry.id);

					if (!existing) {
						const trashed = entrySlug
							? await contentRepo.findBySlugIncludingTrashed(collectionSlug, entrySlug, entryLocale)
							: await contentRepo.findByIdIncludingTrashed(collectionSlug, entry.id);
						if (trashed) {
							if (onConflict === "error") {
								throw new Error(
									`Conflict: content "${entrySlug ?? entry.id}" in "${collectionSlug}" already exists`,
								);
							}
							result.content.skipped++;
							seedIdMap.set(entry.id, trashed.id);
							continue;
						}
					}

					if (existing) {
						if (onConflict === "error") {
							throw new Error(
								`Conflict: content "${entrySlug ?? entry.id}" in "${collectionSlug}" already exists`,
							);
						}

						if (onConflict === "update") {
							const resolvedData = await resolveReferences(
								entry.data,
								seedIdMap,
								mediaContext,
								result,
							);

							const status = entry.status || "published";
							let contentMutated = false;
							try {
								await withTransaction(db, async (trx) => {
									const trxContentRepo = new ContentRepository(trx);
									const trxBylineRepo = new BylineRepository(trx);
									const trxRevisionRepo = new RevisionRepository(trx);

									await trxContentRepo.update(collectionSlug, existing.id, {
										status,
										data: resolvedData,
									});
									contentMutated = true;

									await applyContentBylines(
										trxBylineRepo,
										collectionSlug,
										existing.id,
										entry,
										seedBylineIdMap,
										true,
									);
									await applyContentTaxonomies(trx, collectionSlug, existing.id, entry, true);

									if (status === "published") {
										const draft = await trxRevisionRepo.create({
											collection: collectionSlug,
											entryId: existing.id,
											data: resolvedData,
										});
										try {
											await trxContentRepo.setDraftRevision(collectionSlug, existing.id, draft.id);
											await trxContentRepo.publish(
												collectionSlug,
												existing.id,
												undefined,
												false,
												undefined,
												true,
												collectionRoutable,
											);
										} catch (error) {
											try {
												await trxRevisionRepo.deleteIfUnreferenced(
													collectionSlug,
													existing.id,
													draft.id,
												);
											} catch (cleanupError) {
												console.error(
													`[seed] Failed to clean up unstaged revision ${draft.id}:`,
													cleanupError,
												);
											}
											throw error;
										}
									}
								});
							} catch (error) {
								if (contentMutated) await markSeedContentCollectionStale(collectionSlug);
								throw error;
							}

							seedIdMap.set(entry.id, existing.id);
							result.content.updated++;
							await markSeedContentCollectionStale(collectionSlug);
							continue;
						}

						result.content.skipped++;
						seedIdMap.set(entry.id, existing.id);
						continue;
					}

					const resolvedData = await resolveReferences(entry.data, seedIdMap, mediaContext, result);

					let translationOf: string | undefined;
					if (entry.translationOf) {
						const sourceId = seedIdMap.get(entry.translationOf);
						if (!sourceId) {
							console.warn(
								`content.${collectionSlug}: translationOf "${entry.translationOf}" not found (not yet created or missing). Skipping translation link.`,
							);
						} else {
							translationOf = sourceId;
						}
					}

					const status = entry.status || "published";
					let contentMutated = false;
					let created: Awaited<ReturnType<ContentRepository["create"]>>;
					try {
						created = await withTransaction(db, async (trx) => {
							const trxContentRepo = new ContentRepository(trx);
							const trxBylineRepo = new BylineRepository(trx);

							const item = await trxContentRepo.create({
								...(entrySlug ? {} : { id: entry.id }),
								type: collectionSlug,
								slug: entrySlug,
								status,
								data: resolvedData,
								locale: entryLocale,
								translationOf,
								publishedAt: status === "published" ? new Date().toISOString() : null,
							});
							contentMutated = true;

							await applyContentBylines(
								trxBylineRepo,
								collectionSlug,
								item.id,
								entry,
								seedBylineIdMap,
							);
							await applyContentTaxonomies(trx, collectionSlug, item.id, entry, false);

							if (status === "published") {
								await trxContentRepo.publish(
									collectionSlug,
									item.id,
									undefined,
									false,
									undefined,
									true,
									collectionRoutable,
								);
							}

							return item;
						});
					} catch (error) {
						if (contentMutated) await markSeedContentCollectionStale(collectionSlug);
						throw error;
					}

					seedIdMap.set(entry.id, created.id);
					result.content.created++;
					await markSeedContentCollectionStale(collectionSlug);
				}
			}
		} finally {
			await retryFailedSeedContentStaleMarks();
		}
	}

	if (seed.menus) {
		const menuSeedIdMap = new Map<string, { id: string; translationGroup: string }>();
		const itemSeedIdMap = new Map<string, { id: string; translationGroup: string }>();

		for (const menu of seed.menus) {
			const locale = resolveConfiguredLocale(menu.locale ?? defaultLocale);
			let lookup = db
				.selectFrom("_emdash_menus")
				.selectAll()
				.where("name", "=", menu.name)
				.where("locale", "=", locale);
			const existingMenu = await lookup.executeTakeFirst();

			let menuId: string;
			let translationGroup: string;

			if (existingMenu) {
				menuId = existingMenu.id;
				translationGroup = existingMenu.translation_group ?? existingMenu.id;
				await db.deleteFrom("_emdash_menu_items").where("menu_id", "=", menuId).execute();
			} else {
				menuId = ulid();
				translationGroup = menuId;
				if (menu.translationOf) {
					const source = menuSeedIdMap.get(menu.translationOf);
					if (source) translationGroup = source.translationGroup;
					else
						console.warn(
							`menu "${menu.name}" (${locale}): translationOf "${menu.translationOf}" not found yet; minting a fresh group.`,
						);
				}
				await db
					.insertInto("_emdash_menus")
					.values({
						id: menuId,
						name: menu.name,
						label: menu.label,
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						locale,
						translation_group: translationGroup,
					})
					.execute();
				result.menus.created++;
			}

			if (menu.id) menuSeedIdMap.set(menu.id, { id: menuId, translationGroup });

			const itemCount = await applyMenuItems(
				db,
				menuId,
				locale,
				menu.items,
				null,
				0,
				seedIdMap,
				itemSeedIdMap,
			);
			result.menus.items += itemCount;
		}
	}

	if (seed.redirects) {
		const redirectRepo = new RedirectRepository(db);

		for (const redirect of seed.redirects) {
			const existing = await redirectRepo.findBySource(redirect.source);
			if (existing) {
				if (onConflict === "error") {
					throw new Error(`Conflict: redirect "${redirect.source}" already exists`);
				}

				if (onConflict === "update") {
					await redirectRepo.update(existing.id, {
						destination: redirect.destination,
						type: redirect.type,
						enabled: redirect.enabled,
						groupName: redirect.groupName,
					});
					result.redirects.updated++;
					continue;
				}

				result.redirects.skipped++;
				continue;
			}

			await redirectRepo.create({
				source: redirect.source,
				destination: redirect.destination,
				type: redirect.type,
				enabled: redirect.enabled,
				groupName: redirect.groupName,
			});
			result.redirects.created++;
		}
	}

	if (seed.widgetAreas) {
		for (const area of seed.widgetAreas) {
			const existingArea = await db
				.selectFrom("_emdash_widget_areas")
				.selectAll()
				.where("name", "=", area.name)
				.executeTakeFirst();

			let areaId: string;

			if (existingArea) {
				areaId = existingArea.id;
				await db.deleteFrom("_emdash_widgets").where("area_id", "=", areaId).execute();
			} else {
				areaId = ulid();
				await db
					.insertInto("_emdash_widget_areas")
					.values({
						id: areaId,
						name: area.name,
						label: area.label,
						description: area.description ?? null,
					})
					.execute();
				result.widgetAreas.created++;
			}

			for (let i = 0; i < area.widgets.length; i++) {
				const widget = area.widgets[i];
				await applyWidget(db, areaId, widget, i);
				result.widgetAreas.widgets++;
			}
		}
	}

	if (seed.sections) {
		for (const section of seed.sections) {
			const existing = await db
				.selectFrom("_emdash_sections")
				.select("id")
				.where("slug", "=", section.slug)
				.executeTakeFirst();

			if (existing) {
				if (onConflict === "error") {
					throw new Error(`Conflict: section "${section.slug}" already exists`);
				}

				if (onConflict === "update") {
					await db
						.updateTable("_emdash_sections")
						.set({
							title: section.title,
							description: section.description ?? null,
							keywords: section.keywords ? JSON.stringify(section.keywords) : null,
							content: JSON.stringify(section.content),
							source: section.source || "theme",
							updated_at: new Date().toISOString(),
						})
						.where("id", "=", existing.id)
						.execute();
					result.sections.updated++;
					continue;
				}

				result.sections.skipped++;
				continue;
			}

			const id = ulid();
			const now = new Date().toISOString();

			await db
				.insertInto("_emdash_sections")
				.values({
					id,
					slug: section.slug,
					title: section.title,
					description: section.description ?? null,
					keywords: section.keywords ? JSON.stringify(section.keywords) : null,
					content: JSON.stringify(section.content),
					preview_media_id: null,
					source: section.source || "theme",
					theme_id: section.source === "theme" ? section.slug : null,
					created_at: now,
					updated_at: now,
				})
				.execute();

			result.sections.created++;
		}
	}

	if (seed.collections) {
		const ftsManager = new FTSManager(db);

		for (const collection of seed.collections) {
			if (collection.supports?.includes("search")) {
				const searchableFields = await ftsManager.getSearchableFields(collection.slug);
				if (searchableFields.length > 0) {
					try {
						await ftsManager.enableSearch(collection.slug);
					} catch (err) {
						console.warn(`Failed to enable search for ${collection.slug}:`, err);
					}
				}
			}
		}
	}

	const { invalidateBylineCache } = await import("../bylines/index.js");
	const { invalidateRedirectCache } = await import("../redirects/cache.js");
	const { invalidateUrlPatternCache } = await import("../query.js");
	invalidateBylineCache();
	invalidateRedirectCache();
	invalidateUrlPatternCache();

	return result;
}

async function applyHierarchicalTerms(
	termRepo: TaxonomyRepository,
	taxonomyName: string,
	defLocale: string,
	terms: SeedTaxonomyTerm[],
	termSeedIdMap: Map<string, string>,
	result: SeedApplyResult,
	onConflict: "skip" | "update" | "error" = "skip",
): Promise<void> {
	const slugToId = new Map<string, string>();
	const resolveTermLocale = (term: SeedTaxonomyTerm) =>
		resolveConfiguredLocale(term.locale ?? defLocale);

	let remaining = [...terms];
	let maxPasses = 10;

	while (remaining.length > 0 && maxPasses > 0) {
		const processedThisPass: string[] = [];

		for (const term of remaining) {
			const termLocale = resolveTermLocale(term);
			const parentReady = !term.parent || slugToId.has(`${termLocale}::${term.parent}`);
			const translationReady = !term.translationOf || termSeedIdMap.has(term.translationOf);

			if (!parentReady || !translationReady) continue;

			const parentId = term.parent ? slugToId.get(`${termLocale}::${term.parent}`) : undefined;
			const translationOf = term.translationOf ? termSeedIdMap.get(term.translationOf) : undefined;

			const existing = await termRepo.findBySlug(taxonomyName, term.slug, termLocale);
			if (existing) {
				if (onConflict === "error") {
					throw new Error(
						`Conflict: taxonomy term "${term.slug}" in "${taxonomyName}" (${termLocale}) already exists`,
					);
				}
				if (onConflict === "update") {
					await termRepo.update(existing.id, {
						label: term.label,
						parentId,
						data: term.description ? { description: term.description } : {},
					});
					result.taxonomies.terms++;
				}
				slugToId.set(`${termLocale}::${term.slug}`, existing.id);
				if (term.id) termSeedIdMap.set(term.id, existing.id);
			} else {
				const created = await termRepo.create({
					name: taxonomyName,
					slug: term.slug,
					label: term.label,
					parentId,
					data: term.description ? { description: term.description } : undefined,
					locale: termLocale,
					translationOf,
				});
				slugToId.set(`${termLocale}::${term.slug}`, created.id);
				if (term.id) termSeedIdMap.set(term.id, created.id);
				result.taxonomies.terms++;
			}

			processedThisPass.push(term.slug + "::" + termLocale);
		}

		remaining = remaining.filter(
			(term) => !processedThisPass.includes(term.slug + "::" + resolveTermLocale(term)),
		);
		maxPasses--;
	}

	if (remaining.length > 0) {
		console.warn(`Could not process ${remaining.length} terms due to missing parents/translations`);
	}
}

async function applyContentBylines(
	bylineRepo: BylineRepository,
	collectionSlug: string,
	contentId: string,
	entry: {
		id: string;
		slug?: string | null;
		bylines?: Array<{ byline: string; roleLabel?: string }>;
	},
	seedBylineIdMap: Map<string, string>,
	isUpdate = false,
): Promise<void> {
	if (!entry.bylines || entry.bylines.length === 0) {
		if (isUpdate) {
			await bylineRepo.setContentBylines(collectionSlug, contentId, []);
		}
		return;
	}

	const credits = entry.bylines
		.map((credit) => {
			const bylineId = seedBylineIdMap.get(credit.byline);
			if (!bylineId) return null;
			return {
				bylineId,
				roleLabel: credit.roleLabel ?? null,
			};
		})
		.filter((credit): credit is { bylineId: string; roleLabel: string | null } => Boolean(credit));

	if (credits.length !== entry.bylines.length) {
		console.warn(
			`content.${collectionSlug}.${entry.slug ?? entry.id}: one or more byline refs could not be resolved`,
		);
	}

	if (credits.length > 0 || isUpdate) {
		await bylineRepo.setContentBylines(collectionSlug, contentId, credits);
	}
}

async function applyContentTaxonomies(
	db: Kysely<Database>,
	collectionSlug: string,
	contentId: string,
	entry: { taxonomies?: Record<string, string[]> },
	isUpdate: boolean,
): Promise<void> {
	const termRepo = new TaxonomyRepository(db);
	if (isUpdate) {
		await termRepo.clearEntryTerms(collectionSlug, contentId);
	}

	if (!entry.taxonomies) {
		if (isUpdate) {
			const { invalidateTermCache } = await import("../taxonomies/index.js");
			invalidateTermCache();
		}
		return;
	}

	for (const [taxonomyName, termSlugs] of Object.entries(entry.taxonomies)) {
		for (const termSlug of termSlugs) {
			const term = await termRepo.findBySlug(taxonomyName, termSlug);
			if (term) {
				await termRepo.attachToEntry(collectionSlug, contentId, term.id);
			}
		}
	}

	const { invalidateTermCache } = await import("../taxonomies/index.js");
	invalidateTermCache();
}

async function applyMenuItems(
	db: Kysely<Database>,
	menuId: string,
	locale: string,
	items: SeedMenuItem[],
	parentId: string | null,
	startOrder: number,
	seedIdMap: Map<string, string>,
	itemSeedIdMap: Map<string, { id: string; translationGroup: string }>,
): Promise<number> {
	let count = 0;
	let order = startOrder;

	for (const item of items) {
		const itemId = ulid();
		const itemLocale = item.locale ?? locale;

		let referenceId: string | null = null;
		let referenceCollection: string | null = null;

		if (item.type === "page" || item.type === "post") {
			if (item.ref && seedIdMap.has(item.ref)) {
				referenceId = seedIdMap.get(item.ref)!;
				referenceCollection = item.collection || `${item.type}s`;
			}
		}

		let translationGroup = itemId;
		if (item.translationOf) {
			const source = itemSeedIdMap.get(item.translationOf);
			if (source) translationGroup = source.translationGroup;
			else
				console.warn(
					`menu item "${item.label ?? item.url ?? item.ref ?? "(unlabeled)"}" (${itemLocale}): translationOf "${item.translationOf}" not found yet; minting a fresh group.`,
				);
		}

		await db
			.insertInto("_emdash_menu_items")
			.values({
				id: itemId,
				menu_id: menuId,
				parent_id: parentId,
				sort_order: order,
				type: item.type,
				reference_collection: referenceCollection,
				reference_id: referenceId,
				custom_url: item.url ?? null,
				label: item.label || "",
				title_attr: item.titleAttr ?? null,
				target: item.target ?? null,
				css_classes: item.cssClasses ?? null,
				created_at: new Date().toISOString(),
				locale: itemLocale,
				translation_group: translationGroup,
			})
			.execute();

		if (item.id) itemSeedIdMap.set(item.id, { id: itemId, translationGroup });

		count++;
		order++;

		if (item.children && item.children.length > 0) {
			const childCount = await applyMenuItems(
				db,
				menuId,
				itemLocale,
				item.children,
				itemId,
				0,
				seedIdMap,
				itemSeedIdMap,
			);
			count += childCount;
		}
	}

	return count;
}

async function applyWidget(
	db: Kysely<Database>,
	areaId: string,
	widget: SeedWidget,
	sortOrder: number,
): Promise<void> {
	await db
		.insertInto("_emdash_widgets")
		.values({
			id: ulid(),
			area_id: areaId,
			sort_order: sortOrder,
			type: widget.type,
			title: widget.title ?? null,
			content: widget.content ? JSON.stringify(widget.content) : null,
			menu_name: widget.menuName ?? null,
			component_id: widget.componentId ?? null,
			component_props: widget.props ? JSON.stringify(widget.props) : null,
		})
		.execute();
}

interface MediaContext {
	db: Kysely<Database>;
	storage: Storage | null;
	skipMediaDownload: boolean;
	mediaCache: Map<string, MediaValue>;
}

function isSeedMediaReference(value: unknown): value is SeedMediaReference {
	if (typeof value !== "object" || value === null || !("$media" in value)) {
		return false;
	}
	const media = (value as Record<string, unknown>).$media;
	return (
		typeof media === "object" &&
		media !== null &&
		"url" in media &&
		typeof (media as Record<string, unknown>).url === "string"
	);
}

async function resolveReferences(
	data: Record<string, unknown>,
	seedIdMap: Map<string, string>,
	mediaContext: MediaContext,
	result: SeedApplyResult,
): Promise<Record<string, unknown>> {
	const resolved: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(data)) {
		resolved[key] = await resolveValue(value, seedIdMap, mediaContext, result);
	}

	return resolved;
}

async function resolveValue(
	value: unknown,
	seedIdMap: Map<string, string>,
	mediaContext: MediaContext,
	result: SeedApplyResult,
): Promise<unknown> {
	if (typeof value === "string" && value.startsWith("$ref:")) {
		const seedId = value.slice(5);
		return seedIdMap.get(seedId) ?? value;
	}

	if (isSeedMediaReference(value)) {
		return resolveMedia(value, mediaContext, result);
	}

	if (Array.isArray(value)) {
		return Promise.all(value.map((item) => resolveValue(item, seedIdMap, mediaContext, result)));
	}

	if (typeof value === "object" && value !== null) {
		const resolved: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			resolved[k] = await resolveValue(v, seedIdMap, mediaContext, result);
		}
		return resolved;
	}

	return value;
}

async function resolveSeedBylineAvatar(
	db: Kysely<Database>,
	avatar: SeedBylineAvatar,
): Promise<{ id: string; created: boolean }> {
	const existing = await db
		.selectFrom("media")
		.select("id")
		.where("storage_key", "=", avatar.storageKey)
		.orderBy("id", "asc")
		.executeTakeFirst();
	if (existing) return { id: existing.id, created: false };

	const basename = avatar.storageKey.split("/").pop();
	const filename =
		avatar.filename ?? (basename && basename.length > 0 ? basename : avatar.storageKey);
	const created = await new MediaRepository(db).create({
		filename,
		mimeType: avatar.mimeType ?? "image/jpeg",
		storageKey: avatar.storageKey,
		alt: avatar.alt,
		width: avatar.width,
		height: avatar.height,
		status: "ready",
	});
	return { id: created.id, created: true };
}

async function deleteMediaRow(db: Kysely<Database>, id: string): Promise<void> {
	try {
		await db.deleteFrom("media").where("id", "=", id).execute();
	} catch (error) {
		console.warn(`[seed] failed to clean up orphaned avatar media ${id}:`, error);
	}
}

async function resolveMedia(
	ref: SeedMediaReference,
	ctx: MediaContext,
	result: SeedApplyResult,
): Promise<MediaValue | null> {
	const { url, alt, filename, caption } = ref.$media;

	const cached = ctx.mediaCache.get(url);
	if (cached) {
		result.media.skipped++;
		return { ...cached, alt: alt ?? cached.alt };
	}

	if (ctx.skipMediaDownload) {
		const mediaValue: MediaValue = {
			provider: "external",
			id: ulid(),
			src: url,
			alt: alt ?? undefined,
			filename: filename ?? undefined,
		};
		ctx.mediaCache.set(url, mediaValue);
		result.media.created++;
		return mediaValue;
	}

	if (!ctx.storage) {
		console.warn(`Skipping $media reference (no storage configured): ${url}`);
		result.media.skipped++;
		return null;
	}

	try {
		validateExternalUrl(url);

		console.log(`  📥 Downloading: ${url}`);
		const response = await ssrfSafeFetch(url, {
			headers: {
				"User-Agent": "EmDash-CMS/1.0",
			},
		});

		if (!response.ok) {
			console.warn(`  ⚠️ Failed to download ${url}: ${response.status}`);
			result.media.skipped++;
			return null;
		}

		const contentType = response.headers.get("content-type") || "application/octet-stream";
		const ext = getExtensionFromContentType(contentType) || getExtensionFromUrl(url) || ".bin";

		const storageId = ulid();
		const finalFilename = filename || generateFilename(url, ext);
		const storageKey = `${storageId}${ext}`;

		const arrayBuffer = await response.arrayBuffer();
		const body = new Uint8Array(arrayBuffer);

		let width: number | undefined;
		let height: number | undefined;
		if (contentType.startsWith("image/")) {
			const dimensions = getImageDimensions(body);
			width = dimensions?.width;
			height = dimensions?.height;
		}

		await ctx.storage.upload({
			key: storageKey,
			body,
			contentType,
		});

		const mediaRepo = new MediaRepository(ctx.db);
		const media = await mediaRepo.create({
			filename: finalFilename,
			mimeType: contentType,
			size: body.length,
			width,
			height,
			alt,
			caption,
			storageKey,
			status: "ready",
		});

		const mediaValue: MediaValue = {
			provider: "local",
			id: media.id,
			alt: alt ?? undefined,
			width,
			height,
			mimeType: contentType,
			filename: finalFilename,
			meta: { storageKey },
		};

		ctx.mediaCache.set(url, mediaValue);
		result.media.created++;

		console.log(`  ✅ Uploaded: ${finalFilename}`);
		return mediaValue;
	} catch (error) {
		console.warn(
			`  ⚠️ Error processing $media ${url}:`,
			error instanceof Error ? error.message : error,
		);
		result.media.skipped++;
		return null;
	}
}

function getExtensionFromContentType(contentType: string): string | null {
	const baseMime = contentType.split(";")[0].trim();
	const ext = mime.getExtension(baseMime);
	return ext ? `.${ext}` : null;
}

function getExtensionFromUrl(url: string): string | null {
	try {
		const pathname = new URL(url).pathname;
		const match = pathname.match(FILE_EXTENSION_PATTERN);
		return match ? `.${match[1]}` : null;
	} catch {
		return null;
	}
}

function generateFilename(url: string, ext: string): string {
	try {
		const pathname = new URL(url).pathname;
		const basename = pathname.split("/").pop() || "media";
		const name = basename.replace(EXTENSION_PATTERN, "").replace(QUERY_PARAM_PATTERN, "");
		const sanitized = name.replace(SANITIZE_PATTERN, "-").replace(MULTIPLE_HYPHENS_PATTERN, "-");
		return `${sanitized || "media"}${ext}`;
	} catch {
		return `media${ext}`;
	}
}

function getImageDimensions(buffer: Uint8Array): { width: number; height: number } | null {
	try {
		const result = imageSize(buffer);
		if (result.width != null && result.height != null) {
			return { width: result.width, height: result.height };
		}
		return null;
	} catch {
		return null;
	}
}
