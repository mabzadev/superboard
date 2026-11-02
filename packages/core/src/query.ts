/// <reference types="astro/client" />

import { encodeCursor } from "./database/repositories/types.js";
import { getFallbackChain, getI18nConfig, isI18nEnabled } from "./i18n/config.js";
import {
	creditsFromFoldedBylines,
	CURSOR_RAW_VALUES,
	FOLDED_BYLINES,
	FOLDED_BYLINES_EXIST,
	FOLDED_TERMS,
	type WhereRange,
	type WhereValue,
} from "./loader.js";
import {
	cachedQuery,
	contentNamespaces,
	invalidateSchemaObjectCache,
} from "./object-cache/index.js";
import { requestCached } from "./request-cache.js";
import { getRequestContext } from "./request-context.js";
import { compileUrlPattern } from "./schema/url-pattern.js";
import type { TaxonomyTerm } from "./taxonomies/types.js";
import { isMissingTableError } from "./utils/db-errors.js";
import {
	createEditable,
	createNoop,
	type EditProxy,
	type EditableOptions,
} from "./visual-editing/editable.js";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EmDashCollections {}

export type InferCollectionData<T extends string> = T extends keyof EmDashCollections
	? EmDashCollections[T]
	: Record<string, unknown>;

export type SortDirection = "asc" | "desc";

export type OrderBySpec = Record<string, SortDirection>;

export type { WhereRange, WhereValue };

export interface CollectionFilterBase {
	status?: "draft" | "published" | "archived";
	limit?: number;
	where?: Record<string, WhereValue>;
	orderBy?: OrderBySpec;
	locale?: string;
}

export interface CursorCollectionFilter extends CollectionFilterBase {
	cursor?: string;
	offset?: never;
}

export interface OffsetCollectionFilter extends CollectionFilterBase {
	offset?: number;
	cursor?: never;
}

export type CollectionFilter = CursorCollectionFilter | OffsetCollectionFilter;

export interface ContentEntry<T = Record<string, unknown>> {
	id: string;
	data: T;
	edit: EditProxy;
}

export interface CacheHint {
	tags?: string[];
	lastModified?: Date;
}

export interface CollectionResult<T> {
	entries: ContentEntry<T>[];
	error?: Error;
	cacheHint: CacheHint;
	nextCursor?: string;
	hasMore?: boolean;
}

export interface EntryResult<T> {
	entry: ContentEntry<T> | null;
	error?: Error;
	isPreview: boolean;
	fallbackLocale?: string;
	cacheHint: CacheHint;
}

const COLLECTION_NAME = "_emdash";

const EMDASH_EDIT = Symbol.for("__emdash");

export interface EditFieldMeta {
	collection: string;
	id: string;
	field: string;
}

function isEditFieldMeta(value: unknown): value is EditFieldMeta {
	if (typeof value !== "object" || value === null) return false;
	if (!("collection" in value) || !("id" in value) || !("field" in value)) return false;
	const { collection, id, field } = value;
	return typeof collection === "string" && typeof id === "string" && typeof field === "string";
}

export function getEditMeta(value: unknown): EditFieldMeta | undefined {
	if (value && typeof value === "object") {
		const desc = Object.getOwnPropertyDescriptor(value, EMDASH_EDIT);
		const meta: unknown = desc?.value;
		if (isEditFieldMeta(meta)) {
			return meta;
		}
	}
	return undefined;
}

function tagEditableFields(data: Record<string, unknown>, collection: string, id: string): void {
	for (const [field, value] of Object.entries(data)) {
		if (
			Array.isArray(value) &&
			value.length > 0 &&
			value[0] &&
			typeof value[0] === "object" &&
			"_type" in value[0]
		) {
			Object.defineProperty(value, EMDASH_EDIT, {
				value: { collection, id, field } satisfies EditFieldMeta,
				enumerable: false,
				configurable: true,
			});
		}
	}
}

