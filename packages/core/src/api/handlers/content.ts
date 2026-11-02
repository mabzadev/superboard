import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { ContentFieldFilters } from "../../content-list-query.js";
import { isSqlite } from "../../database/dialect-helpers.js";
import { BylineRepository } from "../../database/repositories/byline.js";
import type { ContentBylineInput } from "../../database/repositories/byline.js";
import { CommentRepository } from "../../database/repositories/comment.js";
import { ContentRepository, isSystemOrderField } from "../../database/repositories/content.js";
import { RedirectRepository } from "../../database/repositories/redirect.js";
import { RevisionRepository } from "../../database/repositories/revision.js";
import { SeoRepository } from "../../database/repositories/seo.js";
import { TaxonomyRepository } from "../../database/repositories/taxonomy.js";
import {
	ContentCollectionNotFoundError,
	ContentMutationConflictError,
	EmDashValidationError,
	ScheduledNotDueError,
	InvalidCursorError,
	type BylineSummary,
	type ContentBylineCredit,
	type ContentBylineFilter,
	type ContentDateField,
	type ContentItem,
	type ContentSeo,
	type ContentSeoInput,
	type FindManyOptions,
} from "../../database/repositories/types.js";
import { UserRepository } from "../../database/repositories/user.js";
import { withTransaction } from "../../database/transaction.js";
import type { Database } from "../../database/types.js";
import { validateIdentifier } from "../../database/validate.js";
import { getI18nConfig, isI18nEnabled, resolveConfiguredLocale } from "../../i18n/config.js";
import { invalidateRedirectCache } from "../../redirects/cache.js";
import { FTSManager } from "../../search/fts-manager.js";
import { invalidateTermCache } from "../../taxonomies/index.js";
import { isMissingColumnError, isMissingTableError } from "../../utils/db-errors.js";
import { encodeRev, validateRev } from "../rev.js";
import type { ApiResult, ContentListResponse, ContentResponse } from "../types.js";
import { validateMediaFields } from "./validate-media-fields.js";

function hasApiError(error: unknown): error is Error & { apiError: { code: string } } {
	if (!(error instanceof Error) || !("apiError" in error)) return false;
	const { apiError } = error;
	return (
		typeof apiError === "object" &&
		apiError !== null &&
		"code" in apiError &&
		typeof apiError.code === "string"
	);
}

function getSlugSource(data: Record<string, unknown>): string | null {
	if (typeof data.title === "string" && data.title.length > 0) return data.title;
	if (typeof data.name === "string" && data.name.length > 0) return data.name;
	return null;
}

const SEO_DEFAULTS: ContentSeo = {
	title: null,
	description: null,
	image: null,
	canonical: null,
	noIndex: false,
};

async function collectionHasSeo(db: Kysely<Database>, collection: string): Promise<boolean> {
	const row = await db
		.selectFrom("_emdash_collections")
		.select("has_seo")
		.where("slug", "=", collection)
		.executeTakeFirst();
	return row?.has_seo === 1;
}

async function getCollectionPublishConfig(
	db: Kysely<Database>,
	collection: string,
): Promise<{ supportsRevisions: boolean; routable: boolean }> {
	const row = await db
		.selectFrom("_emdash_collections")
		.select(["supports", "routable"])
		.where("slug", "=", collection)
		.executeTakeFirst();
	const supports: unknown = row?.supports ? JSON.parse(row.supports) : [];
	return {
		supportsRevisions: Array.isArray(supports) && supports.includes("revisions"),
		routable: row?.routable !== 0,
	};
}

function requireRoutablePublishSlug(routable: boolean, slug: string | null | undefined): void {
	if (routable && !slug?.trim()) {
		throw new EmDashValidationError("Cannot publish routable content without a slug");
	}
}

async function hydrateSeo(
	db: Kysely<Database>,
	collection: string,
	item: ContentItem,
	hasSeo: boolean,
): Promise<void> {
	if (!hasSeo) return;
	const seoRepo = new SeoRepository(db);
	item.seo = await seoRepo.get(collection, item.id);
}

async function hydrateSeoMany(
	db: Kysely<Database>,
	collection: string,
	items: ContentItem[],
	hasSeo: boolean,
): Promise<void> {
	if (!hasSeo || items.length === 0) return;
	const seoRepo = new SeoRepository(db);
	const seoMap = await seoRepo.getMany(
		collection,
		items.map((i) => i.id),
	);
	for (const item of items) {
		item.seo = seoMap.get(item.id) ?? { ...SEO_DEFAULTS };
	}
}

async function hydrateBylines(
	db: Kysely<Database>,
	collection: string,
	item: ContentItem,
): Promise<void> {
	const bylineRepo = new BylineRepository(db);
	const localeOpt = item.locale ? { locale: item.locale } : undefined;
	const bylines = await bylineRepo.getContentBylines(collection, item.id, localeOpt);

	if (bylines.length > 0) {
		item.bylines = bylines.map((c) => ({ ...c, source: "explicit" as const }));
		item.byline = bylines[0]?.byline ?? null;
		return;
	}

	if (item.primaryBylineId) {
		item.bylines = [];
		item.byline = null;
		return;
	}

	if (item.authorId) {
		const fallback = await bylineRepo.findByUserId(item.authorId, localeOpt);
		if (fallback) {
			item.bylines = [{ byline: fallback, sortOrder: 0, roleLabel: null, source: "inferred" }];
			item.byline = fallback;
			return;
		}
	}

	item.bylines = [];
	item.byline = null;
}

