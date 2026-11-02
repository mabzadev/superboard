import { sql, type Kysely } from "kysely";

import type { Database } from "../database/types.js";
import { validateIdentifier } from "../database/validate.js";
import { getI18nConfig } from "../i18n/config.js";
import { resolveLocale, resolveLocaleChain } from "../i18n/resolve.js";
import { getDb, resetTaxonomyNamesCache } from "../loader.js";
import {
	cachedQuery,
	CacheNamespace,
	contentCacheNamespaces,
	invalidateTaxonomyObjectCache,
	isObjectCacheActive,
} from "../object-cache/index.js";
import { peekRequestCache, requestCached, setRequestCacheEntry } from "../request-cache.js";
import { getRequestContext } from "../request-context.js";
import { chunks, SQL_BATCH_SIZE } from "../utils/chunks.js";
import { isMissingTableError } from "../utils/db-errors.js";
import { fetchVisibleTermCounts } from "./term-counts.js";
import type { TaxonomyDef, TaxonomyTerm, TaxonomyTermRow } from "./types.js";

export interface TaxonomyQueryOptions {
	locale?: string;
}

export interface TaxonomyTermsOptions extends TaxonomyQueryOptions {
	includeCounts?: boolean;
}

interface EntryTermRow {
	entry_id: string;
	id: string;
	name: string;
	slug: string;
	label: string;
	parent_id: string | null;
	locale: string;
	translation_group: string | null;
}

async function selectEntryTermRows(
	db: Kysely<Database>,
	collection: string,
	entryIds: string[],
	taxonomyName?: string,
	locale?: string,
): Promise<EntryTermRow[]> {
	validateIdentifier(collection, "collection slug");
	const tableName = `ec_${collection}`;
	const preferredLocale = locale ? sql`${locale}` : sql`content.locale`;
	const defaultLocale = getI18nConfig()?.defaultLocale ?? "en";
	const result = await sql<EntryTermRow>`
		SELECT content.id AS entry_id,
			coalesce(exact_term.id, default_term.id) AS id,
			coalesce(exact_term.name, default_term.name) AS name,
			coalesce(exact_term.slug, default_term.slug) AS slug,
			coalesce(exact_term.label, default_term.label) AS label,
			coalesce(exact_term.parent_id, default_term.parent_id) AS parent_id,
			coalesce(exact_term.locale, default_term.locale) AS locale,
			coalesce(exact_term.translation_group, default_term.translation_group) AS translation_group
		FROM ${sql.ref(tableName)} AS content
		INNER JOIN content_taxonomies AS pivot
			ON pivot.entry_id = content.translation_group
			AND pivot.collection = ${collection}
		LEFT JOIN taxonomies AS exact_term
			ON exact_term.translation_group = pivot.taxonomy_id
			AND exact_term.locale = ${preferredLocale}
		LEFT JOIN taxonomies AS default_term
			ON default_term.translation_group = pivot.taxonomy_id
			AND default_term.locale = ${defaultLocale}
		WHERE content.id IN (${sql.join(entryIds.map((id) => sql`${id}`))})
			AND coalesce(exact_term.id, default_term.id) IS NOT NULL
			${taxonomyName ? sql`AND coalesce(exact_term.name, default_term.name) = ${taxonomyName}` : sql``}
		ORDER BY coalesce(exact_term.label, default_term.label) ASC
	`.execute(db);
	return result.rows;
}

export function invalidateTermCache(): void {
	invalidateTaxonomyObjectCache();
}

interface TaxonomyDefsHolder {
	version: number;
	cache: Map<string, { version: number; promise: Promise<TaxonomyDef[]> }>;
}

const TAXONOMY_DEFS_CACHE_KEY = Symbol.for("emdash:taxonomy-defs");
const taxonomyDefsStore = globalThis as Record<symbol, unknown>;
const defsHolder: TaxonomyDefsHolder =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see settings/index.ts)
	(taxonomyDefsStore[TAXONOMY_DEFS_CACHE_KEY] as TaxonomyDefsHolder | undefined) ??
	(() => {
		const h: TaxonomyDefsHolder = { version: 0, cache: new Map() };
		taxonomyDefsStore[TAXONOMY_DEFS_CACHE_KEY] = h;
		return h;
	})();

export function invalidateTaxonomyDefsCache(): void {
	defsHolder.version++;
	defsHolder.cache.clear();
	resetTaxonomyNamesCache();
	invalidateTaxonomyObjectCache();
}

export function resetTaxonomyDefsCacheForTests(): void {
	defsHolder.version++;
	defsHolder.cache.clear();
}

