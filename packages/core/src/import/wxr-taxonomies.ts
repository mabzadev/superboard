import type { Kysely } from "kysely";

import type { WxrCategory, WxrPost, WxrTag, WxrTerm } from "../cli/wxr/parser.js";
import { TaxonomyRepository } from "../database/repositories/taxonomy.js";
import type { Database } from "../database/types.js";
import { resolveLocaleChain } from "../i18n/resolve.js";
import { invalidateTermCache } from "../taxonomies/index.js";

export class WxrTaxonomyConflictError extends Error {
	readonly publicMessage: string;
	constructor(publicMessage: string, options?: { cause?: unknown }) {
		super(publicMessage, options);
		this.name = "WxrTaxonomyConflictError";
		this.publicMessage = publicMessage;
	}
}

export function isWxrTaxonomyConflictError(error: unknown): error is WxrTaxonomyConflictError {
	return error instanceof WxrTaxonomyConflictError;
}

export interface TaxonomyImportPlan {
	termsCreated: Record<string, number>;
	termsReused: Record<string, number>;
	missingTaxonomies: string[];
	termIdByNameAndSlug: Map<string, Map<string, string>>;
	collectionsByTaxonomy: Map<string, Set<string>>;
	translationGroupByTermId: Map<string, string | null>;
}

interface TaxonomyImportState {
	plan: TaxonomyImportPlan;
}

function makeState(): TaxonomyImportState {
	return {
		plan: {
			termsCreated: {},
			termsReused: {},
			missingTaxonomies: [],
			termIdByNameAndSlug: new Map(),
			collectionsByTaxonomy: new Map(),
			translationGroupByTermId: new Map(),
		},
	};
}

function bump(record: Record<string, number>, key: string): void {
	record[key] = (record[key] ?? 0) + 1;
}

function rememberTerm(
	state: TaxonomyImportState,
	taxonomyName: string,
	slug: string,
	termId: string,
): void {
	let bySlug = state.plan.termIdByNameAndSlug.get(taxonomyName);
	if (!bySlug) {
		bySlug = new Map();
		state.plan.termIdByNameAndSlug.set(taxonomyName, bySlug);
	}
	bySlug.set(slug, termId);
}

function parseDefCollections(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.filter((c): c is string => typeof c === "string");
		}
	} catch {}
	return [];
}

async function findTaxonomyDef(
	db: Kysely<Database>,
	name: string,
	locale: string | undefined,
): Promise<{ id: string; collections: string[] } | null> {
	const chain = resolveLocaleChain(locale);

	if (chain.length === 0) {
		const row = await db
			.selectFrom("_emdash_taxonomy_defs")
			.selectAll()
			.where("name", "=", name)
			.orderBy("locale", "asc")
			.executeTakeFirst();
		return row ? { id: row.id, collections: parseDefCollections(row.collections) } : null;
	}

	for (const tryLocale of chain) {
		const row = await db
			.selectFrom("_emdash_taxonomy_defs")
			.selectAll()
			.where("name", "=", name)
			.where("locale", "=", tryLocale)
			.executeTakeFirst();
		if (row) {
			return { id: row.id, collections: parseDefCollections(row.collections) };
		}
	}

	return null;
}

export async function loadTaxonomyPlanFromDb(db: Kysely<Database>): Promise<TaxonomyImportPlan> {
	const state = makeState();

	const defs = await db
		.selectFrom("_emdash_taxonomy_defs")
		.select(["name", "collections"])
		.orderBy("locale", "asc")
		.execute();
	for (const def of defs) {
		if (!state.plan.collectionsByTaxonomy.has(def.name)) {
			state.plan.collectionsByTaxonomy.set(def.name, new Set(parseDefCollections(def.collections)));
		}
	}

	const terms = await db
		.selectFrom("taxonomies")
		.select(["name", "slug", "id"])
		.orderBy("locale", "asc")
		.execute();
	for (const term of terms) {
		if (!state.plan.termIdByNameAndSlug.get(term.name)?.has(term.slug)) {
			rememberTerm(state, term.name, term.slug, term.id);
		}
	}

	return state.plan;
}

async function ensureTerm(
	repo: TaxonomyRepository,
	state: TaxonomyImportState,
	taxonomyName: string,
	slug: string,
	label: string,
	description: string | undefined,
	locale: string | undefined,
): Promise<string> {
	const cached = state.plan.termIdByNameAndSlug.get(taxonomyName)?.get(slug);
	if (cached) return cached;

	const existing = await repo.findBySlug(taxonomyName, slug, locale);
	if (existing) {
		bump(state.plan.termsReused, taxonomyName);
		rememberTerm(state, taxonomyName, slug, existing.id);
		return existing.id;
	}

	const anyLocale = await repo.findBySlug(taxonomyName, slug);
	const translationOf = anyLocale?.id;

	const created = await repo.create({
		name: taxonomyName,
		slug,
		label,
		data: description ? { description } : undefined,
		locale,
		translationOf,
	});
	bump(state.plan.termsCreated, taxonomyName);
	rememberTerm(state, taxonomyName, slug, created.id);
	return created.id;
}