function dataStr(data: Record<string, unknown>, key: string, fallback = ""): string {
	const val = data[key];
	return typeof val === "string" ? val : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entryData(entry: { data?: unknown }): Record<string, unknown> {
	return isRecord(entry.data) ? entry.data : {};
}

function entryDatabaseId(entry: { id: string; data?: unknown }): string {
	const d = entryData(entry);
	return dataStr(d, "id") || entry.id;
}

function entryEditOptions(entry: { data?: unknown }): EditableOptions {
	const data = entryData(entry);
	const status = dataStr(data, "status", "draft");
	const draftRevisionId = dataStr(data, "draftRevisionId") || undefined;
	const liveRevisionId = dataStr(data, "liveRevisionId") || undefined;
	const hasDraft = !!draftRevisionId && draftRevisionId !== liveRevisionId;
	return { status, hasDraft };
}

function stripRevisionMetadata(entry: { data?: unknown }): void {
	const data = entryData(entry);
	delete data.draftRevisionId;
	delete data.liveRevisionId;
}

function canExposeRevisionMetadata(
	entry: { id: string; data?: unknown },
	collection: string,
): boolean {
	const ctx = getRequestContext();
	if (ctx?.editMode) return true;
	if (ctx?.preview?.collection !== collection) return false;
	const dbId = entryDatabaseId(entry);
	return ctx.preview.id === dbId || ctx.preview.id === entry.id;
}

export async function getEmDashCollection<T extends string, D = InferCollectionData<T>>(
	type: T,
	filter?: CollectionFilter,
): Promise<CollectionResult<D>> {
	const bucketed = bucketFilter(filter);
	const cached = await requestCached(collectionCacheKey(type, bucketed.fetchFilter), () =>
		loadCollectionCached<T, D>(type, bucketed.fetchFilter),
	);
	return bucketed.requestedLimit === undefined
		? cached
		: sliceCollectionResult(cached, bucketed.requestedLimit, filter?.orderBy);
}

interface CachedCollectionValue {
	entries: unknown[];
	nextCursor?: string;
	hasMore?: boolean;
	cacheHint: CacheHint;
}

async function loadCollectionCached<T extends string, D = InferCollectionData<T>>(
	type: T,
	filter?: CollectionFilter,
): Promise<CollectionResult<D>> {
	const snapshot = await cachedQuery<ContentSnapshot<CachedCollectionValue>>({
		namespace: contentNamespaces(type),
		key: `collection:${collectionCacheKey(type, filter)}|loc=${effectiveLocaleKey(filter)}`,
		load: async () => {
			const result = await getEmDashCollectionUncached<T, D>(type, filter);
			if (result.error) {
				return { ok: false, error: result.error, cacheHint: result.cacheHint };
			}
			return {
				ok: true,
				value: {
					entries: result.entries.map(entrySnapshot),
					nextCursor: result.nextCursor,
					hasMore: result.hasMore,
					cacheHint: result.cacheHint,
				},
			};
		},
		cacheable: (snap) => snap.ok,
	});

	if (!snapshot.ok) {
		return { entries: [], error: snapshot.error, cacheHint: snapshot.cacheHint };
	}
	return {
		entries: snapshot.value.entries.map((entry) => {
			const revived = reviveEntry<D>(entry);
			if (!canExposeRevisionMetadata(revived, type)) stripRevisionMetadata(revived);
			return revived;
		}),
		nextCursor: snapshot.value.nextCursor,
		hasMore: snapshot.value.hasMore,
		cacheHint: snapshot.value.cacheHint,
	};
}

const BUCKET_LIMIT_THRESHOLD = 10;

interface BucketedFilter {
	fetchFilter: CollectionFilter | undefined;
	requestedLimit: number | undefined;
}

export function bucketFilter(filter: CollectionFilter | undefined): BucketedFilter {
	const limit = filter?.limit;
	if (
		limit === undefined ||
		limit >= BUCKET_LIMIT_THRESHOLD ||
		limit <= 0 ||
		filter?.cursor !== undefined ||
		filter?.offset !== undefined
	) {
		return { fetchFilter: filter, requestedLimit: undefined };
	}
	return {
		fetchFilter: { ...filter, limit: BUCKET_LIMIT_THRESHOLD },
		requestedLimit: limit,
	};
}

export function sliceCollectionResult<D>(
	cached: CollectionResult<D>,
	limit: number,
	orderBy: OrderBySpec | undefined,
): CollectionResult<D> {
	if (cached.error) return cached;
	if (cached.entries.length <= limit) return cached;
	const sliced = cached.entries.slice(0, limit);
	const lastEntry = sliced.at(-1);
	const nextCursor = lastEntry ? encodeEntryCursor(lastEntry, orderBy) : undefined;
	return { ...cached, entries: sliced, nextCursor, hasMore: true };
}

const ENTRY_DATA_KEY_MAP: Record<string, string> = {
	created_at: "createdAt",
	updated_at: "updatedAt",
	published_at: "publishedAt",
	scheduled_at: "scheduledAt",
	author_id: "authorId",
	primary_byline_id: "primaryBylineId",
};

const FIELD_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function encodeEntryCursor<D>(
	entry: ContentEntry<D>,
	orderBy: OrderBySpec | undefined,
): string | undefined {
	const data = entryData(entry);
	const id = dataStr(data, "id");
	if (!id) return undefined;

	let dbField = "created_at";
	if (orderBy) {
		for (const field of Object.keys(orderBy)) {
			if (FIELD_NAME_PATTERN.test(field)) {
				dbField = field;
				break;
			}
		}
	}

	const rawDateValuesRaw = Reflect.get(data, CURSOR_RAW_VALUES);
	if (rawDateValuesRaw !== null && typeof rawDateValuesRaw === "object") {
		const raw = Reflect.get(rawDateValuesRaw, dbField);
		if (typeof raw === "string") return encodeCursor(raw, id);
	}

	const dataKey = ENTRY_DATA_KEY_MAP[dbField] ?? dbField;
	const value = data[dataKey];
	let orderValue: string;
	if (value instanceof Date) {
		orderValue = value.toISOString();
	} else if (typeof value === "string" || typeof value === "number") {
		orderValue = String(value);
	} else {
		orderValue = "";
	}
	return encodeCursor(orderValue, id);
}

function collectionCacheKey(type: string, filter?: CollectionFilter): string {
	if (!filter) return `collection:${type}:`;
	const parts = [
		filter.status ?? "",
		filter.limit ?? "",
		filter.cursor ?? "",
		filter.offset ?? "",
		filter.where ? stableStringify(filter.where) : "",
		filter.orderBy ? JSON.stringify(filter.orderBy) : "",
		filter.locale ?? "",
	];
	return `collection:${type}:${parts.join("|")}`;
}

function stableStringify(value: Record<string, unknown>): string {
	return JSON.stringify(stableOrder(value));
}

function stableOrder(value: Record<string, unknown>): Record<string, unknown> {
	const keys = Object.keys(value).toSorted();
	const ordered: Record<string, unknown> = {};
	for (const k of keys) {
		const v = value[k];
		if (isRecord(v)) {
			ordered[k] = stableOrder(v);
		} else {
			ordered[k] = v;
		}
	}
	return ordered;
}

const CURSOR_RAW_FIELD = "__emdashCursorRaw";

type ContentSnapshot<S> =
	| { ok: true; value: S }
	| { ok: false; error?: Error; cacheHint: CacheHint };

function entrySnapshot<D>(entry: ContentEntry<D>): Record<string, unknown> {
	const data = entryData(entry);
	const rawCursor = Reflect.get(data, CURSOR_RAW_VALUES);
	const { edit: _edit, ...rest } = entry as ContentEntry<D> & { edit?: unknown };
	return {
		...rest,
		data: { ...data, [CURSOR_RAW_FIELD]: rawCursor ?? {} },
	};
}

function reviveEntry<D>(raw: unknown): ContentEntry<D> {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- snapshot shape produced by entrySnapshot
	const entry = raw as Record<string, unknown>;
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- snapshot `data` is always a record
	const data: Record<string, unknown> = { ...(entry.data as Record<string, unknown>) };
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- snapshot field written by entrySnapshot
	const rawCursor = (data[CURSOR_RAW_FIELD] as Record<string, string> | undefined) ?? {};
	delete data[CURSOR_RAW_FIELD];
	Object.defineProperty(data, CURSOR_RAW_VALUES, {
		value: rawCursor,
		enumerable: false,
		configurable: false,
		writable: false,
	});
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- rebuilt to the ContentEntry shape with a no-op edit proxy
	return { ...entry, data, edit: createNoop() } as ContentEntry<D>;
}

function effectiveLocaleKey(filter?: { locale?: string }): string {
	const ctx = getRequestContext();
	const i18nConfig = getI18nConfig();
	return (
		filter?.locale ?? ctx?.locale ?? (isI18nEnabled() ? i18nConfig!.defaultLocale : undefined) ?? ""
	);
}

async function getEmDashCollectionUncached<T extends string, D = InferCollectionData<T>>(
	type: T,
	filter?: CollectionFilter,
): Promise<CollectionResult<D>> {
	const { getLiveCollection } = await import("astro:content");

	const ctx = getRequestContext();
	const i18nConfig = getI18nConfig();
	const resolvedLocale =
		filter?.locale ?? ctx?.locale ?? (isI18nEnabled() ? i18nConfig!.defaultLocale : undefined);

	const requestedLimit = filter?.limit;
	const pageParam =
		filter?.cursor !== undefined
			? { cursor: filter.cursor }
			: filter?.offset !== undefined
				? { offset: filter.offset }
				: {};
	const result = await getLiveCollection(COLLECTION_NAME, {
		type,
		status: filter?.status,
		limit: requestedLimit && requestedLimit > 0 ? requestedLimit + 1 : filter?.limit,
		...pageParam,
		where: filter?.where,
		orderBy: filter?.orderBy,
		locale: resolvedLocale,
	});

	const { entries, error, cacheHint } = result;

	if (error) {
		return { entries: [], error, cacheHint: {} };
	}

	const hasMore = requestedLimit != null && requestedLimit > 0 && entries.length > requestedLimit;
	const pageEntries = hasMore ? entries.slice(0, requestedLimit) : entries;
	const nextCursor = hasMore ? encodeEntryCursor(pageEntries.at(-1), filter?.orderBy) : undefined;
	const hasMoreResult = requestedLimit != null && requestedLimit > 0 ? hasMore : undefined;

	const isEditMode = ctx?.editMode ?? false;
	const entriesWithEdit = pageEntries.map((entry: ContentEntry<D>) => {
		const dbId = entryDatabaseId(entry);
		if (isEditMode) {
			tagEditableFields(entryData(entry), type, dbId);
		}
		if (!canExposeRevisionMetadata(entry, type)) {
			stripRevisionMetadata(entry);
		}
		return {
			...entry,
			edit: isEditMode ? createEditable(type, dbId, entryEditOptions(entry)) : createNoop(),
		};
	});

	await Promise.all([
		hydrateEntryBylines(type, entriesWithEdit),
		hydrateEntryTerms(type, entriesWithEdit, resolvedLocale),
	]);

	return {
		entries: entriesWithEdit,
		nextCursor,
		hasMore: hasMoreResult,
		cacheHint: cacheHint ?? {},
	};
}

export async function getEmDashEntry<T extends string, D = InferCollectionData<T>>(
	type: T,
	id: string,
	options?: { locale?: string },
): Promise<EntryResult<D>> {
	const { getLiveEntry } = await import("astro:content");

	const ctx = getRequestContext();
	const preview = ctx?.preview;
	const isEditMode = ctx?.editMode ?? false;
	const isPreviewMode = !!preview && preview.collection === type;
	const serveDrafts = isPreviewMode || isEditMode;

	const requestedLocale = options?.locale ?? ctx?.locale;

	function wrapEntry(raw: ContentEntry<D>): ContentEntry<D> {
		const dbId = entryDatabaseId(raw);
		if (isEditMode) {
			tagEditableFields(entryData(raw), type, dbId);
		}
		return {
			...raw,
			edit: isEditMode ? createEditable(type, dbId, entryEditOptions(raw)) : createNoop(),
		};
	}

	function isVisible(entry: ContentEntry<D>): boolean {
		return dataStr(entryData(entry), "status") === "published";
	}

	const localeChain =
		requestedLocale && isI18nEnabled() ? getFallbackChain(requestedLocale) : [requestedLocale];

	async function successResult(
		wrapped: ContentEntry<D>,
		opts: { isPreview: boolean; fallbackLocale?: string; cacheHint: CacheHint },
	): Promise<EntryResult<D>> {
		if (!opts.isPreview) stripRevisionMetadata(wrapped);
		const termLocale = isI18nEnabled()
			? dataStr(entryData(wrapped), "locale") || undefined
			: undefined;
		await Promise.all([
			hydrateEntryBylines(type, [wrapped]),
			hydrateEntryTerms(type, [wrapped], termLocale),
		]);
		return {
			entry: wrapped,
			isPreview: opts.isPreview,
			fallbackLocale: opts.fallbackLocale,
			cacheHint: opts.cacheHint,
		};
	}

	if (serveDrafts) {
		for (let i = 0; i < localeChain.length; i++) {
			const locale = localeChain[i];
			const fallbackLocale = i > 0 ? locale : undefined;

			const {
				entry: baseEntry,
				error: baseError,
				cacheHint,
			} = await getLiveEntry(COLLECTION_NAME, {
				type,
				id,
				locale,
			});

			if (baseError) {
				return { entry: null, error: baseError, isPreview: serveDrafts, cacheHint: {} };
			}

			if (!baseEntry) continue;

			if (isPreviewMode && !isEditMode) {
				const dbId = entryDatabaseId(baseEntry);
				if (preview.id !== dbId && preview.id !== id) {
					if (isVisible(baseEntry)) {
						return successResult(wrapEntry(baseEntry), {
							isPreview: false,
							fallbackLocale,
							cacheHint: cacheHint ?? {},
						});
					}
					continue;
				}
			}

			const baseData = entryData(baseEntry);
			const draftRevisionId = dataStr(baseData, "draftRevisionId") || undefined;

			if (draftRevisionId) {
				const { entry: draftEntry, error: draftError } = await getLiveEntry(COLLECTION_NAME, {
					type,
					id,
					revisionId: draftRevisionId,
					locale,
				});

				if (!draftError && draftEntry) {
					return successResult(wrapEntry(draftEntry), {
						isPreview: serveDrafts,
						fallbackLocale,
						cacheHint: cacheHint ?? {},
					});
				}
			}

			return successResult(wrapEntry(baseEntry), {
				isPreview: serveDrafts,
				fallbackLocale,
				cacheHint: cacheHint ?? {},
			});
		}

		return { entry: null, isPreview: serveDrafts, cacheHint: {} };
	}

	const resolveNormal = async (): Promise<EntryResult<D>> => {
		for (let i = 0; i < localeChain.length; i++) {
			const locale = localeChain[i];
			const fallbackLocale = i > 0 ? locale : undefined;

			const { entry, error, cacheHint } = await getLiveEntry(COLLECTION_NAME, { type, id, locale });
			if (error) {
				return { entry: null, error, isPreview: false, cacheHint: {} };
			}

			if (entry && isVisible(entry)) {
				return successResult(wrapEntry(entry), {
					isPreview: false,
					fallbackLocale,
					cacheHint: cacheHint ?? {},
				});
			}
		}
		return { entry: null, isPreview: false, cacheHint: {} };
	};

	const snapshot = await cachedQuery<ContentSnapshot<CachedEntryValue>>({
		namespace: contentNamespaces(type),
		key: `entry:${id}|loc=${requestedLocale ?? ""}`,
		load: async () => {
			const result = await resolveNormal();
			if (result.error) {
				return { ok: false, error: result.error, cacheHint: result.cacheHint };
			}
			return {
				ok: true,
				value: {
					entry: result.entry ? entrySnapshot(result.entry) : null,
					isPreview: result.isPreview,
					fallbackLocale: result.fallbackLocale,
					cacheHint: result.cacheHint,
				},
			};
		},
		cacheable: (snap) => snap.ok,
	});

	if (!snapshot.ok) {
		return { entry: null, error: snapshot.error, isPreview: false, cacheHint: snapshot.cacheHint };
	}
	const revived = snapshot.value.entry ? reviveEntry<D>(snapshot.value.entry) : null;
	if (revived && !canExposeRevisionMetadata(revived, type)) stripRevisionMetadata(revived);
	return {
		entry: revived,
		isPreview: snapshot.value.isPreview,
		fallbackLocale: snapshot.value.fallbackLocale,
		cacheHint: snapshot.value.cacheHint,
	};
}

interface CachedEntryValue {
	entry: Record<string, unknown> | null;
	isPreview: boolean;
	fallbackLocale?: string;
	cacheHint: CacheHint;
}

async function hydrateEntryBylines<D>(type: string, entries: ContentEntry<D>[]): Promise<void> {
	if (entries.length === 0) return;

	if (entries.every((e) => FOLDED_BYLINES in entryData(e))) {
		const parsed = entries.map((entry) => {
			const data = entryData(entry);
			const folded = Reflect.get(data, FOLDED_BYLINES);
			const rows = Array.isArray(folded) ? folded : [];
			const credits = creditsFromFoldedBylines(rows);
			return { data, credits };
		});

		const knownEmpty = entries.every(
			(e) => Reflect.get(entryData(e), FOLDED_BYLINES_EXIST) === false,
		);

		let needsQueryPath =
			!knownEmpty &&
			parsed.some(
				(p) =>
					p.credits.length === 0 &&
					(dataStr(p.data, "authorId") !== "" || dataStr(p.data, "primaryBylineId") !== ""),
			);
		let hasCustomFields = false;
		if (!needsQueryPath && !knownEmpty) {
			try {
				const { getDb } = await import("./loader.js");
				const db = await getDb();
				const { getBylineFieldDefs } = await import("./bylines/field-defs-cache.js");
				hasCustomFields = (await getBylineFieldDefs(db)).length > 0;
			} catch (error) {
				if (!isMissingTableError(error)) needsQueryPath = true;
			}
		}

		if (!needsQueryPath && !hasCustomFields) {
			for (const p of parsed) {
				p.data.bylines = p.credits;
				p.data.byline = p.credits[0]?.byline ?? null;
			}
			return;
		}
	}

	try {
		const { getBylinesForEntries } = await import("./bylines/index.js");

		const refs = entries
			.map((e) => {
				const data = entryData(e);
				const id = dataStr(data, "id");
				if (!id) return null;
				return {
					id,
					authorId: dataStr(data, "authorId") || null,
					primaryBylineId: dataStr(data, "primaryBylineId") || null,
					locale: dataStr(data, "locale") || null,
				};
			})
			.filter(
				(
					r,
				): r is {
					id: string;
					authorId: string | null;
					primaryBylineId: string | null;
					locale: string | null;
				} => r !== null,
			);
		if (refs.length === 0) return;

		const bylinesMap = await getBylinesForEntries(type, refs);

		for (const entry of entries) {
			const data = entryData(entry);
			const dbId = dataStr(data, "id");
			if (!dbId) continue;

			const credits = bylinesMap.get(dbId) ?? [];
			data.bylines = credits;
			data.byline = credits[0]?.byline ?? null;
		}
	} catch (err) {
		if (!isMissingTableError(err)) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("[emdash] Failed to hydrate bylines:", msg);
		}
	}
}