async function fetchTaxonomyDefs(locale: string | undefined): Promise<TaxonomyDef[]> {
	const db = await getDb();
	let query = db.selectFrom("_emdash_taxonomy_defs").selectAll();
	if (locale !== undefined) query = query.where("locale", "=", locale);
	const rows = await query.execute();
	return rows.map(rowToTaxonomyDef);
}

function loadTaxonomyDefs(localeKey: string, locale: string | undefined): Promise<TaxonomyDef[]> {
	if (getRequestContext()?.dbIsIsolated === true) {
		return fetchTaxonomyDefs(locale);
	}
	const existing = defsHolder.cache.get(localeKey);
	if (existing && existing.version === defsHolder.version) {
		return existing.promise;
	}
	const version = defsHolder.version;
	const promise = fetchTaxonomyDefs(locale).catch((error: unknown) => {
		const current = defsHolder.cache.get(localeKey);
		if (current && current.promise === promise) {
			defsHolder.cache.delete(localeKey);
		}
		throw error;
	});
	defsHolder.cache.set(localeKey, { version, promise });
	return promise;
}

export async function getTaxonomyDefs(options: TaxonomyQueryOptions = {}): Promise<TaxonomyDef[]> {
	const locale = resolveLocale(options.locale);
	const localeKey = locale ?? "*";
	return requestCached(`taxonomy-defs:${localeKey}`, async () => {
		if (await isObjectCacheActive()) {
			return cachedQuery({
				namespace: CacheNamespace.TAXONOMIES,
				key: `defs:${localeKey}`,
				load: () => fetchTaxonomyDefs(locale),
			});
		}
		return loadTaxonomyDefs(localeKey, locale);
	});
}

export async function getTaxonomyDef(
	name: string,
	options: TaxonomyQueryOptions = {},
): Promise<TaxonomyDef | null> {
	const chain = resolveLocaleChain(options.locale);
	const peekKey = `taxonomy-defs:${resolveLocale(options.locale) ?? "*"}`;
	const allDefs = peekRequestCache<TaxonomyDef[]>(peekKey);
	if (allDefs) {
		const defs = await allDefs;
		if (chain.length === 0) return defs.find((d) => d.name === name) ?? null;
		for (const locale of chain) {
			const found = defs.find((d) => d.name === name && d.locale === locale);
			if (found) return found;
		}
		return null;
	}

	return requestCached(`taxonomy-def:${name}:${chain.join(",")}`, async () => {
		const db = await getDb();

		if (chain.length === 0) {
			const row = await db
				.selectFrom("_emdash_taxonomy_defs")
				.selectAll()
				.where("name", "=", name)
				.orderBy("locale", "asc")
				.executeTakeFirst();
			return row ? rowToTaxonomyDef(row) : null;
		}

		for (const locale of chain) {
			const row = await db
				.selectFrom("_emdash_taxonomy_defs")
				.selectAll()
				.where("name", "=", name)
				.where("locale", "=", locale)
				.executeTakeFirst();
			if (row) return rowToTaxonomyDef(row);
		}
		return null;
	});
}

function termCountNamespaces(collections: string[]): string[] {
	return [
		...[...new Set(collections)].flatMap((collection) => contentCacheNamespaces(collection)),
		CacheNamespace.TAXONOMIES,
	];
}

export async function getTaxonomyTerms(
	taxonomyName: string,
	options: TaxonomyTermsOptions = {},
): Promise<TaxonomyTerm[]> {
	const locale = resolveLocale(options.locale);
	const def = await getTaxonomyDef(taxonomyName, options);
	if (!def) return [];
	if (options.includeCounts === false) return getTermList(def, locale);

	const [terms, counts] = await Promise.all([
		getTermList(def, locale),
		getVisibleTermCounts(def.name, def.collections, locale),
	]);
	return withCounts(terms, counts);
}

function getTermList(def: TaxonomyDef, locale: string | undefined): Promise<TaxonomyTerm[]> {
	const localeKey = locale ?? "*";
	return requestCached(`taxonomy-terms:${def.name}:${localeKey}`, () =>
		cachedQuery({
			namespace: CacheNamespace.TAXONOMIES,
			key: `termList:${def.name}:${localeKey}`,
			load: () => loadTaxonomyTerms(def, locale),
		}),
	);
}

function withCounts(terms: TaxonomyTerm[], counts: Map<string, number>): TaxonomyTerm[] {
	return terms.map((term) => ({
		...term,
		count: counts.get(term.translationGroup ?? term.id) ?? 0,
		children: withCounts(term.children, counts),
	}));
}