function labelFor(post: WxrPost, taxonomy: string, slug: string): string {
	const key = `${taxonomy}\u0000${slug}`;
	return post.taxonomyLabels?.get(key) ?? slug;
}

export async function preImportWxrTaxonomies(
	db: Kysely<Database>,
	posts: WxrPost[],
	categories: WxrCategory[],
	tags: WxrTag[],
	terms: WxrTerm[],
	locale: string | undefined,
): Promise<TaxonomyImportPlan> {
	const state = makeState();
	const repo = new TaxonomyRepository(db);

	const defCache = new Map<string, { id: string; collections: string[] } | null>();
	const lookupDef = async (name: string): Promise<{ id: string; collections: string[] } | null> => {
		if (defCache.has(name)) return defCache.get(name) ?? null;
		const def = await findTaxonomyDef(db, name, locale);
		defCache.set(name, def);
		if (def) {
			state.plan.collectionsByTaxonomy.set(name, new Set(def.collections));
		}
		return def;
	};

	const categoryDef = await lookupDef("category");
	if (categoryDef) {
		for (const cat of categories) {
			const slug = cat.nicename;
			const label = cat.name;
			if (!slug || !label) continue;
			await ensureTerm(repo, state, "category", slug, label, cat.description, locale);
		}
	} else if (categories.length > 0) {
		state.plan.missingTaxonomies.push("category");
	}

	const tagDef = await lookupDef("tag");
	if (tagDef) {
		for (const tag of tags) {
			const slug = tag.slug;
			const label = tag.name;
			if (!slug || !label) continue;
			await ensureTerm(repo, state, "tag", slug, label, tag.description, locale);
		}
	} else if (tags.length > 0) {
		state.plan.missingTaxonomies.push("tag");
	}

	for (const term of terms) {
		if (term.taxonomy === "nav_menu" || term.taxonomy === "language") continue;
		const taxonomyName = term.taxonomy === "post_tag" ? "tag" : term.taxonomy;
		const def = await lookupDef(taxonomyName);
		if (!def) {
			if (!state.plan.missingTaxonomies.includes(taxonomyName)) {
				state.plan.missingTaxonomies.push(taxonomyName);
			}
			continue;
		}
		await ensureTerm(repo, state, taxonomyName, term.slug, term.name, term.description, locale);
	}

	let recordedMissingCategoryFromPosts = false;
	let recordedMissingTagFromPosts = false;
	for (const post of posts) {
		for (const slug of post.categories) {
			if (!categoryDef) {
				if (
					!recordedMissingCategoryFromPosts &&
					!state.plan.missingTaxonomies.includes("category")
				) {
					state.plan.missingTaxonomies.push("category");
					recordedMissingCategoryFromPosts = true;
				}
				break;
			}
			if (state.plan.termIdByNameAndSlug.get("category")?.has(slug)) continue;
			await ensureTerm(
				repo,
				state,
				"category",
				slug,
				labelFor(post, "category", slug),
				undefined,
				locale,
			);
		}
		for (const slug of post.tags) {
			if (!tagDef) {
				if (!recordedMissingTagFromPosts && !state.plan.missingTaxonomies.includes("tag")) {
					state.plan.missingTaxonomies.push("tag");
					recordedMissingTagFromPosts = true;
				}
				break;
			}
			if (state.plan.termIdByNameAndSlug.get("tag")?.has(slug)) continue;
			await ensureTerm(repo, state, "tag", slug, labelFor(post, "tag", slug), undefined, locale);
		}
		if (post.customTaxonomies) {
			for (const [rawName, slugs] of post.customTaxonomies) {
				if (rawName === "nav_menu" || rawName === "language") continue;
				const taxonomyName = rawName === "post_tag" ? "tag" : rawName;
				const def = await lookupDef(taxonomyName);
				if (!def) {
					if (!state.plan.missingTaxonomies.includes(taxonomyName)) {
						state.plan.missingTaxonomies.push(taxonomyName);
					}
					continue;
				}
				for (const slug of slugs) {
					if (state.plan.termIdByNameAndSlug.get(taxonomyName)?.has(slug)) continue;
					await ensureTerm(
						repo,
						state,
						taxonomyName,
						slug,
						labelFor(post, taxonomyName, slug),
						undefined,
						locale,
					);
				}
			}
		}
	}

	invalidateTermCache();

	return state.plan;
}