async function hydrateBylinesMany(
	db: Kysely<Database>,
	collection: string,
	items: ContentItem[],
): Promise<void> {
	if (items.length === 0) return;

	const bylineRepo = new BylineRepository(db);

	const localeBuckets = new Map<string | null, ContentItem[]>();
	for (const item of items) {
		const key = item.locale ?? null;
		const bucket = localeBuckets.get(key);
		if (bucket) bucket.push(item);
		else localeBuckets.set(key, [item]);
	}

	const bylinesByItem = new Map<string, ContentBylineCredit[]>();
	const itemsNeedingAuthorCheck: ContentItem[] = [];
	for (const [locale, bucket] of localeBuckets) {
		const localeOpt = locale ? { locale } : undefined;
		const ids = bucket.map((i) => i.id);
		const credits = await bylineRepo.getContentBylinesMany(collection, ids, localeOpt);
		for (const [id, list] of credits) bylinesByItem.set(id, list);

		for (const item of bucket) {
			if (credits.has(item.id) && credits.get(item.id)!.length > 0) continue;
			if (item.authorId) itemsNeedingAuthorCheck.push(item);
		}
	}

	const fallbackByItem = new Map<string, BylineSummary>();
	if (itemsNeedingAuthorCheck.length > 0) {
		const authorBuckets = new Map<string | null, ContentItem[]>();
		for (const item of itemsNeedingAuthorCheck) {
			if (item.primaryBylineId) continue;
			const key = item.locale ?? null;
			const bucket = authorBuckets.get(key);
			if (bucket) bucket.push(item);
			else authorBuckets.set(key, [item]);
		}

		for (const [locale, bucket] of authorBuckets) {
			const localeOpt = locale ? { locale } : undefined;
			const authorIds = bucket.map((i) => i.authorId).filter((id): id is string => id !== null);
			const uniqueAuthorIds = [...new Set(authorIds)];
			if (uniqueAuthorIds.length === 0) continue;
			const authorMap = await bylineRepo.findByUserIds(uniqueAuthorIds, localeOpt);
			for (const item of bucket) {
				if (!item.authorId) continue;
				const f = authorMap.get(item.authorId);
				if (f) fallbackByItem.set(item.id, f);
			}
		}
	}

	for (const item of items) {
		const explicit = bylinesByItem.get(item.id);
		if (explicit && explicit.length > 0) {
			item.bylines = explicit.map((c) => ({ ...c, source: "explicit" as const }));
			item.byline = explicit[0]?.byline ?? null;
			continue;
		}

		const fallback = fallbackByItem.get(item.id);
		if (fallback) {
			item.bylines = [{ byline: fallback, sortOrder: 0, roleLabel: null, source: "inferred" }];
			item.byline = fallback;
			continue;
		}

		item.bylines = [];
		item.byline = null;
	}
}

async function resolveId(
	repo: ContentRepository,
	collection: string,
	identifier: string,
	locale?: string,
): Promise<string | null> {
	const item = await repo.findByIdOrSlug(
		collection,
		identifier,
		locale ? resolveConfiguredLocale(locale) : undefined,
	);
	return item?.id ?? null;
}

async function resolveIdIncludingTrashed(
	repo: ContentRepository,
	collection: string,
	identifier: string,
	locale?: string,
): Promise<string | null> {
	const item = await repo.findByIdOrSlugIncludingTrashed(
		collection,
		identifier,
		locale ? resolveConfiguredLocale(locale) : undefined,
	);
	return item?.id ?? null;
}

export interface TrashedContentItem {
	id: string;
	type: string;
	slug: string | null;
	status: string;
	data: Record<string, unknown>;
	authorId: string | null;
	createdAt: string;
	updatedAt: string;
	publishedAt: string | null;
	deletedAt: string;
}

async function resolveSearchColumns(db: Kysely<Database>, collection: string): Promise<string[]> {
	const row = await db
		.selectFrom("_emdash_collections")
		.select(["id", "title_field"])
		.where("slug", "=", collection)
		.executeTakeFirst();
	if (!row) return ["slug"];

	const fields = await db
		.selectFrom("_emdash_fields")
		.select(["slug", "searchable"])
		.where("collection_id", "=", row.id)
		.orderBy("sort_order", "asc")
		.execute();
	const columns = new Set(["slug"]);
	const fieldSlugs = new Set(fields.map((f) => f.slug));

	if (row.title_field && fieldSlugs.has(row.title_field)) columns.add(row.title_field);
	for (const candidate of ["title", "name"]) {
		if (fieldSlugs.has(candidate)) columns.add(candidate);
	}
	for (const field of fields) {
		if (field.searchable === 1) columns.add(field.slug);
	}
	return [...columns];
}

async function canUseFtsForListFilter(
	db: Kysely<Database>,
	collection: string,
	searchColumns: string[],
): Promise<boolean> {
	if (!isSqlite(db)) return false;
	const ftsManager = new FTSManager(db);
	const config = await ftsManager.getSearchConfig(collection);
	if (!config?.enabled) return false;
	const searchable = new Set(await ftsManager.getSearchableFields(collection));
	const covered = searchColumns.every((col) => col === "slug" || searchable.has(col));
	if (!covered) return false;
	return ftsManager.ftsTableExists(collection);
}