async function loadTaxonomyTerms(
	def: TaxonomyDef,
	locale: string | undefined,
): Promise<TaxonomyTerm[]> {
	const db = await getDb();

	let termsQuery = db
		.selectFrom("taxonomies")
		.selectAll()
		.where("name", "=", def.name)
		.orderBy("sort_order", "asc")
		.orderBy("label", "asc");
	if (locale !== undefined) termsQuery = termsQuery.where("locale", "=", locale);

	const rows = await termsQuery.execute();

	const flatTerms: TaxonomyTermRow[] = rows.map((row) => ({
		id: row.id,
		name: row.name,
		slug: row.slug,
		label: row.label,
		parent_id: row.parent_id,
		data: row.data,
		locale: row.locale,
		translation_group: row.translation_group,
	}));

	if (def.hierarchical) return buildTree(flatTerms);

	return flatTerms.map((term) => ({
		id: term.id,
		name: term.name,
		slug: term.slug,
		label: term.label,
		description: term.data ? JSON.parse(term.data).description : undefined,
		children: [],
		locale: term.locale,
		translationGroup: term.translation_group,
	}));
}

function getVisibleTermCounts(
	taxonomyName: string,
	collections: string[],
	locale?: string,
): Promise<Map<string, number>> {
	const scope = [...new Set(collections)].toSorted().join(",");
	const localeScope = locale ?? "*";
	return requestCached(`taxonomy-term-counts:${taxonomyName}:${scope}:${localeScope}`, async () => {
		const entries = await cachedQuery({
			namespace: termCountNamespaces(collections),
			key: `termCounts:${taxonomyName}:${scope}:${localeScope}`,
			load: async (): Promise<Array<[string, number]>> => {
				const db = await getDb();
				return [...(await fetchVisibleTermCounts(db, taxonomyName, collections, locale))];
			},
		});
		return new Map(entries);
	});
}

export async function getTerm(
	taxonomyName: string,
	slug: string,
	options: TaxonomyQueryOptions = {},
): Promise<TaxonomyTerm | null> {
	const chain = resolveLocaleChain(options.locale);
	const def = await getTaxonomyDef(taxonomyName, options);
	const collections = def?.collections ?? [];
	return cachedQuery({
		namespace: termCountNamespaces(collections),
		key: `term:${taxonomyName}:${slug}:${chain.join(",")}`,
		load: () => loadTerm(taxonomyName, slug, chain, collections),
	});
}

async function loadTerm(
	taxonomyName: string,
	slug: string,
	chain: string[],
	collections: string[],
): Promise<TaxonomyTerm | null> {
	const db = await getDb();

	let row: Awaited<ReturnType<ReturnType<typeof selectTerm>["executeTakeFirst"]>>;
	const selectTerm = () =>
		db
			.selectFrom("taxonomies")
			.selectAll()
			.where("name", "=", taxonomyName)
			.where("slug", "=", slug);

	if (chain.length === 0) {
		row = await selectTerm().orderBy("locale", "asc").executeTakeFirst();
	} else {
		row = undefined;
		for (const locale of chain) {
			row = await selectTerm().where("locale", "=", locale).executeTakeFirst();
			if (row) break;
		}
	}

	if (!row) return null;

	let childrenQuery = db
		.selectFrom("taxonomies")
		.selectAll()
		.where("parent_id", "=", row.translation_group ?? row.id)
		.orderBy("sort_order", "asc")
		.orderBy("label", "asc");
	const termLocale = row.locale;
	if (termLocale) childrenQuery = childrenQuery.where("locale", "=", termLocale);

	const [counts, childRows] = await Promise.all([
		getVisibleTermCounts(taxonomyName, collections, chain[0] ?? row.locale),
		childrenQuery.execute(),
	]);
	const count = counts.get(row.translation_group ?? row.id) ?? 0;

	const children = childRows.map<TaxonomyTerm>((child) => ({
		id: child.id,
		name: child.name,
		slug: child.slug,
		label: child.label,
		parentId: child.parent_id ?? undefined,
		children: [],
		locale: child.locale,
		translationGroup: child.translation_group,
	}));

	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		label: row.label,
		parentId: row.parent_id ?? undefined,
		description: row.data ? JSON.parse(row.data).description : undefined,
		children,
		count,
		locale: row.locale,
		translationGroup: row.translation_group,
	};
}

