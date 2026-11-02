import type { LiveLoader } from "astro/loaders";
import { Kysely, type RawBuilder, sql, type Dialect } from "kysely";

import { buildStatusCondition, isPostgres } from "./database/dialect-helpers.js";
import { kyselyLogOption } from "./database/instrumentation.js";
import { decodeCursor, encodeCursor } from "./database/repositories/types.js";
import { validateIdentifier } from "./database/validate.js";
import { getI18nConfig } from "./i18n/config.js";
import type { Database } from "./index.js";
import { getRequestContext } from "./request-context.js";
import { isMissingColumnError, isMissingTableError } from "./utils/db-errors.js";

const FIELD_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const SEO_COLUMN_ALIASES: Record<string, string> = {
	seo_title: "_emdash_seo_title",
	seo_description: "_emdash_seo_description",
	seo_image: "_emdash_seo_image",
	seo_canonical: "_emdash_seo_canonical",
	seo_no_index: "_emdash_seo_no_index",
};

const SEO_ALIAS_COLUMNS = Object.values(SEO_COLUMN_ALIASES);

const SEO_FOLDED_COLUMN = "_emdash_seo";

const SYSTEM_COLUMNS = new Set([
	"id",
	"status",
	"author_id",
	"primary_byline_id",
	"created_at",
	"updated_at",
	"published_at",
	"scheduled_at",
	"deleted_at",
	"version",
	"live_revision_id",
	"draft_revision_id",
	"locale",
	"translation_group",
	...SEO_ALIAS_COLUMNS,
	"_emdash_terms",
	"_emdash_bylines",
	"_emdash_bylines_exist",
	SEO_FOLDED_COLUMN,
]);