async function createSlugChangeRedirect(
	db: Kysely<Database>,
	collection: string,
	oldSlug: string,
	newSlug: string,
	contentId: string,
): Promise<void> {
	if (await slugStillTaken(db, collection, oldSlug, contentId)) return;

	const collectionRow = await db
		.selectFrom("_emdash_collections")
		.select("url_pattern")
		.where("slug", "=", collection)
		.executeTakeFirst();

	const redirectRepo = new RedirectRepository(db);
	await redirectRepo.createAutoRedirect(
		collection,
		oldSlug,
		newSlug,
		contentId,
		collectionRow?.url_pattern ?? null,
	);
	invalidateRedirectCache();
}

async function slugStillTaken(
	db: Kysely<Database>,
	collection: string,
	slug: string,
	contentId: string,
): Promise<boolean> {
	validateIdentifier(collection, "collection slug");
	const result = await sql<{ id: string }>`
		SELECT id FROM ${sql.ref(`ec_${collection}`)}
		WHERE slug = ${slug}
		AND id != ${contentId}
		AND deleted_at IS NULL
		LIMIT 1
	`.execute(db);
	return result.rows.length > 0;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateBound(value: string | undefined, edge: "start" | "end"): string | undefined {
	if (!value) return undefined;
	if (!DATE_ONLY_RE.test(value)) return value;
	return edge === "start" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
}

function resolveBylineFilter(
	params: { bylines?: string[]; bylinesNone?: boolean; includeInferredBylines?: boolean },
	locale: string | undefined,
): ContentBylineFilter | undefined {
	const includeInferred = params.includeInferredBylines === true;

	if (params.bylinesNone) return { mode: "none", includeInferred, locale };

	const bylineIds = params.bylines ?? [];
	if (bylineIds.length === 0) return undefined;

	return { mode: "any", bylineIds, includeInferred, locale };
}

export async function handleContentList(
	db: Kysely<Database>,
	collection: string,
	params: {
		cursor?: string;
		limit?: number;
		status?: string;
		orderBy?: string;
		order?: "asc" | "desc";
		locale?: string;
		q?: string;
		authorId?: string;
		dateField?: ContentDateField;
		dateFrom?: string;
		dateTo?: string;
		bylines?: string[];
		bylinesNone?: boolean;
		includeInferredBylines?: boolean;
		fieldFilters?: ContentFieldFilters;
	},
): Promise<ApiResult<ContentListResponse>> {
	try {
		const repo = new ContentRepository(db);
		const where: FindManyOptions["where"] = {};
		if (params.status) where.status = params.status;
		const locale = params.locale ? resolveConfiguredLocale(params.locale) : undefined;
		if (locale) where.locale = locale;
		if (params.authorId) where.authorId = params.authorId;
		if (params.fieldFilters && Object.keys(params.fieldFilters).length > 0) {
			where.fieldFilters = params.fieldFilters;
		}

		const bylineFilter = resolveBylineFilter(params, locale);
		if (bylineFilter) where.bylineFilter = bylineFilter;

		if (params.dateField && (params.dateFrom || params.dateTo)) {
			where.dateFilter = {
				field: params.dateField,
				from: normalizeDateBound(params.dateFrom, "start"),
				to: normalizeDateBound(params.dateTo, "end"),
			};
		}

		const q = params.q?.trim();
		if (q) {
			where.q = q;
			where.searchColumns = await resolveSearchColumns(db, collection);
			where.useFts = await canUseFtsForListFilter(db, collection, where.searchColumns);
		}

		let sortableExtras: string[] | undefined;
		if (params.orderBy && !isSystemOrderField(params.orderBy)) {
			const coll = await db
				.selectFrom("_emdash_collections")
				.select(["title_field", "date_field"])
				.where("slug", "=", collection)
				.executeTakeFirst();
			sortableExtras = [coll?.title_field, coll?.date_field].filter(
				(slug): slug is string => !!slug,
			);
		}

		const result = await repo.findMany(collection, {
			cursor: params.cursor,
			limit: params.limit || 50,
			where: Object.keys(where).length > 0 ? where : undefined,
			orderBy: params.orderBy
				? { field: params.orderBy, direction: params.order || "desc" }
				: undefined,
			sortableExtras,
		});

		const hasSeo = await collectionHasSeo(db, collection);
		await hydrateSeoMany(db, collection, result.items, hasSeo);
		await hydrateBylinesMany(db, collection, result.items);

		return {
			success: true,
			data: {
				items: result.items,
				nextCursor: result.nextCursor,
				total: result.total,
			},
		};
	} catch (error) {
		if (error instanceof InvalidCursorError) {
			return {
				success: false,
				error: { code: "INVALID_CURSOR", message: error.message },
			};
		}
		if (error instanceof ContentCollectionNotFoundError || isMissingTableError(error)) {
			return {
				success: false,
				error: {
					code: "COLLECTION_NOT_FOUND",
					message: `Collection '${collection}' not found`,
				},
			};
		}
		if (isMissingColumnError(error, "deleted_at")) {
			return {
				success: false,
				error: {
					code: "COLLECTION_SCHEMA_MISMATCH",
					message: `Collection '${collection}' backing table is missing the 'deleted_at' column`,
				},
			};
		}
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: { code: "VALIDATION_ERROR", message: error.message },
			};
		}
		console.error("Content list error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_LIST_ERROR",
				message: "Failed to list content",
			},
		};
	}
}

export interface ContentAuthor {
	id: string;
	name: string | null;
	email: string;
	avatarUrl: string | null;
}