export function resolvePostTermAssignments(
	collection: string,
	post: WxrPost,
	plan: TaxonomyImportPlan,
): Map<string, string[]> {
	const result = new Map<string, string[]>();
	const seen = new Set<string>();

	const tryResolve = (taxonomyName: string, slug: string): void => {
		const termId = plan.termIdByNameAndSlug.get(taxonomyName)?.get(slug);
		if (!termId) return;
		const collectionFilter = plan.collectionsByTaxonomy.get(taxonomyName);
		if (collectionFilter && collectionFilter.size > 0 && !collectionFilter.has(collection)) {
			return;
		}
		const dedupeKey = `${taxonomyName}\u0000${termId}`;
		if (seen.has(dedupeKey)) return;
		seen.add(dedupeKey);
		const existing = result.get(taxonomyName);
		if (existing) existing.push(termId);
		else result.set(taxonomyName, [termId]);
	};

	for (const slug of post.categories) tryResolve("category", slug);
	for (const slug of post.tags) tryResolve("tag", slug);
	if (post.customTaxonomies) {
		for (const [rawName, slugs] of post.customTaxonomies) {
			if (rawName === "nav_menu" || rawName === "language") continue;
			const taxonomyName = rawName === "post_tag" ? "tag" : rawName;
			for (const slug of slugs) tryResolve(taxonomyName, slug);
		}
	}

	return result;
}

export async function attachPostTaxonomies(
	db: Kysely<Database>,
	collection: string,
	entryId: string,
	post: WxrPost,
	plan: TaxonomyImportPlan,
): Promise<number> {
	const repo = new TaxonomyRepository(db);
	const resolved = resolvePostTermAssignments(collection, post, plan);
	const groups = new Set<string>();
	for (const [, termIds] of resolved) {
		for (const termId of termIds) {
			const group = await termTranslationGroup(repo, plan, termId);
			if (group) groups.add(group);
		}
	}
	return repo.attachGroupsToEntry(collection, entryId, [...groups]);
}

export async function setPostTermAssignmentsReplacing(
	db: Kysely<Database>,
	collection: string,
	entryId: string,
	post: WxrPost,
	plan: TaxonomyImportPlan,
): Promise<number> {
	const repo = new TaxonomyRepository(db);
	const resolved = resolvePostTermAssignments(collection, post, plan);

	let attached = 0;
	for (const [taxonomyName, termIds] of resolved) {
		await repo.setTermsForEntry(collection, entryId, taxonomyName, termIds);
		attached += termIds.length;
	}
	return attached;
}

async function termTranslationGroup(
	repo: TaxonomyRepository,
	plan: TaxonomyImportPlan,
	termId: string,
): Promise<string | null> {
	const cached = plan.translationGroupByTermId.get(termId);
	if (cached !== undefined) return cached;
	const term = await repo.findById(termId);
	const group = term?.translationGroup ?? null;
	plan.translationGroupByTermId.set(termId, group);
	return group;
}

export async function mirrorTermsToLocales(
	db: Kysely<Database>,
	plan: TaxonomyImportPlan,
	postLocales: Iterable<string>,
	canonicalLocale: string | undefined,
): Promise<void> {
	const localeSet = new Set<string>();
	for (const locale of postLocales) {
		if (!locale || locale === canonicalLocale) continue;
		localeSet.add(locale);
	}
	if (localeSet.size === 0) return;

	const repo = new TaxonomyRepository(db);

	for (const [taxonomyName, bySlug] of plan.termIdByNameAndSlug) {
		for (const [slug, canonicalTermId] of bySlug) {
			const cachedGroup = await termTranslationGroup(repo, plan, canonicalTermId);
			if (!cachedGroup) {
				continue;
			}
			const canonicalGroup = cachedGroup;

			for (const locale of localeSet) {
				const existing = await repo.findBySlug(taxonomyName, slug, locale);
				if (existing) {
					if (existing.translationGroup !== canonicalGroup) {
						throw new WxrTaxonomyConflictError(
							`Cannot import: term "${taxonomyName}/${slug}" already exists at locale "${locale}" in a different translation group than the canonical row at this import's locale. Reconcile the rows in the admin (re-link via translationOf, or delete one) and retry.`,
						);
					}
					continue;
				}
				try {
					await repo.create({
						name: taxonomyName,
						slug,
						label: slug,
						locale,
						translationOf: canonicalTermId,
					});
				} catch (error) {
					const message = error instanceof Error ? error.message.toLowerCase() : "";
					const isUniqueRace =
						message.includes("unique constraint failed") || message.includes("duplicate key");
					if (!isUniqueRace) throw error;

					const winner = await repo.findBySlug(taxonomyName, slug, locale);
					if (!winner) {
						throw new WxrTaxonomyConflictError(
							`Cannot import: term "${taxonomyName}/${slug}" raced UNIQUE at locale "${locale}" but no row is visible afterwards. The concurrent transaction may have rolled back; retry the import.`,
							{ cause: error },
						);
					}
					if (winner.translationGroup !== canonicalGroup) {
						throw new WxrTaxonomyConflictError(
							`Cannot import: term "${taxonomyName}/${slug}" raced UNIQUE at locale "${locale}" with a different translation group. Reconcile the rows in the admin and retry.`,
							{ cause: error },
						);
					}
					console.warn(
						`[WXR import] concurrent writer beat us to term "${taxonomyName}/${slug}" at locale "${locale}"; using existing row (same group).`,
					);
				}
			}
		}
	}
}