export function getEntryTerms(
	collection: string,
	entryId: string,
	taxonomyName?: string,
	options: TaxonomyQueryOptions = {},
): Promise<TaxonomyTerm[]> {
	const locale = resolveLocale(options.locale);
	return requestCached(
		`terms:${collection}:${entryId}:${taxonomyName ?? "*"}:${locale ?? "*"}`,
		() =>
			cachedQuery({
				namespace: [...contentCacheNamespaces(collection), CacheNamespace.TAXONOMIES],
				key: `entryTerms:${collection}:${entryId}:${taxonomyName ?? "*"}:${locale ?? "*"}`,
				load: async () => {
					const db = await getDb();
					const rows = await selectEntryTermRows(db, collection, [entryId], taxonomyName, locale);
					return rows.map<TaxonomyTerm>((row) => ({
						id: row.id,
						name: row.name,
						slug: row.slug,
						label: row.label,
						parentId: row.parent_id ?? undefined,
						children: [],
						locale: row.locale,
						translationGroup: row.translation_group,
					}));
				},
			}),
	);
}

export async function getTermsForEntries(
	collection: string,
	entryIds: string[],
	taxonomyName: string,
	options: TaxonomyQueryOptions = {},
): Promise<Map<string, TaxonomyTerm[]>> {
	const uniqueIds = [...new Set(entryIds)];
	if (uniqueIds.length === 0) return new Map();
	const locale = resolveLocale(options.locale);
	const localeKey = locale ?? "*";

	const load = async (): Promise<Array<[string, TaxonomyTerm[]]>> => {
		const result = new Map<string, TaxonomyTerm[]>();
		for (const id of uniqueIds) result.set(id, []);

		const missedIds: string[] = [];
		type CacheRead = { id: string; terms: TaxonomyTerm[] } | { id: string; miss: true };
		const cacheReads: Array<Promise<CacheRead>> = [];
		for (const id of uniqueIds) {
			const cached = peekRequestCache<TaxonomyTerm[]>(
				`terms:${collection}:${id}:${taxonomyName}:${localeKey}`,
			);
			if (cached) {
				cacheReads.push(
					cached.then(
						(terms): CacheRead => ({ id, terms }),
						(): CacheRead => ({ id, miss: true }),
					),
				);
			} else {
				missedIds.push(id);
			}
		}
		for (const read of await Promise.all(cacheReads)) {
			if ("miss" in read) {
				missedIds.push(read.id);
				continue;
			}
			result.set(
				read.id,
				read.terms.map((t) => ({ ...t, children: [...t.children] })),
			);
		}

		if (missedIds.length === 0) return [...result.entries()];

		const db = await getDb();
		for (const chunk of chunks(missedIds, SQL_BATCH_SIZE)) {
			let rows;
			try {
				rows = await selectEntryTermRows(db, collection, chunk, taxonomyName, locale);
			} catch (error) {
				if (isMissingTableError(error)) return [...result.entries()];
				throw error;
			}

			for (const row of rows) {
				const term: TaxonomyTerm = {
					id: row.id,
					name: row.name,
					slug: row.slug,
					label: row.label,
					parentId: row.parent_id ?? undefined,
					children: [],
					locale: row.locale,
					translationGroup: row.translation_group,
				};
				const terms = result.get(row.entry_id);
				if (terms) terms.push(term);
			}
		}

		return [...result.entries()];
	};

	const idKey = uniqueIds.toSorted().join(",");
	const pairs =
		idKey.length <= 256
			? await cachedQuery({
					namespace: [...contentCacheNamespaces(collection), CacheNamespace.TAXONOMIES],
					key: `termsForEntries:${collection}:${taxonomyName}:${locale ?? "*"}:${idKey}`,
					load,
				})
			: await load();

	return new Map(pairs);
}