export async function handleContentAuthors(
	db: Kysely<Database>,
	collection: string,
): Promise<ApiResult<{ items: ContentAuthor[] }>> {
	try {
		const repo = new ContentRepository(db);
		const authorIds = await repo.findDistinctAuthorIds(collection);
		if (authorIds.length === 0) {
			return { success: true, data: { items: [] } };
		}

		const userRepo = new UserRepository(db);
		const users = await userRepo.findByIds(authorIds);

		const items: ContentAuthor[] = users
			.map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl }))
			.toSorted((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

		return { success: true, data: { items } };
	} catch (error) {
		if (isMissingTableError(error)) {
			return {
				success: false,
				error: {
					code: "COLLECTION_NOT_FOUND",
					message: `Collection '${collection}' not found`,
				},
			};
		}
		console.error("Content authors error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_AUTHORS_ERROR",
				message: "Failed to list content authors",
			},
		};
	}
}

export async function handleContentGet(
	db: Kysely<Database>,
	collection: string,
	id: string,
	locale?: string,
): Promise<ApiResult<ContentResponse>> {
	try {
		const repo = new ContentRepository(db);
		const item = await repo.findByIdOrSlug(
			collection,
			id,
			locale ? resolveConfiguredLocale(locale) : undefined,
		);

		if (!item) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `Content item not found: ${id}`,
				},
			};
		}

		const hasSeo = await collectionHasSeo(db, collection);
		await hydrateSeo(db, collection, item, hasSeo);
		await hydrateBylines(db, collection, item);

		return {
			success: true,
			data: { item, _rev: encodeRev(item) },
		};
	} catch (error) {
		console.error("Content get error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_GET_ERROR",
				message: "Failed to get content",
			},
		};
	}
}

export async function handleContentGetIncludingTrashed(
	db: Kysely<Database>,
	collection: string,
	id: string,
	locale?: string,
): Promise<ApiResult<ContentResponse>> {
	try {
		const repo = new ContentRepository(db);
		const item = await repo.findByIdOrSlugIncludingTrashed(
			collection,
			id,
			locale ? resolveConfiguredLocale(locale) : undefined,
		);

		if (!item) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `Content item not found: ${id}`,
				},
			};
		}

		const hasSeo = await collectionHasSeo(db, collection);
		await hydrateSeo(db, collection, item, hasSeo);
		await hydrateBylines(db, collection, item);

		return {
			success: true,
			data: { item, _rev: encodeRev(item) },
		};
	} catch (error) {
		console.error("Content get error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_GET_ERROR",
				message: "Failed to get content",
			},
		};
	}
}

export async function handleContentCreate(
	db: Kysely<Database>,
	collection: string,
	body: {
		data: Record<string, unknown>;
		slug?: string | null;
		status?: string;
		authorId?: string;
		bylines?: ContentBylineInput[];
		locale?: string;
		translationOf?: string;
		seo?: ContentSeoInput;
		taxonomies?: Record<string, string[]>;
		createdAt?: string | null;
		publishedAt?: string | null;
	},
): Promise<ApiResult<ContentResponse>> {
	try {
		const hasSeo = await collectionHasSeo(db, collection);

		if (body.seo && !hasSeo) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: `Collection "${collection}" does not have SEO enabled. Remove the seo field or enable SEO on this collection.`,
				},
			};
		}

		const mimeCheck = await validateMediaFields(db, collection, body.data);
		if (!mimeCheck.success) return mimeCheck;

		const item = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const bylineRepo = new BylineRepository(trx);

			const effectiveLocale = body.locale
				? resolveConfiguredLocale(body.locale)
				: getI18nConfig()?.defaultLocale;

			let slug: string | null | undefined = body.slug;
			if (!slug) {
				const slugSource = getSlugSource(body.data);
				if (slugSource) {
					slug = await repo.generateUniqueSlug(collection, slugSource, effectiveLocale);
				}
			}
			if (body.status === "published") {
				const publishConfig = await getCollectionPublishConfig(trx, collection);
				requireRoutablePublishSlug(publishConfig.routable, slug);
			}

			const created = await repo.create({
				type: collection,
				slug,
				data: body.data,
				status: body.status || "draft",
				authorId: body.authorId,
				locale: effectiveLocale,
				translationOf: body.translationOf,
				createdAt: body.createdAt,
				publishedAt: body.publishedAt,
			});

			if (body.bylines !== undefined) {
				const credits = await bylineRepo.setContentBylines(collection, created.id, body.bylines);
				created.primaryBylineId = credits[0]?.byline.translationGroup ?? null;
			}

			if (body.translationOf) {
				if (body.bylines === undefined) {
					await bylineRepo.copyContentBylines(collection, body.translationOf, created.id);
					const source = await repo.findById(collection, body.translationOf);
					if (source) created.primaryBylineId = source.primaryBylineId;
				}
			}

			await hydrateBylines(trx, collection, created);

			if (body.seo && hasSeo) {
				const seoRepo = new SeoRepository(trx);
				created.seo = await seoRepo.upsert(collection, created.id, body.seo);
			} else if (hasSeo) {
				created.seo = { ...SEO_DEFAULTS };
			}

			if (body.taxonomies) {
				await assignTaxonomies(trx, collection, created.id, effectiveLocale, body.taxonomies);
			}

			return created;
		});

		return {
			success: true,
			data: { item, _rev: encodeRev(item) },
		};
	} catch (error) {
		if (isMissingTableError(error)) {
			return {
				success: false,
				error: {
					code: "COLLECTION_NOT_FOUND",
					message: `Collection '${collection}' not found`,
				},
			};
		}
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: { code: "VALIDATION_ERROR", message: error.message },
			};
		}
		const message = error instanceof Error ? error.message.toLowerCase() : "";
		if (message.includes("unique constraint failed") || message.includes("duplicate key")) {
			if (message.includes("slug")) {
				return {
					success: false,
					error: {
						code: "SLUG_CONFLICT",
						message: `Slug '${body.slug ?? "(auto-generated)"}' already exists in collection '${collection}'`,
					},
				};
			}
			return {
				success: false,
				error: {
					code: "CONFLICT",
					message: "Unique constraint violation",
				},
			};
		}
		console.error("Content create error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_CREATE_ERROR",
				message: "Failed to create content",
			},
		};
	}
}

