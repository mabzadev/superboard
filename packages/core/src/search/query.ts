import type { Kysely } from "kysely";
import { sql } from "kysely";

import { encodeCursor, decodeCursor, InvalidCursorError } from "../database/repositories/types.js";
import type { Database } from "../database/types.js";
import { validateIdentifier } from "../database/validate.js";
import { resolveConfiguredLocale } from "../i18n/config.js";
import { getDb } from "../loader.js";
import { FTSManager } from "./fts-manager.js";
import type {
	SearchOptions,
	CollectionSearchOptions,
	SearchResult,
	SearchResponse,
	SuggestOptions,
	Suggestion,
	SearchStats,
} from "./types.js";

const SEARCH_CURSOR_MARKER = "search";

function encodeSearchCursor(offset: number): string {
	return encodeCursor(String(offset), SEARCH_CURSOR_MARKER);
}

const MAX_SEARCH_OFFSET = 10_000;

function decodeSearchOffset(cursor: string): number {
	const { orderValue, id } = decodeCursor(cursor);
	if (id !== SEARCH_CURSOR_MARKER) {
		throw new InvalidCursorError(cursor);
	}
	const offset = Number(orderValue);
	if (!Number.isInteger(offset) || offset < 0 || offset > MAX_SEARCH_OFFSET) {
		throw new InvalidCursorError(cursor);
	}
	return offset;
}

const WHITESPACE_SPLIT_PATTERN = /\s+/;
const FTS_OPERATORS_PATTERN = /\b(AND|OR|NOT|NEAR)\b/i;
const DOUBLE_QUOTE_PATTERN = /"/g;

function isFts5SyntaxError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	return message.includes("fts5: syntax error") || message.includes("unknown special query");
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
	const db = await getDb();
	return searchWithDb(db, query, options);
}

export async function searchWithDb(
	db: Kysely<Database>,
	query: string,
	options: SearchOptions = {},
): Promise<SearchResponse> {
	const ftsManager = new FTSManager(db);
	const limit = options.limit ?? 20;
	const status = options.status ?? "published";
	const offset = options.cursor ? decodeSearchOffset(options.cursor) : 0;

	let collections = options.collections;
	if (!collections || collections.length === 0) {
		collections = await getSearchableCollections(db);
	}

	if (collections.length === 0) {
		return { items: [] };
	}

	const perCollectionLimit = offset + limit + 1;

	const allResults: SearchResult[] = [];
	const titleColumns = await ftsManager.getCollectionsWithTitleColumn(collections);

	for (const collection of collections) {
		const config = await ftsManager.getSearchConfig(collection);
		if (!config?.enabled) {
			continue;
		}

		const collectionResults = await searchSingleCollection(
			db,
			collection,
			query,
			{
				status,
				locale: options.locale,
				limit: perCollectionLimit,
			},
			config.weights,
			titleColumns.has(collection),
			config.titleField,
		);

		allResults.push(...collectionResults);
	}

	allResults.sort((a, b) => b.score - a.score);

	const items = allResults.slice(offset, offset + limit);
	const hasMore = allResults.length > offset + limit;
	const nextCursor = hasMore ? encodeSearchCursor(offset + limit) : undefined;

	return { items, nextCursor };
}

export async function searchCollection(
	db: Kysely<Database>,
	collection: string,
	query: string,
	options: CollectionSearchOptions = {},
): Promise<SearchResponse> {
	const ftsManager = new FTSManager(db);
	const config = await ftsManager.getSearchConfig(collection);

	if (!config?.enabled) {
		return { items: [] };
	}

	const limit = options.limit ?? 20;
	const offset = options.cursor ? decodeSearchOffset(options.cursor) : 0;

	const fetched = await searchSingleCollection(
		db,
		collection,
		query,
		{ status: options.status, locale: options.locale, limit: offset + limit + 1 },
		config.weights,
		undefined,
		config.titleField,
	);

	const items = fetched.slice(offset, offset + limit);
	const hasMore = fetched.length > offset + limit;
	const nextCursor = hasMore ? encodeSearchCursor(offset + limit) : undefined;

	return { items, nextCursor };
}