export const FOLDED_TERMS = Symbol.for("emdash:foldedTerms");
export const FOLDED_BYLINES = Symbol.for("emdash:foldedBylines");
export const FOLDED_BYLINES_EXIST = Symbol.for("emdash:foldedBylinesExist");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Kysely instance
function foldedHydrationSelects(db: Kysely<any>, type: string, outer: string) {
	const o = sql.ref(outer);
	const pg = isPostgres(db);
	const obj = (pairs: string) =>
		pg ? sql.raw(`json_build_object(${pairs})`) : sql.raw(`json_object(${pairs})`);
	const agg = (inner: RawBuilder<unknown>) =>
		pg ? sql`coalesce(json_agg(${inner}), '[]'::json)` : sql`json_group_array(${inner})`;

	const foldJoin = pg ? sql`JOIN` : sql`CROSS JOIN`;

	const termObj = obj(
		"'id', coalesce(exact_term.id, default_term.id), 'name', coalesce(exact_term.name, default_term.name), 'slug', coalesce(exact_term.slug, default_term.slug), 'label', coalesce(exact_term.label, default_term.label), 'parent_id', coalesce(exact_term.parent_id, default_term.parent_id), 'locale', coalesce(exact_term.locale, default_term.locale), 'translation_group', coalesce(exact_term.translation_group, default_term.translation_group)",
	);
	const defaultLocale = getI18nConfig()?.defaultLocale ?? "en";
	const selectedTermId = sql`coalesce(exact_term.id, default_term.id)`;
	const termAgg = pg
		? sql`coalesce(json_agg(${termObj}) FILTER (WHERE ${selectedTermId} IS NOT NULL), '[]'::json)`
		: sql`json_group_array(${termObj}) FILTER (WHERE ${selectedTermId} IS NOT NULL)`;
	const terms = sql`(SELECT ${termAgg} FROM ${sql.ref("content_taxonomies")} AS ct LEFT JOIN ${sql.ref("taxonomies")} AS exact_term ON exact_term.translation_group = ct.taxonomy_id AND exact_term.locale = ${o}.locale LEFT JOIN ${sql.ref("taxonomies")} AS default_term ON default_term.translation_group = ct.taxonomy_id AND default_term.locale = ${defaultLocale} WHERE ct.collection = ${type} AND ct.entry_id = ${o}.translation_group) AS ${sql.ref("_emdash_terms")}`;

	const bylineInner = obj(
		"'id', b.id, 'slug', b.slug, 'displayName', b.display_name, 'bio', b.bio, 'avatarMediaId', b.avatar_media_id, 'avatarStorageKey', m.storage_key, 'avatarAlt', m.alt, 'avatarBlurhash', m.blurhash, 'avatarDominantColor', m.dominant_color, 'websiteUrl', b.website_url, 'userId', b.user_id, 'isGuest', b.is_guest, 'createdAt', b.created_at, 'updatedAt', b.updated_at, 'locale', b.locale, 'translationGroup', b.translation_group",
	);
	const creditObj = pg
		? sql.raw(
				"json_build_object('roleLabel', cb.role_label, 'sortOrder', cb.sort_order, 'byline', ",
			)
		: sql.raw("json_object('roleLabel', cb.role_label, 'sortOrder', cb.sort_order, 'byline', ");
	const credit = sql`${creditObj}${bylineInner})`;
	const bylines = sql`(SELECT ${agg(credit)} FROM ${sql.ref("_emdash_content_bylines")} AS cb ${foldJoin} ${sql.ref("_emdash_bylines")} AS b ON b.translation_group = cb.byline_id LEFT JOIN ${sql.ref("media")} AS m ON m.id = b.avatar_media_id WHERE cb.collection_slug = ${type} AND cb.content_id = ${o}.id AND b.locale = ${o}.locale) AS ${sql.ref("_emdash_bylines")}`;
	const bylinesExist = sql`(SELECT 1 FROM ${sql.ref("_emdash_bylines")} LIMIT 1) AS ${sql.ref("_emdash_bylines_exist")}`;
	return { terms, bylines, bylinesExist };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Kysely instance
function foldedSeoSelect(db: Kysely<any>, type: string, outer: string) {
	const o = sql.ref(outer);
	const pg = isPostgres(db);
	const pairs =
		"'seo_title', s.seo_title, 'seo_description', s.seo_description, 'seo_image', s.seo_image, 'seo_canonical', s.seo_canonical, 'seo_no_index', s.seo_no_index";
	const obj = pg ? sql.raw(`json_build_object(${pairs})`) : sql.raw(`json_object(${pairs})`);
	return sql`(SELECT ${obj} FROM ${sql.ref("_emdash_seo")} AS s WHERE s.collection = ${type} AND s.content_id = ${o}.id LIMIT 1) AS ${sql.ref(SEO_FOLDED_COLUMN)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function expandFoldedSeo(row: Record<string, unknown>): void {
	const raw = row[SEO_FOLDED_COLUMN];
	delete row[SEO_FOLDED_COLUMN];
	let parsed: Record<string, unknown> | null = null;
	if (typeof raw === "string") {
		try {
			const candidate: unknown = JSON.parse(raw);
			if (isPlainObject(candidate)) parsed = candidate;
		} catch {
			return;
		}
	} else if (isPlainObject(raw)) {
		parsed = raw;
	}
	if (!parsed) return;
	for (const [col, alias] of Object.entries(SEO_COLUMN_ALIASES)) {
		row[alias] = parsed[col] ?? null;
	}
}

export function creditsFromFoldedBylines(folded: unknown[]) {
	return folded
		.map((raw) => {
			const credit = isPlainObject(raw) ? raw : {};
			const byline = isPlainObject(credit.byline) ? credit.byline : {};
			return {
				roleLabel: typeof credit.roleLabel === "string" ? credit.roleLabel : null,
				sortOrder: Number(credit.sortOrder ?? 0),
				source: "explicit" as const,
				byline: {
					...byline,
					isGuest: Boolean(byline.isGuest),
					customFields: {},
				},
			};
		})
		.toSorted((a, b) => a.sortOrder - b.sortOrder);
}

function stashFolded(data: Record<string, unknown>, row: Record<string, unknown>): void {
	for (const [col, sym] of [
		["_emdash_terms", FOLDED_TERMS],
		["_emdash_bylines", FOLDED_BYLINES],
	] as const) {
		const raw = row[col];
		let value: unknown;
		if (typeof raw === "string") {
			try {
				value = JSON.parse(raw);
			} catch {
				continue;
			}
		} else if (Array.isArray(raw)) {
			value = raw;
		} else {
			continue;
		}
		Object.defineProperty(data, sym, { value, enumerable: false, configurable: true });
	}
	if ("_emdash_bylines_exist" in row) {
		Object.defineProperty(data, FOLDED_BYLINES_EXIST, {
			value: row["_emdash_bylines_exist"] != null,
			enumerable: false,
			configurable: true,
		});
	}

	const foldedBylines = Reflect.get(data, FOLDED_BYLINES);
	if (!Array.isArray(foldedBylines)) return;
	const credits = creditsFromFoldedBylines(foldedBylines);
	data.bylines = credits;
	data.byline = credits[0]?.byline ?? null;
}

interface EntrySeo {
	title: string | null;
	description: string | null;
	image: string | null;
	canonical: string | null;
	noIndex: boolean;
}

function extractSeo(row: Record<string, unknown>): EntrySeo | null {
	const noIndex = row[SEO_COLUMN_ALIASES.seo_no_index];
	if (noIndex === null || noIndex === undefined) return null;
	const title = row[SEO_COLUMN_ALIASES.seo_title];
	const description = row[SEO_COLUMN_ALIASES.seo_description];
	const image = row[SEO_COLUMN_ALIASES.seo_image];
	const canonical = row[SEO_COLUMN_ALIASES.seo_canonical];
	return {
		title: typeof title === "string" ? title : null,
		description: typeof description === "string" ? description : null,
		image: typeof image === "string" ? image : null,
		canonical: typeof canonical === "string" ? canonical : null,
		noIndex: noIndex === 1,
	};
}

function getTableName(type: string): string {
	validateIdentifier(type, "collection type");
	return `ec_${type}`;
}

interface TaxonomyNamesHolder {
	cache: Map<string, Set<string>> | null;
}

const TAXONOMY_NAMES_CACHE_KEY = Symbol.for("emdash:taxonomy-names");
const taxonomyNamesStore = globalThis as Record<symbol, unknown>;
const taxonomyNamesHolder: TaxonomyNamesHolder =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see taxonomies/index.ts)
	(taxonomyNamesStore[TAXONOMY_NAMES_CACHE_KEY] as TaxonomyNamesHolder | undefined) ??
	(() => {
		const holder: TaxonomyNamesHolder = { cache: null };
		taxonomyNamesStore[TAXONOMY_NAMES_CACHE_KEY] = holder;
		return holder;
	})();

function setTaxonomyNamesCache(cache: Map<string, Set<string>> | null): void {
	taxonomyNamesHolder.cache = cache;
}

async function getTaxonomyNames(db: Kysely<Database>, collection: string): Promise<Set<string>> {
	const hasIsolatedDb = getRequestContext()?.dbIsIsolated === true;

	if (!hasIsolatedDb && taxonomyNamesHolder.cache) {
		return taxonomyNamesHolder.cache.get(collection) ?? new Set();
	}

	try {
		const defs = await db
			.selectFrom("_emdash_taxonomy_defs")
			.select(["name", "collections"])
			.execute();
		const namesByCollection = new Map<string, Set<string>>();
		for (const def of defs) {
			let collections: unknown;
			try {
				collections = JSON.parse(def.collections ?? "[]");
			} catch {
				continue;
			}
			if (!Array.isArray(collections)) continue;
			for (const attachedCollection of collections) {
				if (typeof attachedCollection !== "string") continue;
				const names = namesByCollection.get(attachedCollection) ?? new Set<string>();
				names.add(def.name);
				namesByCollection.set(attachedCollection, names);
			}
		}
		if (!hasIsolatedDb) {
			setTaxonomyNamesCache(namesByCollection);
		}
		return namesByCollection.get(collection) ?? new Set();
	} catch (error) {
		if (!isMissingTableError(error) && !isMissingColumnError(error)) throw error;

		const empty = new Set<string>();
		if (!hasIsolatedDb) {
			setTaxonomyNamesCache(new Map());
		}
		return empty;
	}
}

export function resetTaxonomyNamesCache(): void {
	setTaxonomyNamesCache(null);
}

const INCLUDE_IN_DATA: Record<string, string> = {
	id: "id",
	status: "status",
	author_id: "authorId",
	primary_byline_id: "primaryBylineId",
	created_at: "createdAt",
	updated_at: "updatedAt",
	published_at: "publishedAt",
	scheduled_at: "scheduledAt",
	draft_revision_id: "draftRevisionId",
	live_revision_id: "liveRevisionId",
	locale: "locale",
	translation_group: "translationGroup",
};

const DATE_COLUMNS = new Set(["created_at", "updated_at", "published_at", "scheduled_at"]);

export const CURSOR_RAW_VALUES: unique symbol = Symbol("emdash:cursorRawValues");

const LOCAL_MEDIA_FILE_PREFIX = "/_emdash/api/media/file/";
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

function rowStr(row: Record<string, unknown>, key: string, fallback = ""): string {
	const val = row[key];
	return typeof val === "string" ? val : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBareMediaKey(src: string): boolean {
	return !src.startsWith("/") && !URL_SCHEME_PATTERN.test(src);
}

function normalizeLocalMediaValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(normalizeLocalMediaValue);
	}

	if (!isRecord(value)) {
		return value;
	}

	const normalized: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		normalized[key] = normalizeLocalMediaValue(child);
	}

	if (
		normalized.provider === "local" &&
		typeof normalized.src === "string" &&
		normalized.src.length > 0
	) {
		const src = normalized.src;
		if (src.startsWith(LOCAL_MEDIA_FILE_PREFIX)) {
			const id = src.slice(LOCAL_MEDIA_FILE_PREFIX.length);
			if (!normalized.id && id) {
				normalized.id = id;
			}
		} else if (isBareMediaKey(src)) {
			if (!normalized.id) {
				normalized.id = src;
			}
			normalized.src = `${LOCAL_MEDIA_FILE_PREFIX}${src}`;
		}
	}

	return normalized;
}

function mapRowToData(row: Record<string, unknown>): Record<string, unknown> {
	const data: Record<string, unknown> = {};
	const rawDateValues: Record<string, string> = {};

	for (const [key, value] of Object.entries(row)) {
		if (key in INCLUDE_IN_DATA) {
			if (DATE_COLUMNS.has(key)) {
				if (typeof value === "string") {
					rawDateValues[key] = value;
					data[INCLUDE_IN_DATA[key]] = new Date(value);
				} else {
					data[INCLUDE_IN_DATA[key]] = null;
				}
			} else {
				data[INCLUDE_IN_DATA[key]] = value;
			}
			continue;
		}

		if (SYSTEM_COLUMNS.has(key)) continue;

		if (typeof value === "string") {
			try {
				if (value.startsWith("{") || value.startsWith("[")) {
					data[key] = normalizeLocalMediaValue(JSON.parse(value));
				} else {
					data[key] = value;
				}
			} catch {
				data[key] = value;
			}
		} else {
			data[key] = value;
		}
	}

	Object.defineProperty(data, CURSOR_RAW_VALUES, {
		value: rawDateValues,
		enumerable: false,
		configurable: false,
		writable: false,
	});

	return data;
}

function mapRevisionData(data: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith("_")) continue;
		result[key] = normalizeLocalMediaValue(value);
	}
	return result;
}

let virtualConfig:
	| {
			database?: { config: unknown };
			i18n?: { defaultLocale: string; locales: string[]; prefixDefaultLocale?: boolean } | null;
	  }
	| undefined;
let virtualCreateDialect: ((config: unknown) => Dialect) | undefined;

async function loadVirtualModules() {
	if (virtualConfig === undefined) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore - virtual module
		const configModule = await import("virtual:emdash/config");
		virtualConfig = configModule.default;
	}
	if (virtualCreateDialect === undefined) {
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore - virtual module
		const dialectModule = await import("virtual:emdash/dialect");
		virtualCreateDialect = dialectModule.createDialect;
	}
}

export type EntryData = Record<string, unknown>;

export type SortDirection = "asc" | "desc";

export type OrderBySpec = Record<string, SortDirection>;

interface PrimarySort {
	field: string;
	direction: SortDirection;
}

function getPrimarySort(orderBy: OrderBySpec | undefined, tablePrefix?: string): PrimarySort {
	if (orderBy) {
		for (const [field, direction] of Object.entries(orderBy)) {
			if (FIELD_NAME_PATTERN.test(field)) {
				const fullField = tablePrefix ? `${tablePrefix}.${field}` : field;
				return { field: fullField, direction };
			}
		}
	}
	const defaultField = tablePrefix ? `${tablePrefix}.created_at` : "created_at";
	return { field: defaultField, direction: "desc" };
}

function buildOrderByClause(
	orderBy: OrderBySpec | undefined,
	tablePrefix?: string,
): ReturnType<typeof sql> {
	if (!orderBy || Object.keys(orderBy).length === 0) {
		const field = tablePrefix ? `${tablePrefix}.created_at` : "created_at";
		return sql`ORDER BY ${sql.ref(field)} DESC, ${sql.ref(tablePrefix ? `${tablePrefix}.id` : "id")} DESC`;
	}

	const sortParts: ReturnType<typeof sql>[] = [];

	for (const [field, direction] of Object.entries(orderBy)) {
		if (!FIELD_NAME_PATTERN.test(field)) {
			continue;
		}

		const fullField = tablePrefix ? `${tablePrefix}.${field}` : field;
		const dir = direction === "asc" ? sql`ASC` : sql`DESC`;
		sortParts.push(sql`${sql.ref(fullField)} ${dir}`);
	}

	if (sortParts.length === 0) {
		const defaultField = tablePrefix ? `${tablePrefix}.created_at` : "created_at";
		return sql`ORDER BY ${sql.ref(defaultField)} DESC, ${sql.ref(tablePrefix ? `${tablePrefix}.id` : "id")} DESC`;
	}

	const primary = getPrimarySort(orderBy, tablePrefix);
	const idField = tablePrefix ? `${tablePrefix}.id` : "id";
	const idDir = primary.direction === "asc" ? sql`ASC` : sql`DESC`;
	sortParts.push(sql`${sql.ref(idField)} ${idDir}`);

	return sql`ORDER BY ${sql.join(sortParts, sql`, `)}`;
}

function buildCursorCondition(
	cursor: string,
	orderBy: OrderBySpec | undefined,
	tablePrefix?: string,
): ReturnType<typeof sql> {
	const { orderValue, id: cursorId } = decodeCursor(cursor);
	const primary = getPrimarySort(orderBy, tablePrefix);
	const idField = tablePrefix ? `${tablePrefix}.id` : "id";

	if (primary.direction === "desc") {
		return sql`(${sql.ref(primary.field)} < ${orderValue} OR (${sql.ref(primary.field)} = ${orderValue} AND ${sql.ref(idField)} < ${cursorId}))`;
	}
	return sql`(${sql.ref(primary.field)} > ${orderValue} OR (${sql.ref(primary.field)} = ${orderValue} AND ${sql.ref(idField)} > ${cursorId}))`;
}

function isWhereRange(value: WhereValue): value is WhereRange {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildFieldConditions(
	fields: Record<string, WhereValue>,
	tablePrefix?: string,
): ReturnType<typeof sql>[] {
	const conditions: ReturnType<typeof sql>[] = [];

	for (const [key, value] of Object.entries(fields)) {
		if (!FIELD_NAME_PATTERN.test(key)) {
			console.warn(`[emdash] where filter: invalid field name "${key}" ignored`);
			continue;
		}
		if (value == null) continue;
		const ref = tablePrefix ? sql.ref(`${tablePrefix}.${key}`) : sql.ref(key);

		if (isWhereRange(value)) {
			if (value.gt !== undefined) conditions.push(sql`${ref} > ${value.gt}`);
			if (value.gte !== undefined) conditions.push(sql`${ref} >= ${value.gte}`);
			if (value.lt !== undefined) conditions.push(sql`${ref} < ${value.lt}`);
			if (value.lte !== undefined) conditions.push(sql`${ref} <= ${value.lte}`);
		} else if (Array.isArray(value)) {
			if (value.length > 0) {
				conditions.push(sql`${ref} IN (${sql.join(value.map((v) => sql`${v}`))})`);
			}
		} else {
			conditions.push(sql`${ref} = ${value}`);
		}
	}

	return conditions;
}

async function resolveTermGroups(
	db: Kysely<Database>,
	name: string,
	slugs: string[],
	locale: string | undefined,
): Promise<string[]> {
	let query = db
		.selectFrom("taxonomies")
		.select("translation_group")
		.distinct()
		.where("name", "=", name)
		.where("slug", "in", slugs);
	if (locale) query = query.where("locale", "=", locale);
	const rows = await query.execute();
	const groups = new Set<string>();
	for (const row of rows) {
		if (row.translation_group) groups.add(row.translation_group);
	}
	return [...groups];
}

function pivotGroupCondition(ref: string, groups: string[]): ReturnType<typeof sql> {
	if (groups.length === 1) return sql`${sql.ref(ref)} = ${groups[0]}`;
	return sql`${sql.ref(ref)} IN (${sql.join(groups.map((g) => sql`${g}`))})`;
}

function buildPivotLimitOffset(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Kysely instance
	db: Kysely<any>,
	fetchLimit: number | undefined,
	offset: number | undefined,
): ReturnType<typeof sql> {
	if (fetchLimit != null && offset != null) return sql`LIMIT ${fetchLimit} OFFSET ${offset}`;
	if (fetchLimit != null) return sql`LIMIT ${fetchLimit}`;
	if (offset != null) {
		return isPostgres(db) ? sql`OFFSET ${offset}` : sql`LIMIT -1 OFFSET ${offset}`;
	}
	return sql``;
}

export interface TaxonomyPivotQueryOptions {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any Kysely instance
	db: Kysely<any>;
	collection: string;
	tableName: string;
	groupSets: string[][];
	orderBy: OrderBySpec | undefined;
	cursor: string | undefined;
	locale: string | undefined;
	status: string | undefined;
	deletedIsNull: boolean;
	bylineGroups: string[] | null;
	fetchLimit: number | undefined;
	offset: number | undefined;
}

export function buildTaxonomyPivotQuery(
	opts: TaxonomyPivotQueryOptions,
): ReturnType<typeof sql<Record<string, unknown>>> {
	const {
		db,
		collection,
		tableName,
		groupSets,
		orderBy,
		cursor,
		locale,
		status,
		deletedIsNull,
		bylineGroups,
		fetchLimit,
		offset,
	} = opts;

	const primary = getPrimarySort(orderBy);
	const validSortKeys = orderBy
		? Object.keys(orderBy).filter((k) => FIELD_NAME_PATTERN.test(k))
		: [];
	const singleSort = validSortKeys.length <= 1;
	const isIndexedSort =
		singleSort && (primary.field === "published_at" || primary.field === "created_at");
	const dir = primary.direction === "asc" ? sql`ASC` : sql`DESC`;
	const cmp = primary.direction === "asc" ? sql.raw(">") : sql.raw("<");

	const firstGroups = groupSets[0] ?? [];
	const restGroups = groupSets.slice(1);
	const multiGroup = firstGroups.length > 1;

	const residual =
		restGroups.length > 0
			? sql`${sql.join(
					restGroups.map(
						(g) => sql`AND EXISTS (
						SELECT 1 FROM content_taxonomies ct2
						WHERE ct2.collection = ${collection}
							AND ct2.entry_id = ct.entry_id
							AND ${pivotGroupCondition("ct2.taxonomy_id", g)}
					)`,
					),
					sql` `,
				)}`
			: sql``;

	const bylineCt = bylineGroups
		? sql`AND EXISTS (
				SELECT 1 FROM _emdash_content_bylines cb
				WHERE cb.collection_slug = ${collection}
					AND cb.content_id = r.id
					AND cb.byline_id IN (${sql.join(bylineGroups.map((g) => sql`${g}`))})
			)`
		: sql``;

	const firstGroupCond = pivotGroupCondition("ct.taxonomy_id", firstGroups);
	const pivotContentJoin = isPostgres(db) ? sql`JOIN` : sql`CROSS JOIN`;
	const {
		terms: termsSelect,
		bylines: bylinesSelect,
		bylinesExist: bylinesExistSelect,
	} = foldedHydrationSelects(db, collection, "r");

	const deletedR = deletedIsNull ? sql`r.deleted_at IS NULL` : sql`r.deleted_at IS NOT NULL`;
	const statusR = status !== undefined ? sql`AND ${buildStatusCondition(db, status, "r")}` : sql``;
	const localeR = locale ? sql`AND r.locale = ${locale}` : sql``;

	if (isIndexedSort) {
		const sortRef = sql.ref(`r.${primary.field}`);
		const sortval = multiGroup ? sql`MAX(${sortRef})` : sortRef;
		const groupByClause = multiGroup ? sql`GROUP BY r.id` : sql``;

		let cursorClause = sql``;
		let havingClause = sql``;
		if (cursor) {
			const { orderValue, id } = decodeCursor(cursor);
			const cond = sql`(${sortval} ${cmp} ${orderValue} OR (${sortval} = ${orderValue} AND r.id ${cmp} ${id}))`;
			if (multiGroup) havingClause = sql`HAVING ${cond}`;
			else cursorClause = sql`AND ${cond}`;
		}

		const limitClause = buildPivotLimitOffset(db, fetchLimit, offset);

		return sql<Record<string, unknown>>`
			WITH picked AS (
				SELECT r.id AS entry_id, ${sortval} AS sortval
				FROM content_taxonomies ct
				${pivotContentJoin} ${sql.ref(tableName)} AS r ON r.translation_group = ct.entry_id
				WHERE ct.collection = ${collection}
					AND ${firstGroupCond}
					AND ${deletedR}
					${statusR}
					${localeR}
					${residual}
					${bylineCt}
					${cursorClause}
				${groupByClause}
				${havingClause}
				ORDER BY sortval ${dir}, r.id ${dir}
				${limitClause}
			)
			SELECT r.*, ${termsSelect}, ${bylinesSelect}, ${bylinesExistSelect}
			FROM picked JOIN ${sql.ref(tableName)} AS r ON r.id = picked.entry_id
			WHERE ${deletedR} ${statusR} ${localeR}
			ORDER BY picked.sortval ${dir}, picked.entry_id ${dir}
		`;
	}

	const orderByClause = buildOrderByClause(orderBy, "r");
	const cursorCond = cursor ? sql`AND ${buildCursorCondition(cursor, orderBy, "r")}` : sql``;
	const limitClause = buildPivotLimitOffset(db, fetchLimit, offset);
	return sql<Record<string, unknown>>`
		WITH picked AS (
			SELECT DISTINCT r.id AS entry_id
			FROM content_taxonomies ct
			${pivotContentJoin} ${sql.ref(tableName)} AS r ON r.translation_group = ct.entry_id
			WHERE ct.collection = ${collection}
				AND ${firstGroupCond}
				AND ${deletedR}
				${statusR}
				${localeR}
				${residual}
				${bylineCt}
		)
		SELECT r.*, ${termsSelect}, ${bylinesSelect}, ${bylinesExistSelect}
		FROM picked JOIN ${sql.ref(tableName)} AS r ON r.id = picked.entry_id
		WHERE ${deletedR} ${statusR} ${localeR}
			${cursorCond}
		${orderByClause}
		${limitClause}
	`;
}

export interface WhereRange {
	gt?: string;
	gte?: string;
	lt?: string;
	lte?: string;
}

export type WhereValue = string | string[] | WhereRange;

export interface CollectionFilterBase {
	type: string;
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

export interface EntryFilter {
	type: string;
	id: string;
	revisionId?: string;
	locale?: string;
}

let dbInstance: Kysely<Database> | null = null;

export async function getDb(): Promise<Kysely<Database>> {
	const ctx = getRequestContext();
	if (ctx?.db) {
		return ctx.db as Kysely<Database>; // eslint-disable-line typescript/no-unsafe-type-assertion -- db is typed as unknown in RequestContext to avoid circular deps
	}

	if (!dbInstance) {
		await loadVirtualModules();
		if (!virtualConfig?.database || typeof virtualCreateDialect !== "function") {
			throw new Error(
				"EmDash database not configured. Add database config to emdash() in astro.config.mjs",
			);
		}
		const dialect = virtualCreateDialect(virtualConfig.database.config);
		dbInstance = new Kysely<Database>({ dialect, log: kyselyLogOption() });
	}
	return dbInstance;
}

export function emdashLoader(): LiveLoader<EntryData, EntryFilter, CollectionFilter> {
	return {
		name: "emdash",

		async loadCollection({ filter }) {
			try {
				const db = await getDb();

				const type = filter?.type;
				if (!type) {
					return {
						error: new Error(
							"type filter is required. Use getEmDashCollection() instead of getLiveCollection() directly.",
						),
					};
				}

				const tableName = getTableName(type);

				const status = filter?.status || "published";
				const limit = filter?.limit;
				const cursor = filter?.cursor;
				const where = filter?.where;
				const orderBy = filter?.orderBy;
				const locale = filter?.locale;

				const fetchLimit = limit ? limit + 1 : undefined;

				const rawOffset = cursor ? undefined : filter?.offset;
				const offset =
					typeof rawOffset === "number" && Number.isInteger(rawOffset) && rawOffset > 0
						? rawOffset
						: undefined;

				const cursorCondition = cursor ? buildCursorCondition(cursor, orderBy) : null;

				let result: { rows: Record<string, unknown>[] };
				const taxonomyFilters: { name: string; slugs: string[] }[] = [];
				let bylineFilter: { groups: string[] } | null = null;
				const fieldFilters: Record<string, WhereValue> = {};

				if (where && Object.keys(where).length > 0) {
					const taxNames = await getTaxonomyNames(db, type);

					for (const [key, value] of Object.entries(where)) {
						if (value == null) continue;
						if (key === "byline") {
							if (isWhereRange(value)) {
								console.warn(
									`[emdash] where filter: range operators are not supported on "byline", ignored`,
								);
								continue;
							}
							const groups = Array.isArray(value) ? value : [value];
							bylineFilter = { groups };
						} else if (taxNames.has(key)) {
							if (isWhereRange(value)) {
								console.warn(
									`[emdash] where filter: range operators are not supported on taxonomy "${key}", ignored`,
								);
								continue;
							}
							const slugs = Array.isArray(value) ? value : [value];
							taxonomyFilters.push({ name: key, slugs });
						} else {
							fieldFilters[key] = value;
						}
					}
				}

				if (
					(bylineFilter && bylineFilter.groups.length === 0) ||
					taxonomyFilters.some((f) => f.slugs.length === 0)
				) {
					return { entries: [], cacheHint: { tags: [type] } };
				}

				if (taxonomyFilters.length > 0 && Object.keys(fieldFilters).length === 0) {
					const groupSets: string[][] = [];
					for (const taxFilter of taxonomyFilters) {
						const groups = await resolveTermGroups(db, taxFilter.name, taxFilter.slugs, locale);
						if (groups.length === 0) {
							return { entries: [], cacheHint: { tags: [type] } };
						}
						groupSets.push(groups);
					}

					result = await buildTaxonomyPivotQuery({
						db,
						collection: type,
						tableName,
						groupSets,
						orderBy,
						cursor,
						locale,
						status,
						deletedIsNull: true,
						bylineGroups: bylineFilter ? bylineFilter.groups : null,
						fetchLimit,
						offset,
					}).execute(db);
				} else {
					const orderByClause = buildOrderByClause(orderBy);
					const statusCondition = buildStatusCondition(db, status);
					const localeFilter = locale ? sql`AND locale = ${locale}` : sql``;
					const cursorCond = cursorCondition ? sql`AND ${cursorCondition}` : sql``;
					const fieldConds = buildFieldConditions(fieldFilters);
					const fieldCondsSQL =
						fieldConds.length > 0 ? sql`${sql.join(fieldConds, sql` AND `)}` : null;

					const taxonomyCond =
						taxonomyFilters.length > 0
							? sql`${sql.join(
									taxonomyFilters.map(
										(f) => sql`AND EXISTS (
							SELECT 1 FROM content_taxonomies ct
							INNER JOIN taxonomies t ON t.translation_group = ct.taxonomy_id
							WHERE ct.collection = ${type}
								AND ct.entry_id = ${sql.ref(tableName)}.translation_group
								AND t.name = ${f.name}
								AND t.slug IN (${sql.join(f.slugs.map((s) => sql`${s}`))})
							${locale ? sql`AND t.locale = ${locale}` : sql``}
						)`,
									),
									sql` `,
								)}`
							: sql``;

					const bylineCond = bylineFilter
						? sql`AND EXISTS (
							SELECT 1 FROM _emdash_content_bylines cb
							WHERE cb.collection_slug = ${type}
								AND cb.content_id = ${sql.ref(tableName)}.id
								AND cb.byline_id IN (${sql.join(bylineFilter.groups.map((g) => sql`${g}`))})
						)`
						: sql``;

					const {
						terms: termsSelect,
						bylines: bylinesSelect,
						bylinesExist: bylinesExistSelect,
					} = foldedHydrationSelects(db, type, tableName);

					let limitOffsetClause = sql``;
					if (fetchLimit != null && offset != null) {
						limitOffsetClause = sql`LIMIT ${fetchLimit} OFFSET ${offset}`;
					} else if (fetchLimit != null) {
						limitOffsetClause = sql`LIMIT ${fetchLimit}`;
					} else if (offset != null) {
						limitOffsetClause = isPostgres(db)
							? sql`OFFSET ${offset}`
							: sql`LIMIT -1 OFFSET ${offset}`;
					}
					result = await sql<Record<string, unknown>>`
						SELECT *, ${termsSelect}, ${bylinesSelect}, ${bylinesExistSelect} FROM ${sql.ref(tableName)}
						WHERE deleted_at IS NULL
						AND ${statusCondition}
						${localeFilter}
						${cursorCond}
						${taxonomyCond}
						${bylineCond}
						${fieldCondsSQL ? sql`AND ${fieldCondsSQL}` : sql``}
						${orderByClause}
						${limitOffsetClause}
					`.execute(db);
				}

				const hasMore = limit ? result.rows.length > limit : false;
				const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

				const i18nConfig = virtualConfig?.i18n;
				const i18nEnabled = i18nConfig && i18nConfig.locales.length > 1;
				const entries = rows.map((row) => {
					const slug = rowStr(row, "slug") || rowStr(row, "id");
					const rowLocale = rowStr(row, "locale");
					const shouldPrefix =
						i18nEnabled &&
						rowLocale !== "" &&
						(rowLocale !== i18nConfig.defaultLocale || i18nConfig.prefixDefaultLocale);
					const id = shouldPrefix ? `${rowLocale}/${slug}` : slug;
					const data = mapRowToData(row);
					stashFolded(data, row);
					return {
						id,
						slug: rowStr(row, "slug"),
						status: rowStr(row, "status", "draft"),
						data,
						cacheHint: {
							tags: [rowStr(row, "id")],
							lastModified: row.updated_at ? new Date(rowStr(row, "updated_at")) : undefined,
						},
					};
				});

				let nextCursor: string | undefined;
				if (hasMore && rows.length > 0) {
					const lastRow = rows.at(-1)!;
					const primary = getPrimarySort(orderBy);
					const fieldName = primary.field.includes(".")
						? primary.field.split(".").pop()!
						: primary.field;
					const lastOrderValue = lastRow[fieldName];
					const orderStr =
						typeof lastOrderValue === "string" || typeof lastOrderValue === "number"
							? String(lastOrderValue)
							: "";
					nextCursor = encodeCursor(orderStr, String(lastRow.id));
				}

				let collectionLastModified: Date | undefined;
				for (const row of rows) {
					if (row.updated_at) {
						const d = new Date(rowStr(row, "updated_at"));
						if (!collectionLastModified || d > collectionLastModified) {
							collectionLastModified = d;
						}
					}
				}

				return {
					entries,
					nextCursor,
					cacheHint: {
						tags: [type],
						lastModified: collectionLastModified,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (isMissingTableError(error) || isMissingColumnError(error)) {
					if (isMissingColumnError(error)) {
						console.warn(`[emdash] where filter: ${message}`);
					}
					return { entries: [] };
				}

				return {
					error: new Error(`Failed to load collection: ${message}`),
				};
			}
		},

		async loadEntry({ filter }) {
			try {
				const db = await getDb();

				const type = filter?.type;
				const id = filter?.id;

				if (!type || !id) {
					return {
						error: new Error(
							"type and id filters are required. Use getEmDashEntry() instead of getLiveEntry() directly.",
						),
					};
				}

				const tableName = getTableName(type);
				const locale = filter?.locale;

				const {
					terms: termsSelect,
					bylines: bylinesSelect,
					bylinesExist: bylinesExistSelect,
				} = foldedHydrationSelects(db, type, "c");
				const seoSelect = foldedSeoSelect(db, type, "c");
				const result = locale
					? await sql<Record<string, unknown>>`
							SELECT c.*, ${seoSelect}, ${termsSelect}, ${bylinesSelect}, ${bylinesExistSelect}
							FROM ${sql.ref(tableName)} AS c
							WHERE c.deleted_at IS NULL
							AND ((c.slug = ${id} AND c.locale = ${locale}) OR c.id = ${id})
							LIMIT 1
						`.execute(db)
					: await sql<Record<string, unknown>>`
							SELECT c.*, ${seoSelect}, ${termsSelect}, ${bylinesSelect}, ${bylinesExistSelect}
							FROM ${sql.ref(tableName)} AS c
							WHERE c.deleted_at IS NULL
							AND (c.slug = ${id} OR c.id = ${id})
							LIMIT 1
						`.execute(db);

				const row = result.rows[0];
				if (!row) {
					return undefined;
				}

				expandFoldedSeo(row);

				const i18nConfig = virtualConfig?.i18n;
				const i18nEnabled = i18nConfig && i18nConfig.locales.length > 1;
				const entrySlug = rowStr(row, "slug") || rowStr(row, "id");
				const entryLocale = rowStr(row, "locale");
				const shouldPrefixEntry =
					i18nEnabled &&
					entryLocale !== "" &&
					(entryLocale !== i18nConfig.defaultLocale || i18nConfig.prefixDefaultLocale);
				const entryId = shouldPrefixEntry ? `${entryLocale}/${entrySlug}` : entrySlug;

				const revisionId = filter?.revisionId;
				if (revisionId) {
					const revRow = await sql<{ data: string }>`
						SELECT data FROM revisions
						WHERE id = ${revisionId}
						LIMIT 1
					`.execute(db);

					const revData = revRow.rows[0];
					if (revData) {
						const parsed: Record<string, unknown> = JSON.parse(revData.data);
						const systemData: Record<string, unknown> = {};
						for (const [key, mappedKey] of Object.entries(INCLUDE_IN_DATA)) {
							if (key in row) {
								if (DATE_COLUMNS.has(key)) {
									systemData[mappedKey] = typeof row[key] === "string" ? new Date(row[key]) : null;
								} else {
									systemData[mappedKey] = row[key];
								}
							}
						}
						const slug = typeof parsed._slug === "string" ? parsed._slug : rowStr(row, "slug");
						const revSlug = slug || rowStr(row, "id");
						const revLocale = rowStr(row, "locale");
						const shouldPrefixRev =
							i18nEnabled &&
							revLocale !== "" &&
							(revLocale !== i18nConfig.defaultLocale || i18nConfig.prefixDefaultLocale);
						const revId = shouldPrefixRev ? `${revLocale}/${revSlug}` : revSlug;
						const revEntryData: Record<string, unknown> = {
							...systemData,
							slug,
							...mapRevisionData(parsed),
						};
						const revSeo = extractSeo(row);
						if (revSeo) revEntryData.seo = revSeo;
						stashFolded(revEntryData, row);
						return {
							id: revId,
							slug,
							status: rowStr(row, "status", "draft"),
							data: revEntryData,
							cacheHint: {
								tags: [rowStr(row, "id")],
								lastModified: row.updated_at ? new Date(rowStr(row, "updated_at")) : undefined,
							},
						};
					}
				}

				const entryData = mapRowToData(row);
				const entrySeo = extractSeo(row);
				if (entrySeo) entryData.seo = entrySeo;
				stashFolded(entryData, row);
				return {
					id: entryId,
					slug: rowStr(row, "slug"),
					status: rowStr(row, "status", "draft"),
					data: entryData,
					cacheHint: {
						tags: [rowStr(row, "id")],
						lastModified: row.updated_at ? new Date(rowStr(row, "updated_at")) : undefined,
					},
				};
			} catch (error) {
				if (isMissingTableError(error)) {
					return undefined;
				}

				const message = error instanceof Error ? error.message : String(error);
				return {
					error: new Error(`Failed to load entry: ${message}`),
				};
			}
		},
	};
}