export async function handleContentUpdate(
	db: Kysely<Database>,
	collection: string,
	id: string,
	body: {
		data?: Record<string, unknown>;
		slug?: string | null;
		status?: string;
		authorId?: string | null;
		bylines?: ContentBylineInput[];
		locale?: string;
		_rev?: string;
		seo?: ContentSeoInput;
		taxonomies?: Record<string, string[]>;
		publishedAt?: string | null;
	},
): Promise<ApiResult<ContentResponse>> {
	try {
		const hasSeo = await collectionHasSeo(db, collection);

		if (body.seo && !hasSeo) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: `Collection "${collection}" does not have SEO enabled. Remove the seo field or enable SEO on this collection.`,
				},
			};
		}

		if (body.data) {
			const mimeCheck = await validateMediaFields(db, collection, body.data);
			if (!mimeCheck.success) return mimeCheck;
		}

		const repo = new ContentRepository(db);

		const resolvedId = (await resolveId(repo, collection, id, body.locale)) ?? id;

		const item = await withTransaction(db, async (trx) => {
			const trxRepo = new ContentRepository(trx);
			const bylineRepo = new BylineRepository(trx);

			const existing =
				body._rev || body.slug !== undefined || body.status === "published"
					? await trxRepo.findById(collection, resolvedId)
					: null;

			if (body._rev) {
				if (!existing) {
					throw Object.assign(new Error(`Content item not found: ${id}`), {
						apiError: { code: "NOT_FOUND" as const },
					});
				}

				const revCheck = validateRev(body._rev, existing);
				if (!revCheck.valid) {
					throw Object.assign(new Error(revCheck.message), {
						apiError: { code: "CONFLICT" as const },
					});
				}
			}

			let oldSlug: string | undefined;
			if (body.slug && existing?.slug && existing.slug !== body.slug) {
				oldSlug = existing.slug;
			}

			const resultingStatus = body.status ?? existing?.status;
			if (resultingStatus === "published") {
				if (!existing) {
					throw Object.assign(new Error(`Content item not found: ${id}`), {
						apiError: { code: "NOT_FOUND" as const },
					});
				}
				const publishConfig = await getCollectionPublishConfig(trx, collection);
				const intendedSlug = body.slug !== undefined ? body.slug : existing.slug;
				requireRoutablePublishSlug(publishConfig.routable, intendedSlug);
			}

			const updated = await trxRepo.update(collection, resolvedId, {
				data: body.data,
				slug: body.slug,
				status: body.status,
				authorId: body.authorId,
				publishedAt: body.publishedAt,
			});

			if (body.bylines !== undefined) {
				const credits = await bylineRepo.setContentBylines(collection, resolvedId, body.bylines);
				updated.primaryBylineId = credits[0]?.byline.translationGroup ?? null;
			}

			if (oldSlug && body.slug) {
				await createSlugChangeRedirect(trx, collection, oldSlug, body.slug, resolvedId);
			}

			if (isI18nEnabled() && body.data && updated.translationGroup) {
				await syncNonTranslatableFields(
					trx,
					collection,
					updated.id,
					updated.translationGroup,
					body.data,
				);
			}

			if (body.seo && hasSeo) {
				const seoRepo = new SeoRepository(trx);
				updated.seo = await seoRepo.upsert(collection, resolvedId, body.seo);
			} else if (hasSeo) {
				const seoRepo = new SeoRepository(trx);
				updated.seo = await seoRepo.get(collection, resolvedId);
			}

			await hydrateBylines(trx, collection, updated);

			if (body.taxonomies) {
				await assignTaxonomies(
					trx,
					collection,
					resolvedId,
					updated.locale ?? body.locale,
					body.taxonomies,
				);
			}

			return updated;
		});

		return {
			success: true,
			data: { item, _rev: encodeRev(item) },
		};
	} catch (error) {
		if (hasApiError(error)) {
			return {
				success: false,
				error: { code: error.apiError.code, message: error.message },
			};
		}
		if (isMissingTableError(error)) {
			return {
				success: false,
				error: {
					code: "COLLECTION_NOT_FOUND",
					message: `Collection '${collection}' not found`,
				},
			};
		}
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: { code: "VALIDATION_ERROR", message: error.message },
			};
		}
		const message = error instanceof Error ? error.message.toLowerCase() : "";
		if (message.includes("unique constraint failed") || message.includes("duplicate key")) {
			if (message.includes("slug")) {
				return {
					success: false,
					error: {
						code: "SLUG_CONFLICT",
						message: `Slug '${body.slug ?? id}' already exists in collection '${collection}'`,
					},
				};
			}
			return {
				success: false,
				error: {
					code: "CONFLICT",
					message: "Unique constraint violation",
				},
			};
		}
		console.error("Content update error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_UPDATE_ERROR",
				message: "Failed to update content",
			},
		};
	}
}

