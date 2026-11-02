import { sql, type Kysely } from "kysely";

import type { Database } from "../../database/types.js";
import { validateIdentifier } from "../../database/validate.js";
import type { ApiResult } from "../types.js";

export interface SitemapContentEntry {
	id: string;
	slug: string | null;
	updatedAt: string;
	locale: string;
	translationGroup: string | null;
	image: string | null;
}

export interface SitemapCollectionData {
	collection: string;
	urlPattern: string | null;
	lastmod: string;
	entries: SitemapContentEntry[];
}

export interface SitemapDataResponse {
	collections: SitemapCollectionData[];
}

const SITEMAP_MAX_ENTRIES = 50_000;

const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}(:?\d{2})?)$/;

function toW3CDate(value: string): string {
	if (!value) return value;
	let normalized = value.trim();
	if (normalized.includes(" ") && !normalized.includes("T")) {
		normalized = normalized.replace(" ", "T");
	}
	if (!TZ_SUFFIX_RE.test(normalized)) {
		normalized += "Z";
	}
	const parsed = Date.parse(normalized);
	return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

export async function handleSitemapData(
	db: Kysely<Database>,
	collectionSlug?: string,
): Promise<ApiResult<SitemapDataResponse>> {
	try {
		let query = db
			.selectFrom("_emdash_collections")
			.select(["slug", "url_pattern"])
			.where("has_seo", "=", 1)
			.where("routable", "=", 1);

		if (collectionSlug) {
			query = query.where("slug", "=", collectionSlug);
		}

		const collections = await query.execute();

		const result: SitemapCollectionData[] = [];

		for (const col of collections) {
			try {
				validateIdentifier(col.slug, "collection slug");
			} catch {
				console.warn(`[SITEMAP] Skipping collection with invalid slug: ${col.slug}`);
				continue;
			}

			const tableName = `ec_${col.slug}`;

			try {
				const rows = await sql<{
					slug: string | null;
					id: string;
					updated_at: string;
					locale: string;
					translation_group: string | null;
					seo_image: string | null;
				}>`
					SELECT c.slug, c.id, c.updated_at, c.locale, c.translation_group, s.seo_image
					FROM ${sql.ref(tableName)} c
					LEFT JOIN _emdash_seo s
						ON s.collection = ${col.slug}
						AND s.content_id = c.id
					WHERE c.status = 'published'
					AND c.deleted_at IS NULL
					AND c.slug IS NOT NULL
					AND TRIM(c.slug) <> ''
					AND (s.seo_no_index IS NULL OR s.seo_no_index = 0)
					ORDER BY c.updated_at DESC
					LIMIT ${SITEMAP_MAX_ENTRIES}
				`.execute(db);

				if (rows.rows.length === 0) continue;

				const entries: SitemapContentEntry[] = [];
				for (const row of rows.rows) {
					entries.push({
						id: row.id,
						slug: row.slug,
						updatedAt: toW3CDate(row.updated_at),
						locale: row.locale,
						translationGroup: row.translation_group,
						image: row.seo_image ?? null,
					});
				}

				result.push({
					collection: col.slug,
					urlPattern: col.url_pattern,
					lastmod: toW3CDate(rows.rows[0].updated_at),
					entries,
				});
			} catch (err) {
				console.warn(`[SITEMAP] Failed to query collection "${col.slug}":`, err);
				continue;
			}
		}

		return { success: true, data: { collections: result } };
	} catch (error) {
		console.error("[SITEMAP_ERROR]", error);
		return {
			success: false,
			error: { code: "SITEMAP_ERROR", message: "Failed to generate sitemap data" },
		};
	}
}