export async function getAllTermsForEntries(
	collection: string,
	entryIds: string[],
	options: TaxonomyQueryOptions = {},
): Promise<Map<string, Record<string, TaxonomyTerm[]>>> {
	const result = new Map<string, Record<string, TaxonomyTerm[]>>();
	const uniqueIds = [...new Set(entryIds)];
	for (const id of uniqueIds) result.set(id, {});
	if (uniqueIds.length === 0) return result;

	const db = await getDb();
	const locale = resolveLocale(options.locale);
	const applicableTaxonomyNames = await getCollectionTaxonomyNames(collection, { locale });

	for (const chunk of chunks(uniqueIds, SQL_BATCH_SIZE)) {
		let rows;
		try {
			rows = await selectEntryTermRows(db, collection, chunk, undefined, locale);
		} catch (error) {
			if (isMissingTableError(error)) {
				for (const id of uniqueIds) {
					primeEntryTermsCache(collection, id, {}, applicableTaxonomyNames, locale);
				}
				return result;
			}
			throw error;
		}

		for (const row of rows) {
			const term: TaxonomyTerm = {
				id: row.id,
				name: row.name,
				slug: row.slug,
				label: row.label,
				parentId: row.parent_id ?? undefined,
				children: [],
				locale: row.locale,
				translationGroup: row.translation_group,
			};
			const byTaxonomy = result.get(row.entry_id);
			if (!byTaxonomy) continue;
			const existing = byTaxonomy[row.name];
			if (existing) existing.push(term);
			else byTaxonomy[row.name] = [term];
		}
	}

	for (const [entryId, byTaxonomy] of result) {
		primeEntryTermsCache(collection, entryId, byTaxonomy, applicableTaxonomyNames, locale);
	}

	return result;
}

async function getCollectionTaxonomyNames(
	collection: string,
	options: TaxonomyQueryOptions,
): Promise<string[]> {
	try {
		const defs = await getTaxonomyDefs(options);
		return defs.filter((d) => d.collections.includes(collection)).map((d) => d.name);
	} catch (error) {
		if (isMissingTableError(error)) return [];
		throw error;
	}
}

function primeEntryTermsCache(
	collection: string,
	entryId: string,
	byTaxonomy: Record<string, TaxonomyTerm[]>,
	applicableTaxonomyNames: string[],
	locale: string | undefined,
): void {
	const localeKey = locale ?? "*";
	for (const name of applicableTaxonomyNames) {
		setRequestCacheEntry(
			`terms:${collection}:${entryId}:${name}:${localeKey}`,
			byTaxonomy[name] ?? [],
		);
	}
	for (const [name, terms] of Object.entries(byTaxonomy)) {
		setRequestCacheEntry(`terms:${collection}:${entryId}:${name}:${localeKey}`, terms);
	}
	const allTerms = Object.values(byTaxonomy).flat();
	setRequestCacheEntry(`terms:${collection}:${entryId}:*:${localeKey}`, allTerms);
}

export function primeFoldedEntryTerms(
	collection: string,
	perEntry: Array<{ entryId: string; byTaxonomy: Record<string, TaxonomyTerm[]> }>,
	options: TaxonomyQueryOptions = {},
): void {
	if (perEntry.length === 0) return;
	const locale = resolveLocale(options.locale);
	for (const { entryId, byTaxonomy } of perEntry) {
		primeEntryTermsCache(collection, entryId, byTaxonomy, [], locale);
	}
}

export async function getEntriesByTerm(
	collection: string,
	taxonomyName: string,
	termSlug: string,
	options: TaxonomyQueryOptions = {},
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
	const { getEmDashCollection } = await import("../query.js");

	const queryOptions: Record<string, unknown> = {
		where: { [taxonomyName]: termSlug },
	};
	if (options.locale !== undefined) queryOptions.locale = options.locale;
	const { entries } = await getEmDashCollection(collection, queryOptions);
	return entries;
}

function rowToTaxonomyDef(row: {
	id: string;
	name: string;
	label: string;
	label_singular: string | null;
	hierarchical: number;
	collections: string | null;
	locale: string;
	translation_group: string | null;
}): TaxonomyDef {
	return {
		id: row.id,
		name: row.name,
		label: row.label,
		labelSingular: row.label_singular ?? undefined,
		hierarchical: row.hierarchical === 1,
		collections: row.collections ? JSON.parse(row.collections) : [],
		locale: row.locale,
		translationGroup: row.translation_group,
	};
}

function buildTree(flatTerms: TaxonomyTermRow[]): TaxonomyTerm[] {
	const byLocaleGroup = new Map<string, TaxonomyTerm>();
	const nodes: TaxonomyTerm[] = [];
	const roots: TaxonomyTerm[] = [];

	for (const term of flatTerms) {
		const node: TaxonomyTerm = {
			id: term.id,
			name: term.name,
			slug: term.slug,
			label: term.label,
			parentId: term.parent_id ?? undefined,
			description: term.data ? JSON.parse(term.data).description : undefined,
			children: [],
			locale: term.locale,
			translationGroup: term.translation_group,
		};
		byLocaleGroup.set(`${term.locale}::${term.translation_group ?? term.id}`, node);
		nodes.push(node);
	}

	for (const node of nodes) {
		const parent = node.parentId
			? byLocaleGroup.get(`${node.locale}::${node.parentId}`)
			: undefined;
		if (parent) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	return roots;
}