export async function handleContentDuplicate(
	db: Kysely<Database>,
	collection: string,
	id: string,
	authorId?: string,
): Promise<ApiResult<{ item: ContentItem }>> {
	try {
		const hasSeo = await collectionHasSeo(db, collection);

		const duplicate = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const bylineRepo = new BylineRepository(trx);
			const resolvedId = (await resolveId(repo, collection, id)) ?? id;
			const dup = await repo.duplicate(collection, resolvedId, authorId);

			const existingBylines = await bylineRepo.getContentBylines(collection, resolvedId);
			if (existingBylines.length > 0) {
				await bylineRepo.setContentBylines(
					collection,
					dup.id,
					existingBylines.map((entry) => ({
						bylineId: entry.byline.id,
						roleLabel: entry.roleLabel,
					})),
				);
			}

			if (hasSeo) {
				const seoRepo = new SeoRepository(trx);
				await seoRepo.copyForDuplicate(collection, resolvedId, dup.id);
				dup.seo = await seoRepo.get(collection, dup.id);
			}

			await hydrateBylines(trx, collection, dup);

			return dup;
		});

		return {
			success: true,
			data: { item: duplicate },
		};
	} catch (err) {
		if (err instanceof EmDashValidationError) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: err.message,
				},
			};
		}
		console.error("Content duplicate error:", err);
		return {
			success: false,
			error: {
				code: "CONTENT_DUPLICATE_ERROR",
				message: "Failed to duplicate content",
			},
		};
	}
}

export async function handleContentDelete(
	db: Kysely<Database>,
	collection: string,
	id: string,
): Promise<ApiResult<{ deleted: true; id: string }>> {
	try {
		const result = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const resolvedId = (await resolveId(repo, collection, id)) ?? id;
			return {
				id: resolvedId,
				deleted: await repo.delete(collection, resolvedId),
			};
		});

		if (!result.deleted) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `Content item not found: ${id}`,
				},
			};
		}

		return {
			success: true,
			data: { deleted: true, id: result.id },
		};
	} catch (error) {
		console.error("Content delete error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_DELETE_ERROR",
				message: "Failed to delete content",
			},
		};
	}
}

export async function handleContentRestore(
	db: Kysely<Database>,
	collection: string,
	id: string,
): Promise<ApiResult<{ restored: true; item: ContentItem }>> {
	try {
		const item = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const resolvedId = (await resolveIdIncludingTrashed(repo, collection, id)) ?? id;
			return repo.restore(collection, resolvedId);
		});

		if (!item) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `Trashed content item not found: ${id}`,
				},
			};
		}

		return {
			success: true,
			data: { restored: true, item },
		};
	} catch (error) {
		console.error("Content restore error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_RESTORE_ERROR",
				message: "Failed to restore content",
			},
		};
	}
}

export async function handleContentPermanentDelete(
	db: Kysely<Database>,
	collection: string,
	id: string,
): Promise<ApiResult<{ deleted: true; id: string }>> {
	try {
		const repo = new ContentRepository(db);
		const resolvedId = (await resolveIdIncludingTrashed(repo, collection, id)) ?? id;

		const deleted = await withTransaction(db, async (trx) => {
			const trxRepo = new ContentRepository(trx);
			const wasDeleted = await trxRepo.permanentDelete(collection, resolvedId);

			if (wasDeleted) {
				const seoRepo = new SeoRepository(trx);
				await seoRepo.delete(collection, resolvedId);
				const commentRepo = new CommentRepository(trx);
				await commentRepo.deleteByContent(collection, resolvedId);
				const revisionRepo = new RevisionRepository(trx);
				await revisionRepo.deleteByEntry(collection, resolvedId);
			}

			return wasDeleted;
		});

		if (!deleted) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `Content item not found: ${id}`,
				},
			};
		}

		return {
			success: true,
			data: { deleted: true, id: resolvedId },
		};
	} catch (error) {
		console.error("Content permanent delete error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_DELETE_ERROR",
				message: "Failed to permanently delete content",
			},
		};
	}
}

export async function handleContentListTrashed(
	db: Kysely<Database>,
	collection: string,
	options: { limit?: number; cursor?: string } = {},
): Promise<ApiResult<{ items: TrashedContentItem[]; nextCursor?: string }>> {
	try {
		const repo = new ContentRepository(db);
		const result = await repo.findTrashed(collection, {
			limit: options.limit,
			cursor: options.cursor,
		});

		return {
			success: true,
			data: {
				items: result.items.map((item) => ({
					id: item.id,
					type: item.type,
					slug: item.slug,
					status: item.status,
					data: item.data,
					authorId: item.authorId,
					createdAt: item.createdAt,
					updatedAt: item.updatedAt,
					publishedAt: item.publishedAt,
					deletedAt: item.deletedAt,
				})),
				nextCursor: result.nextCursor,
			},
		};
	} catch (error) {
		if (error instanceof InvalidCursorError) {
			return {
				success: false,
				error: { code: "INVALID_CURSOR", message: error.message },
			};
		}
		console.error("Content list trashed error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_LIST_ERROR",
				message: "Failed to list trashed content",
			},
		};
	}
}

export async function handleContentCountTrashed(
	db: Kysely<Database>,
	collection: string,
): Promise<ApiResult<{ count: number }>> {
	try {
		const repo = new ContentRepository(db);
		const count = await repo.countTrashed(collection);

		return {
			success: true,
			data: { count },
		};
	} catch (error) {
		console.error("Content count trashed error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_COUNT_ERROR",
				message: "Failed to count trashed content",
			},
		};
	}
}