async function searchSingleCollection(
	db: Kysely<Database>,
	collection: string,
	query: string,
	options: CollectionSearchOptions,
	weights?: Record<string, number>,
	hasTitle?: boolean,
	titleField?: string,
): Promise<SearchResult[]> {
	validateIdentifier(collection, "collection slug");

	const ftsManager = new FTSManager(db);
	const ftsTable = ftsManager.getFtsTableName(collection);
	const contentTable = ftsManager.getContentTableName(collection);
	const limit = options.limit ?? 20;
	const status = options.status ?? "published";
	const locale = options.locale ? resolveConfiguredLocale(options.locale) : undefined;

	if (!(await ftsManager.ftsTableExists(collection))) {
		return [];
	}

	const escapedQuery = escapeQuery(query);
	if (!escapedQuery) {
		return [];
	}

	const searchableFields = await ftsManager.getSearchableFields(collection);

	let titleExpr;
	if (titleField) {
		validateIdentifier(titleField, "title field");
		titleExpr = sql`c.${sql.ref(titleField)}`;
	} else {
		const collectionHasTitle = hasTitle ?? (await ftsManager.hasTitleColumn(collection));
		titleExpr = collectionHasTitle ? sql`c.title` : sql`NULL`;
	}

	let bm25Args = "";
	if (weights && searchableFields.length > 0) {
		const weightValues = ["0", "0"];
		for (const field of searchableFields) {
			weightValues.push(String(weights[field] ?? 1));
		}
		bm25Args = weightValues.join(", ");
	}

	const bm25Expr = bm25Args ? `bm25("${ftsTable}", ${bm25Args})` : `bm25("${ftsTable}")`;

	let results;
	try {
		results = await sql<{
			id: string;
			slug: string | null;
			locale: string;
			title: string | null;
			snippet: string | null;
			score: number;
		}>`
		SELECT
			c.id,
			c.slug,
			c.locale,
			${titleExpr} as title,
			snippet("${sql.raw(ftsTable)}", 2, '<mark>', '</mark>', '...', 32) as snippet,
			${sql.raw(bm25Expr)} as score
		FROM "${sql.raw(ftsTable)}" f
		JOIN "${sql.raw(contentTable)}" c ON f.id = c.id
		WHERE "${sql.raw(ftsTable)}" MATCH ${escapedQuery}
		AND c.status = ${status}
		AND c.deleted_at IS NULL
		${locale ? sql`AND c.locale = ${locale}` : sql``}
		ORDER BY score
		LIMIT ${limit}
	`.execute(db);
	} catch (error) {
		if (isFts5SyntaxError(error)) {
			return [];
		}
		throw error;
	}

	return results.rows.map((row) => ({
		collection,
		id: row.id,
		slug: row.slug,
		locale: row.locale,
		title: row.title ?? undefined,
		snippet: row.snippet === null ? undefined : sanitizeSnippet(row.snippet),
		score: Math.abs(row.score),
	}));
}

const SNIPPET_AMP_RE = /&/g;
const SNIPPET_LT_RE = /</g;
const SNIPPET_GT_RE = />/g;
const SNIPPET_QUOT_RE = /"/g;
const SNIPPET_APOS_RE = /'/g;

function sanitizeSnippet(snippet: string): string {
	return snippet
		.replace(SNIPPET_AMP_RE, "&amp;")
		.replace(SNIPPET_LT_RE, "&lt;")
		.replace(SNIPPET_GT_RE, "&gt;")
		.replace(SNIPPET_QUOT_RE, "&quot;")
		.replace(SNIPPET_APOS_RE, "&#39;")
		.replaceAll("&lt;mark&gt;", "<mark>")
		.replaceAll("&lt;/mark&gt;", "</mark>");
}