async function hydrateEntryTerms<D>(
	type: string,
	entries: ContentEntry<D>[],
	locale?: string,
): Promise<void> {
	if (entries.length === 0) return;

	if (entries.every((e) => FOLDED_TERMS in entryData(e))) {
		const perEntry: Array<{ entryId: string; byTaxonomy: Record<string, TaxonomyTerm[]> }> = [];
		for (const entry of entries) {
			const data = entryData(entry);
			const folded = Reflect.get(data, FOLDED_TERMS);
			const rows = Array.isArray(folded) ? folded : [];
			const grouped: Record<string, TaxonomyTerm[]> = {};
			for (const r of rows) {
				const name = String(r?.name);
				(grouped[name] ??= []).push({
					id: r?.id,
					name,
					slug: r?.slug,
					label: r?.label,
					parentId: r?.parent_id ?? undefined,
					children: [],
					locale: r?.locale,
					translationGroup: r?.translation_group,
				});
			}
			for (const [name, arr] of Object.entries(grouped)) {
				grouped[name] = arr.toSorted((a, b) => String(a.label).localeCompare(String(b.label)));
			}
			data.terms = grouped;
			const entryId = dataStr(data, "id");
			if (entryId) perEntry.push({ entryId, byTaxonomy: grouped });
		}
		const { primeFoldedEntryTerms } = await import("./taxonomies/index.js");
		primeFoldedEntryTerms(type, perEntry, { locale });
		return;
	}

	try {
		const { getAllTermsForEntries } = await import("./taxonomies/index.js");

		const ids = entries.map((e) => dataStr(entryData(e), "id")).filter(Boolean);
		if (ids.length === 0) return;

		const termsMap = await getAllTermsForEntries(type, ids, { locale });

		for (const entry of entries) {
			const data = entryData(entry);
			const dbId = dataStr(data, "id");
			if (!dbId) continue;

			data.terms = termsMap.get(dbId) ?? {};
		}
	} catch (err) {
		if (!isMissingTableError(err)) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn("[emdash] Failed to hydrate terms:", msg);
		}
	}
}