export async function handleContentSchedule(
	db: Kysely<Database>,
	collection: string,
	id: string,
	scheduledAt: string,
): Promise<ApiResult<ContentResponse>> {
	try {
		const item = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const existing = await repo.findByIdOrSlug(collection, id);
			const resolvedId = existing?.id ?? id;
			if (existing) {
				const publishConfig = await getCollectionPublishConfig(trx, collection);
				requireRoutablePublishSlug(publishConfig.routable, existing.slug);
			}
			return repo.schedule(collection, resolvedId, scheduledAt);
		});

		const hasSeo = await collectionHasSeo(db, collection);
		await hydrateSeo(db, collection, item, hasSeo);

		return {
			success: true,
			data: { item },
		};
	} catch (error) {
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: error.message,
				},
			};
		}
		console.error("Content schedule error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_SCHEDULE_ERROR",
				message: "Failed to schedule content",
			},
		};
	}
}

export async function handleContentUnschedule(
	db: Kysely<Database>,
	collection: string,
	id: string,
): Promise<ApiResult<ContentResponse>> {
	try {
		const item = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const resolvedId = (await resolveId(repo, collection, id)) ?? id;
			return repo.unschedule(collection, resolvedId);
		});

		const hasSeo = await collectionHasSeo(db, collection);
		await hydrateSeo(db, collection, item, hasSeo);

		return {
			success: true,
			data: { item },
		};
	} catch (error) {
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: error.message,
				},
			};
		}
		console.error("Content unschedule error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_UNSCHEDULE_ERROR",
				message: "Failed to unschedule content",
			},
		};
	}
}

export async function handleContentPublish(
	db: Kysely<Database>,
	collection: string,
	id: string,
	options: {
		publishedAt?: string;
		requireScheduledDue?: boolean;
		expectedScheduledAt?: string;
	} = {},
): Promise<ApiResult<ContentResponse>> {
	try {
		const item = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const resolvedId = (await resolveId(repo, collection, id)) ?? id;
			const publishConfig = await getCollectionPublishConfig(trx, collection);

			const existing = await repo.findById(collection, resolvedId);

			const published = await repo.publish(
				collection,
				resolvedId,
				options.publishedAt,
				options.requireScheduledDue,
				options.expectedScheduledAt,
				publishConfig.supportsRevisions,
				publishConfig.routable,
			);

			if (
				existing?.status === "published" &&
				existing.slug &&
				published.slug &&
				existing.slug !== published.slug
			) {
				await createSlugChangeRedirect(trx, collection, existing.slug, published.slug, resolvedId);
			}

			return published;
		});

		const hasSeo = await collectionHasSeo(db, collection);
		await hydrateSeo(db, collection, item, hasSeo);

		return {
			success: true,
			data: { item },
		};
	} catch (error) {
		if (error instanceof ContentMutationConflictError) {
			return {
				success: false,
				error: {
					code: "CONFLICT",
					message: error.message,
				},
			};
		}
		if (error instanceof ScheduledNotDueError) {
			return {
				success: false,
				error: {
					code: "NOT_DUE",
					message: error.message,
				},
			};
		}
		if (error instanceof EmDashValidationError) {
			const details: unknown = error.details;
			const isSlugConflict =
				typeof details === "object" &&
				details !== null &&
				"code" in details &&
				details.code === "SLUG_CONFLICT";
			return {
				success: false,
				error: {
					code: isSlugConflict ? "SLUG_CONFLICT" : "VALIDATION_ERROR",
					message: error.message,
				},
			};
		}
		const message = error instanceof Error ? error.message.toLowerCase() : "";
		if (
			(message.includes("unique constraint failed") || message.includes("duplicate key")) &&
			message.includes("slug")
		) {
			return {
				success: false,
				error: {
					code: "SLUG_CONFLICT",
					message: `The staged slug is already used by another entry in collection '${collection}'`,
				},
			};
		}
		console.error("Content publish error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_PUBLISH_ERROR",
				message: "Failed to publish content",
			},
		};
	}
}

export async function handleContentUnpublish(
	db: Kysely<Database>,
	collection: string,
	id: string,
): Promise<ApiResult<ContentResponse>> {
	try {
		const item = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const resolvedId = (await resolveId(repo, collection, id)) ?? id;
			return repo.unpublish(collection, resolvedId);
		});

		const hasSeo = await collectionHasSeo(db, collection);
		await hydrateSeo(db, collection, item, hasSeo);

		return {
			success: true,
			data: { item },
		};
	} catch (error) {
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: error.message,
				},
			};
		}
		console.error("Content unpublish error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_UNPUBLISH_ERROR",
				message: "Failed to unpublish content",
			},
		};
	}
}

export async function handleContentCountScheduled(
	db: Kysely<Database>,
	collection: string,
): Promise<ApiResult<{ count: number }>> {
	try {
		const repo = new ContentRepository(db);
		const count = await repo.countScheduled(collection);

		return {
			success: true,
			data: { count },
		};
	} catch (error) {
		console.error("Content count scheduled error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_COUNT_ERROR",
				message: "Failed to count scheduled content",
			},
		};
	}
}

export async function handleContentDiscardDraft(
	db: Kysely<Database>,
	collection: string,
	id: string,
): Promise<ApiResult<ContentResponse>> {
	try {
		const item = await withTransaction(db, async (trx) => {
			const repo = new ContentRepository(trx);
			const resolvedId = (await resolveId(repo, collection, id)) ?? id;
			return repo.discardDraft(collection, resolvedId);
		});

		const hasSeo = await collectionHasSeo(db, collection);
		await hydrateSeo(db, collection, item, hasSeo);

		return {
			success: true,
			data: { item },
		};
	} catch (error) {
		if (error instanceof EmDashValidationError) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: error.message,
				},
			};
		}
		console.error("Content discard draft error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_DISCARD_DRAFT_ERROR",
				message: "Failed to discard draft",
			},
		};
	}
}

