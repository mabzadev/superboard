import { sql } from "kysely";

import { BylineRepository } from "../database/repositories/byline.js";
import type { BylineSummary, ContentBylineCredit } from "../database/repositories/types.js";
import { validateIdentifier } from "../database/validate.js";
import { resolveLocaleChain } from "../i18n/resolve.js";
import { getDb } from "../loader.js";
import { requestCached } from "../request-cache.js";
import { isMissingTableError } from "../utils/db-errors.js";

export function invalidateBylineCache(): void {}

export async function getByline(id: string): Promise<BylineSummary | null> {
	const db = await getDb();
	const repo = new BylineRepository(db);
	return repo.findById(id);
}

export async function getBylineBySlug(
	slug: string,
	options?: { locale?: string },
): Promise<BylineSummary | null> {
	const chain = resolveLocaleChain(options?.locale);
	const cacheKey = `byline-by-slug:${slug}:${chain.length > 0 ? chain.join(",") : "*"}`;
	return requestCached(cacheKey, async () => {
		const db = await getDb();
		const repo = new BylineRepository(db);

		if (chain.length === 0) {
			return repo.findBySlug(slug);
		}

		for (const locale of chain) {
			const row = await repo.findBySlug(slug, { locale });
			if (row) return row;
		}
		return null;
	});
}

export async function getEntryBylines(
	collection: string,
	entryId: string,
	options?: { locale?: string },
): Promise<ContentBylineCredit[]> {
	validateIdentifier(collection, "collection");
	const db = await getDb();
	const repo = new BylineRepository(db);

	const localeOpt = options?.locale !== undefined ? { locale: options.locale } : undefined;
	const explicit = await repo.getContentBylines(collection, entryId, localeOpt);
	if (explicit.length > 0) {
		return explicit.map((c) => ({ ...c, source: "explicit" as const }));
	}

	const ctx = await getEntryContext(db, collection, entryId);
	if (ctx.primaryBylineId) return [];

	if (ctx.authorId) {
		const fallback = await repo.findByUserId(ctx.authorId, localeOpt);
		if (fallback) {
			return [{ byline: fallback, sortOrder: 0, roleLabel: null, source: "inferred" }];
		}
	}

	return [];
}

export interface BylineEntry {
	id: string;
	authorId: string | null;
	primaryBylineId?: string | null;
	locale?: string | null;
}

export async function getBylinesForEntries(
	collection: string,
	entries: BylineEntry[],
): Promise<Map<string, ContentBylineCredit[]>> {
	validateIdentifier(collection, "collection");
	const result = new Map<string, ContentBylineCredit[]>();

	for (const { id } of entries) {
		result.set(id, []);
	}

	if (entries.length === 0) {
		return result;
	}

	const db = await getDb();
	const repo = new BylineRepository(db);

	const buckets = new Map<string | null, BylineEntry[]>();
	for (const entry of entries) {
		const key = entry.locale ?? null;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(entry);
		else buckets.set(key, [entry]);
	}

	const explicitByEntry = new Map<string, ContentBylineCredit[]>();
	const entriesNeedingAuthorCheck: BylineEntry[] = [];
	const hydrationTargets: BylineSummary[] = [];
	for (const [locale, bucket] of buckets) {
		const localeOpt = locale ? { locale, skipHydration: true } : { skipHydration: true };
		const bucketIds = bucket.map((e) => e.id);
		let bylinesMap;
		try {
			bylinesMap = await repo.getContentBylinesMany(collection, bucketIds, localeOpt);
		} catch (error) {
			if (isMissingTableError(error)) return result;
			throw error;
		}
		for (const [id, list] of bylinesMap) {
			explicitByEntry.set(id, list);
			for (const credit of list) hydrationTargets.push(credit.byline);
		}

		for (const entry of bucket) {
			const hasResolved = bylinesMap.has(entry.id) && bylinesMap.get(entry.id)!.length > 0;
			if (hasResolved) continue;
			if (entry.authorId) entriesNeedingAuthorCheck.push(entry);
		}
	}

	const fallbackByEntry = new Map<string, BylineSummary>();
	if (entriesNeedingAuthorCheck.length > 0) {
		const authorBuckets = new Map<string | null, BylineEntry[]>();
		for (const entry of entriesNeedingAuthorCheck) {
			if (entry.primaryBylineId) continue;
			const key = entry.locale ?? null;
			const bucket = authorBuckets.get(key);
			if (bucket) bucket.push(entry);
			else authorBuckets.set(key, [entry]);
		}

		for (const [locale, bucket] of authorBuckets) {
			const localeOpt: { locale?: string; skipHydration: true } = locale
				? { locale, skipHydration: true }
				: { skipHydration: true };
			const authorIds = bucket.map((e) => e.authorId).filter((id): id is string => id !== null);
			const uniqueAuthorIds = [...new Set(authorIds)];
			if (uniqueAuthorIds.length === 0) continue;
			const authorBylineMap = await repo.findByUserIds(uniqueAuthorIds, localeOpt);
			for (const entry of bucket) {
				if (!entry.authorId) continue;
				const f = authorBylineMap.get(entry.authorId);
				if (f) {
					fallbackByEntry.set(entry.id, f);
					hydrationTargets.push(f);
				}
			}
		}
	}

	if (hydrationTargets.length > 0) {
		await repo.hydrateBylineCustomFields(hydrationTargets);
	}

	for (const { id } of entries) {
		const explicit = explicitByEntry.get(id);
		if (explicit && explicit.length > 0) {
			result.set(
				id,
				explicit.map((c) => ({ ...c, source: "explicit" as const })),
			);
			continue;
		}

		const fallback = fallbackByEntry.get(id);
		if (fallback) {
			result.set(id, [{ byline: fallback, sortOrder: 0, roleLabel: null, source: "inferred" }]);
		}
	}

	return result;
}

export async function getEntriesByByline(
	collection: string,
	byline: string | string[],
	options: {
		locale?: string;
		orderBy?: Record<string, "asc" | "desc">;
		status?: "draft" | "published" | "archived";
		limit?: number;
	} = {},
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
	const { getEmDashCollection } = await import("../query.js");

	const queryOptions: Record<string, unknown> = {
		where: { byline },
	};
	if (options.locale !== undefined) queryOptions.locale = options.locale;
	if (options.orderBy !== undefined) queryOptions.orderBy = options.orderBy;
	if (options.status !== undefined) queryOptions.status = options.status;
	if (options.limit !== undefined) queryOptions.limit = options.limit;

	const { entries } = await getEmDashCollection(collection, queryOptions);
	return entries;
}

async function getEntryContext(
	db: Awaited<ReturnType<typeof getDb>>,
	collection: string,
	entryId: string,
): Promise<{ authorId: string | null; primaryBylineId: string | null }> {
	validateIdentifier(collection, "collection");
	const tableName = `ec_${collection}`;

	const result = await sql<{
		author_id: string | null;
		primary_byline_id: string | null;
	}>`
		SELECT author_id, primary_byline_id FROM ${sql.ref(tableName)}
		WHERE id = ${entryId}
		LIMIT 1
	`.execute(db);

	const row = result.rows[0];
	return {
		authorId: row?.author_id ?? null,
		primaryBylineId: row?.primary_byline_id ?? null,
	};
}