export interface TranslationSummary {
	id: string;
	locale: string;
	slug: string | null;
	status: string;
}

export interface TranslationsResult {
	translationGroup: string;
	translations: TranslationSummary[];
	error?: Error;
}

export async function getTranslations(type: string, id: string): Promise<TranslationsResult> {
	try {
		const db = (await import("./loader.js")).getDb;
		const dbInstance = await db();
		const { ContentRepository } = await import("./database/repositories/content.js");
		const repo = new ContentRepository(dbInstance);

		const item = await repo.findByIdOrSlug(type, id);
		if (!item) {
			return {
				translationGroup: "",
				translations: [],
				error: new Error(`Content item not found: ${id}`),
			};
		}

		const group = item.translationGroup || item.id;
		const translations = await repo.findTranslations(type, group);

		return {
			translationGroup: group,
			translations: translations.map((t) => ({
				id: t.id,
				locale: t.locale || "en",
				slug: t.slug,
				status: t.status,
			})),
		};
	} catch (error) {
		return {
			translationGroup: "",
			translations: [],
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}
}

export interface ResolvePathResult<T = Record<string, unknown>> {
	entry: ContentEntry<T>;
	collection: string;
	params: Record<string, string>;
}

interface CachedPattern {
	slug: string;
	regex: RegExp;
	paramNames: string[];
}

interface UrlPatternCache {
	patterns: CachedPattern[] | null;
}

const URL_PATTERN_CACHE_KEY = Symbol.for("emdash:url-pattern-cache");
const queryGlobal = globalThis as Record<symbol, unknown>;
const urlPatternCache: UrlPatternCache =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(queryGlobal[URL_PATTERN_CACHE_KEY] as UrlPatternCache | undefined) ??
	(() => {
		const cache: UrlPatternCache = { patterns: null };
		queryGlobal[URL_PATTERN_CACHE_KEY] = cache;
		return cache;
	})();

export function invalidateUrlPatternCache(): void {
	urlPatternCache.patterns = null;
	invalidateSchemaObjectCache();
}

export async function resolveEmDashPath<T = Record<string, unknown>>(
	path: string,
): Promise<ResolvePathResult<T> | null> {
	let cachedUrlPatterns = urlPatternCache.patterns;
	if (!cachedUrlPatterns) {
		const { getDb } = await import("./loader.js");
		const { SchemaRegistry } = await import("./schema/registry.js");
		const db = await getDb();
		const registry = new SchemaRegistry(db);
		const collections = await registry.listCollections();

		cachedUrlPatterns = [];
		for (const collection of collections) {
			if (!collection.urlPattern) continue;
			const { regex, paramNames } = compileUrlPattern(collection.urlPattern);
			cachedUrlPatterns.push({ slug: collection.slug, regex, paramNames });
		}
		urlPatternCache.patterns = cachedUrlPatterns;
	}

	for (const pattern of cachedUrlPatterns) {
		const match = path.match(pattern.regex);
		if (!match) continue;

		const params: Record<string, string> = {};
		for (let i = 0; i < pattern.paramNames.length; i++) {
			params[pattern.paramNames[i]] = match[i + 1];
		}

		const slug = params.slug;
		if (!slug) continue;

		const { entry } = await getEmDashEntry<string, T>(pattern.slug, slug);
		if (entry) {
			return { entry, collection: pattern.slug, params };
		}
	}

	return null;
}