export async function handleContentCompare(
	db: Kysely<Database>,
	collection: string,
	id: string,
): Promise<
	ApiResult<{
		hasChanges: boolean;
		live: Record<string, unknown> | null;
		draft: Record<string, unknown> | null;
	}>
> {
	try {
		const repo = new ContentRepository(db);
		const entry = await repo.findByIdOrSlug(collection, id);

		if (!entry) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `Content item not found: ${id}`,
				},
			};
		}

		const revisionRepo = new RevisionRepository(db);

		const live = entry.liveRevisionId ? await revisionRepo.findById(entry.liveRevisionId) : null;
		const draft = entry.draftRevisionId ? await revisionRepo.findById(entry.draftRevisionId) : null;

		return {
			success: true,
			data: {
				hasChanges:
					entry.draftRevisionId !== null && entry.draftRevisionId !== entry.liveRevisionId,
				live: live?.data ?? null,
				draft: draft?.data ?? null,
			},
		};
	} catch (error) {
		console.error("Content compare error:", error);
		return {
			success: false,
			error: {
				code: "CONTENT_COMPARE_ERROR",
				message: "Failed to compare revisions",
			},
		};
	}
}

export async function handleContentTranslations(
	db: Kysely<Database>,
	collection: string,
	id: string,
): Promise<
	ApiResult<{
		translationGroup: string;
		translations: Array<{
			id: string;
			locale: string | null;
			slug: string | null;
			status: string;
			updatedAt: string;
		}>;
	}>
> {
	try {
		const repo = new ContentRepository(db);
		const item = await repo.findByIdOrSlug(collection, id);

		if (!item) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `Content item not found: ${id}`,
				},
			};
		}

		if (!item.translationGroup) {
			return {
				success: true,
				data: {
					translationGroup: item.id,
					translations: [
						{
							id: item.id,
							locale: item.locale,
							slug: item.slug,
							status: item.status,
							updatedAt: item.updatedAt,
						},
					],
				},
			};
		}

		const translations = await repo.findTranslations(collection, item.translationGroup);

		return {
			success: true,
			data: {
				translationGroup: item.translationGroup,
				translations: translations.map((t) => ({
					id: t.id,
					locale: t.locale,
					slug: t.slug,
					status: t.status,
					updatedAt: t.updatedAt,
				})),
			},
		};
	} catch (error) {
		if (error instanceof Error) {
			console.error("Content translations error:", error);
		}
		return {
			success: false,
			error: {
				code: "CONTENT_TRANSLATIONS_ERROR",
				message: "Failed to get translations",
			},
		};
	}
}

async function syncNonTranslatableFields(
	trx: Kysely<Database>,
	collectionSlug: string,
	updatedItemId: string,
	translationGroup: string,
	data: Record<string, unknown>,
): Promise<void> {
	const collection = await trx
		.selectFrom("_emdash_collections")
		.select("id")
		.where("slug", "=", collectionSlug)
		.executeTakeFirst();

	if (!collection) return;

	const fields = await trx
		.selectFrom("_emdash_fields")
		.select("slug")
		.where("collection_id", "=", collection.id)
		.where("translatable", "=", 0)
		.execute();

	const nonTranslatableSlugs = fields.map((f) => f.slug);
	if (nonTranslatableSlugs.length === 0) return;

	const syncData: Record<string, unknown> = {};
	for (const slug of nonTranslatableSlugs) {
		if (slug in data) {
			syncData[slug] = data[slug];
		}
	}
	if (Object.keys(syncData).length === 0) return;

	validateIdentifier(collectionSlug, "collection slug");
	const tableName = `ec_${collectionSlug}`;

	const setClauses = Object.entries(syncData).map(([key, value]) => {
		validateIdentifier(key, "field slug");
		const serialized = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
		return sql`${sql.ref(key)} = ${serialized}`;
	});

	await sql`
		UPDATE ${sql.ref(tableName)}
		SET ${sql.join(setClauses, sql`, `)}
		WHERE translation_group = ${translationGroup}
		AND id != ${updatedItemId}
	`.execute(trx);
}

async function assignTaxonomies(
	trx: Kysely<Database>,
	collection: string,
	entryId: string,
	locale: string | undefined,
	taxonomies: Record<string, string[]>,
): Promise<void> {
	const taxRepo = new TaxonomyRepository(trx);
	let anyChange = false;

	for (const [taxonomyName, slugs] of Object.entries(taxonomies)) {
		if (!Array.isArray(slugs)) {
			throw new EmDashValidationError(`taxonomies.${taxonomyName} must be an array of term slugs`);
		}

		const termIds: string[] = [];
		for (const slug of slugs) {
			if (typeof slug !== "string" || slug.length === 0) {
				throw new EmDashValidationError(
					`taxonomies.${taxonomyName} contains a non-string or empty slug`,
				);
			}
			const term = await taxRepo.findBySlug(taxonomyName, slug, locale);
			if (!term) {
				throw new EmDashValidationError(
					`Unknown taxonomy term: ${taxonomyName}='${slug}'${
						locale ? ` (locale '${locale}')` : ""
					}`,
				);
			}
			termIds.push(term.id);
		}

		await taxRepo.setTermsForEntry(collection, entryId, taxonomyName, termIds);
		anyChange = true;
	}

	if (anyChange) invalidateTermCache();
}