export async function getSuggestions(
	db: Kysely<Database>,
	query: string,
	options: SuggestOptions = {},
): Promise<Suggestion[]> {
	const limit = options.limit ?? 5;
	const locale = options.locale ? resolveConfiguredLocale(options.locale) : undefined;

	let collections = options.collections;
	if (!collections || collections.length === 0) {
		collections = await getSearchableCollections(db);
	}

	if (collections.length === 0) {
		return [];
	}

	const suggestions: Suggestion[] = [];
	const ftsManager = new FTSManager(db);
	const titleColumns = await ftsManager.getCollectionsWithTitleColumn(collections);

	for (const collection of collections) {
		const config = await ftsManager.getSearchConfig(collection);
		if (!config?.enabled) {
			continue;
		}

		let titleExpr;
		if (config.titleField) {
			validateIdentifier(config.titleField, "title field");
			titleExpr = sql`c.${sql.ref(config.titleField)}`;
		} else if (titleColumns.has(collection)) {
			titleExpr = sql`c.title`;
		} else {
			continue;
		}

		validateIdentifier(collection, "collection slug");

		const ftsTable = ftsManager.getFtsTableName(collection);
		const contentTable = ftsManager.getContentTableName(collection);

		const prefixQuery = escapeQuery(query);
		if (!prefixQuery) {
			continue;
		}

		let results;
		try {
			results = await sql<{
				id: string;
				slug: string | null;
				title: string;
			}>`
				SELECT
					c.id,
					c.slug,
					${titleExpr} AS title
				FROM "${sql.raw(ftsTable)}" f
				JOIN "${sql.raw(contentTable)}" c ON f.id = c.id
				WHERE "${sql.raw(ftsTable)}" MATCH ${prefixQuery}
				AND c.status = 'published'
				AND c.deleted_at IS NULL
				AND ${titleExpr} IS NOT NULL
				${locale ? sql`AND c.locale = ${locale}` : sql``}
				ORDER BY bm25("${sql.raw(ftsTable)}")
				LIMIT ${limit}
			`.execute(db);
		} catch (error) {
			if (isFts5SyntaxError(error)) {
				continue;
			}
			throw error;
		}

		for (const row of results.rows) {
			suggestions.push({
				collection,
				id: row.id,
				slug: row.slug,
				title: row.title,
			});
		}
	}

	return suggestions.slice(0, limit);
}

export async function getSearchStats(db: Kysely<Database>): Promise<SearchStats> {
	const ftsManager = new FTSManager(db);
	const collections = await getSearchableCollections(db);
	const stats: SearchStats = { collections: {} };

	for (const collection of collections) {
		const collectionStats = await ftsManager.getIndexStats(collection);
		if (collectionStats) {
			stats.collections[collection] = collectionStats;
		}
	}

	return stats;
}

async function getSearchableCollections(db: Kysely<Database>): Promise<string[]> {
	const results = await db
		.selectFrom("_emdash_collections")
		.select(["slug", "search_config"])
		.execute();

	return results
		.filter((r) => {
			if (!r.search_config) return false;
			try {
				const config = JSON.parse(r.search_config);
				return config.enabled === true;
			} catch {
				return false;
			}
		})
		.map((r) => r.slug);
}

function escapeQuery(query: string): string {
	if (!query || typeof query !== "string") {
		return "";
	}

	query = query.trim();

	if (query.length === 0) {
		return "";
	}

	if (query.startsWith('"') && query.endsWith('"') && query.length >= 2) {
		const inner = query.slice(1, -1);
		return `"${inner.replace(DOUBLE_QUOTE_PATTERN, '""')}"`;
	}

	const escaped = query.replace(DOUBLE_QUOTE_PATTERN, '""');

	if (FTS_OPERATORS_PATTERN.test(query)) {
		return escaped;
	}

	const terms = escaped.split(WHITESPACE_SPLIT_PATTERN).filter((t) => t.length > 0);
	if (terms.length === 0) {
		return "";
	}

	return terms.map((t) => `"${t}"*`).join(" ");
}
