import type { Kysely } from "kysely";
import { sql } from "kysely";

import { buildStatusCondition, compoundSelectLimit } from "../database/dialect-helpers.js";
import type { Database } from "../database/types.js";
import { validateIdentifier } from "../database/validate.js";
import { chunks } from "../utils/chunks.js";
import { isMissingTableError } from "../utils/db-errors.js";

interface CountRow {
	taxonomy_id: string;
	count: number | string | bigint;
}

function collectionBranch(
	db: Kysely<Database>,
	taxonomyName: string,
	collection: string,
	locale?: string,
): ReturnType<typeof sql> {
	return sql`
		SELECT ct.taxonomy_id AS taxonomy_id, COUNT(DISTINCT e.translation_group) AS count
		FROM content_taxonomies AS ct
		CROSS JOIN ${sql.ref(`ec_${collection}`)} AS e
		WHERE e.translation_group = ct.entry_id
			AND ct.collection = ${collection}
			AND ct.taxonomy_id IN (SELECT translation_group FROM taxonomies WHERE name = ${taxonomyName})
			${locale ? sql`AND e.locale = ${locale}` : sql``}
			AND ${buildStatusCondition(db, "published", "e")}
			AND e.deleted_at IS NULL
		GROUP BY ct.taxonomy_id`;
}

async function runCounts(
	db: Kysely<Database>,
	taxonomyName: string,
	collections: string[],
	locale?: string,
): Promise<Map<string, number>> {
	const branches = collections.map((collection) =>
		collectionBranch(db, taxonomyName, collection, locale),
	);
	const union = sql.join(branches, sql` UNION ALL `);
	const result = await sql<CountRow>`
		SELECT taxonomy_id, SUM(count) AS count
		FROM (${union}) AS per_collection
		GROUP BY taxonomy_id`.execute(db);

	const counts = new Map<string, number>();
	for (const row of result.rows) counts.set(row.taxonomy_id, Number(row.count));
	return counts;
}

function addCounts(into: Map<string, number>, from: Map<string, number>): void {
	for (const [group, count] of from) into.set(group, (into.get(group) ?? 0) + count);
}

async function runBatch(
	db: Kysely<Database>,
	taxonomyName: string,
	collections: string[],
	locale?: string,
): Promise<Map<string, number>> {
	try {
		return await runCounts(db, taxonomyName, collections, locale);
	} catch (error) {
		if (!isMissingTableError(error)) throw error;
	}

	const counts = new Map<string, number>();
	for (const collection of collections) {
		try {
			addCounts(counts, await runCounts(db, taxonomyName, [collection], locale));
		} catch (error) {
			if (!isMissingTableError(error)) throw error;
		}
	}
	return counts;
}

export async function fetchVisibleTermCounts(
	db: Kysely<Database>,
	taxonomyName: string,
	collections: string[],
	locale?: string,
): Promise<Map<string, number>> {
	const unique = [...new Set(collections)];
	for (const collection of unique) validateIdentifier(collection, "collection slug");
	if (unique.length === 0) return new Map();

	const limit = compoundSelectLimit(db);
	const batched = limit === null ? [unique] : chunks(unique, limit);
	const batches = await Promise.all(
		batched.map((batch) => runBatch(db, taxonomyName, batch, locale)),
	);

	const counts = new Map<string, number>();
	for (const batch of batches) addCounts(counts, batch);
	return counts;
}
