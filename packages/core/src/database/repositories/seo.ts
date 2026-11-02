import { sql, type Kysely } from "kysely";

import { invalidateCollectionCache } from "../../object-cache/index.js";
import { chunks, SQL_BATCH_SIZE } from "../../utils/chunks.js";
import type { Database } from "../types.js";
import type { ContentSeo, ContentSeoInput } from "./types.js";

const SEO_DEFAULTS: ContentSeo = {
	title: null,
	description: null,
	image: null,
	canonical: null,
	noIndex: false,
};

function hasAnyField(input: ContentSeoInput): boolean {
	return (
		input.title !== undefined ||
		input.description !== undefined ||
		input.image !== undefined ||
		input.canonical !== undefined ||
		input.noIndex !== undefined
	);
}

export class SeoRepository {
	constructor(private db: Kysely<Database>) {}

	async isEnabled(collection: string): Promise<boolean> {
		const row = await this.db
			.selectFrom("_emdash_collections")
			.select("has_seo")
			.where("slug", "=", collection)
			.executeTakeFirst();
		return row?.has_seo === 1;
	}

	async get(collection: string, contentId: string): Promise<ContentSeo> {
		const row = await this.db
			.selectFrom("_emdash_seo")
			.selectAll()
			.where("collection", "=", collection)
			.where("content_id", "=", contentId)
			.executeTakeFirst();

		if (!row) {
			return { ...SEO_DEFAULTS };
		}

		return {
			title: row.seo_title ?? null,
			description: row.seo_description ?? null,
			image: row.seo_image ?? null,
			canonical: row.seo_canonical ?? null,
			noIndex: row.seo_no_index === 1,
		};
	}

	async getMany(collection: string, contentIds: string[]): Promise<Map<string, ContentSeo>> {
		const result = new Map<string, ContentSeo>();

		if (contentIds.length === 0) return result;

		for (const id of contentIds) {
			result.set(id, { ...SEO_DEFAULTS });
		}

		const uniqueContentIds = [...new Set(contentIds)];
		for (const chunk of chunks(uniqueContentIds, SQL_BATCH_SIZE)) {
			const rows = await this.db
				.selectFrom("_emdash_seo")
				.selectAll()
				.where("collection", "=", collection)
				.where("content_id", "in", chunk)
				.execute();

			for (const row of rows) {
				result.set(row.content_id, {
					title: row.seo_title ?? null,
					description: row.seo_description ?? null,
					image: row.seo_image ?? null,
					canonical: row.seo_canonical ?? null,
					noIndex: row.seo_no_index === 1,
				});
			}
		}

		return result;
	}

	async upsert(collection: string, contentId: string, input: ContentSeoInput): Promise<ContentSeo> {
		if (!hasAnyField(input)) {
			return this.get(collection, contentId);
		}

		const now = new Date().toISOString();

		await sql`
			INSERT INTO _emdash_seo (
				collection, content_id,
				seo_title, seo_description, seo_image, seo_canonical, seo_no_index,
				created_at, updated_at
			) VALUES (
				${collection}, ${contentId},
				${input.title ?? null}, ${input.description ?? null},
				${input.image ?? null}, ${input.canonical ?? null},
				${input.noIndex ? 1 : 0},
				${now}, ${now}
			)
			ON CONFLICT (collection, content_id) DO UPDATE SET
				seo_title = ${input.title !== undefined ? sql`${input.title}` : sql`_emdash_seo.seo_title`},
				seo_description = ${input.description !== undefined ? sql`${input.description}` : sql`_emdash_seo.seo_description`},
				seo_image = ${input.image !== undefined ? sql`${input.image}` : sql`_emdash_seo.seo_image`},
				seo_canonical = ${input.canonical !== undefined ? sql`${input.canonical}` : sql`_emdash_seo.seo_canonical`},
				seo_no_index = ${input.noIndex !== undefined ? sql`${input.noIndex ? 1 : 0}` : sql`_emdash_seo.seo_no_index`},
				updated_at = ${now}
		`.execute(this.db);

		invalidateCollectionCache(collection);
		return this.get(collection, contentId);
	}

	async delete(collection: string, contentId: string): Promise<void> {
		await this.db
			.deleteFrom("_emdash_seo")
			.where("collection", "=", collection)
			.where("content_id", "=", contentId)
			.execute();
		invalidateCollectionCache(collection);
	}

	async copyForDuplicate(collection: string, sourceId: string, targetId: string): Promise<void> {
		const source = await this.get(collection, sourceId);

		if (
			source.title !== null ||
			source.description !== null ||
			source.image !== null ||
			source.noIndex
		) {
			await this.upsert(collection, targetId, {
				title: source.title,
				description: source.description,
				image: source.image,
				canonical: null,
				noIndex: source.noIndex,
			});
		}
	}
}
