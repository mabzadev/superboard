import { sql, type Kysely, type Selectable } from "kysely";
import { ulid } from "ulidx";

import { getBylineFieldDefs } from "../../bylines/field-defs-cache.js";
import {
	invalidateBylineObjectCache,
	invalidateCollectionCache,
} from "../../object-cache/index.js";
import {
	clearRequestCacheEntry,
	peekRequestCache,
	setRequestCacheEntry,
} from "../../request-cache.js";
import type { BylineFieldDefinition, CustomFieldValue } from "../../schema/types.js";
import { chunks, SQL_BATCH_SIZE } from "../../utils/chunks.js";
import { listTablesLike } from "../dialect-helpers.js";
import { withTransaction } from "../transaction.js";
import type { BylineTable, Database } from "../types.js";
import { validateIdentifier } from "../validate.js";
import {
	decodeCursor,
	EmDashValidationError,
	encodeCursor,
	type BylineSummary,
	type ContentBylineCredit,
	type FindManyResult,
} from "./types.js";

type BylineRow = Selectable<BylineTable>;

type BylineRowWithAvatar = BylineRow & {
	avatar_storage_key?: string | null;
	avatar_alt?: string | null;
	avatar_blurhash?: string | null;
	avatar_dominant_color?: string | null;
};

export interface CreateBylineInput {
	slug: string;
	displayName: string;
	bio?: string | null;
	avatarMediaId?: string | null;
	websiteUrl?: string | null;
	userId?: string | null;
	isGuest?: boolean;
	locale?: string;
	translationOf?: string;
	customFields?: Record<string, unknown>;
}

export interface UpdateBylineInput {
	slug?: string;
	displayName?: string;
	bio?: string | null;
	avatarMediaId?: string | null;
	websiteUrl?: string | null;
	userId?: string | null;
	isGuest?: boolean;
	customFields?: Record<string, unknown>;
}

export interface ContentBylineInput {
	bylineId: string;
	roleLabel?: string | null;
}

function rowToByline(row: BylineRowWithAvatar): BylineSummary {
	return {
		id: row.id,
		slug: row.slug,
		displayName: row.display_name,
		bio: row.bio,
		avatarMediaId: row.avatar_media_id,
		avatarStorageKey: row.avatar_storage_key ?? null,
		avatarAlt: row.avatar_alt ?? null,
		avatarBlurhash: row.avatar_blurhash ?? null,
		avatarDominantColor: row.avatar_dominant_color ?? null,
		websiteUrl: row.website_url,
		userId: row.user_id,
		isGuest: row.is_guest === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		locale: row.locale,
		translationGroup: row.translation_group,
	};
}

function assignCustomFieldValue(
	summary: BylineSummary,
	field: BylineFieldDefinition,
	stored: string | null,
): void {
	const target = summary.customFields ?? {};
	if (stored === null) {
		target[field.slug] = null;
	} else {
		try {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- coerceFieldValue ran at write time, see field-defs-cache.ts
			target[field.slug] = JSON.parse(stored) as CustomFieldValue;
		} catch {
			console.warn(
				`[BylineRepository] dropping malformed JSON for byline=${summary.id} ` +
					`field=${field.slug}: ${stored.slice(0, 60)}`,
			);
			return;
		}
	}
	summary.customFields = target;
}

function coerceFieldValue(field: BylineFieldDefinition, raw: unknown): CustomFieldValue {
	if (raw === null) return null;

	switch (field.type) {
		case "string":
		case "text": {
			if (typeof raw !== "string") {
				throw new EmDashValidationError(
					`Byline field "${field.slug}" expects a string value (received ${typeof raw})`,
					{ slug: field.slug, type: field.type, received: typeof raw },
				);
			}
			return raw;
		}
		case "url": {
			if (typeof raw !== "string") {
				throw new EmDashValidationError(
					`Byline field "${field.slug}" expects a string value (received ${typeof raw})`,
					{ slug: field.slug, type: field.type, received: typeof raw },
				);
			}
			if (raw === "") return raw;
			let parsed: URL;
			try {
				parsed = new URL(raw);
			} catch {
				throw new EmDashValidationError(
					`Byline field "${field.slug}" expects a valid URL (received "${raw}")`,
					{ slug: field.slug, type: field.type, received: raw },
				);
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				throw new EmDashValidationError(
					`Byline field "${field.slug}" must use http or https scheme (received "${parsed.protocol}")`,
					{ slug: field.slug, type: field.type, received: raw, protocol: parsed.protocol },
				);
			}
			return raw;
		}
		case "boolean": {
			if (typeof raw !== "boolean") {
				throw new EmDashValidationError(
					`Byline field "${field.slug}" expects a boolean value (received ${typeof raw})`,
					{ slug: field.slug, type: field.type, received: typeof raw },
				);
			}
			return raw;
		}
		case "select": {
			if (typeof raw !== "string") {
				throw new EmDashValidationError(
					`Byline field "${field.slug}" expects a string value (received ${typeof raw})`,
					{ slug: field.slug, type: field.type, received: typeof raw },
				);
			}
			const options = field.validation?.options ?? [];
			if (!options.includes(raw)) {
				throw new EmDashValidationError(
					`Byline field "${field.slug}" value "${raw}" is not one of the registered choices`,
					{ slug: field.slug, value: raw, options },
				);
			}
			return raw;
		}
	}
}

export class BylineRepository {
	constructor(private db: Kysely<Database>) {}

	private async withCustomFields(rows: BylineRow[]): Promise<BylineSummary[]> {
		const summaries = rows.map(rowToByline);
		for (const summary of summaries) {
			summary.customFields = {};
		}
		await this.applyCustomFieldsTo(summaries);
		return summaries;
	}

	private async withCustomFieldsOne(row: BylineRow | undefined): Promise<BylineSummary | null> {
		if (!row) return null;
		const [result] = await this.withCustomFields([row]);
		return result ?? null;
	}

	async hydrateBylineCustomFields(summaries: BylineSummary[]): Promise<void> {
		for (const summary of summaries) {
			summary.customFields = {};
		}
		await this.applyCustomFieldsTo(summaries);
	}

	private async applyCustomFieldsTo(summaries: BylineSummary[]): Promise<void> {
		if (summaries.length === 0) return;

		const defs = await getBylineFieldDefs(this.db);
		if (defs.length === 0) return;

		const fieldById = new Map(defs.map((d) => [d.id, d]));

		const translatableByByline = new Map<string, Map<string, string | null>>();
		const bylineIds = [...new Set(summaries.map((s) => s.id))];
		for (const chunk of chunks(bylineIds, SQL_BATCH_SIZE)) {
			const trRows = await this.db
				.selectFrom("_emdash_byline_field_values")
				.select(["byline_id", "field_id", "value"])
				.where("byline_id", "in", chunk)
				.execute();
			for (const trRow of trRows) {
				let fieldMap = translatableByByline.get(trRow.byline_id);
				if (!fieldMap) {
					fieldMap = new Map();
					translatableByByline.set(trRow.byline_id, fieldMap);
				}
				fieldMap.set(trRow.field_id, trRow.value);
			}
		}

		const groups = [
			...new Set(
				summaries
					.map((s) => s.translationGroup)
					.filter((g): g is string => typeof g === "string" && g.length > 0),
			),
		];
		const groupByGroup = await this.loadGroupValuesByIds(groups);

		for (const summary of summaries) {
			const trValues = translatableByByline.get(summary.id);
			if (trValues) {
				for (const [fieldId, value] of trValues) {
					const field = fieldById.get(fieldId);
					if (!field || !field.translatable) continue;
					assignCustomFieldValue(summary, field, value);
				}
			}

			if (summary.translationGroup) {
				const grpValues = groupByGroup.get(summary.translationGroup);
				if (grpValues) {
					for (const [fieldId, value] of grpValues) {
						const field = fieldById.get(fieldId);
						if (!field || field.translatable) continue;
						assignCustomFieldValue(summary, field, value);
					}
				}
			}
		}
	}

	private async loadGroupValuesByIds(
		groups: string[],
	): Promise<Map<string, Map<string, string | null>>> {
		const result = new Map<string, Map<string, string | null>>();
		if (groups.length === 0) return result;

		const missing: string[] = [];
		for (const g of groups) {
			const cached = peekRequestCache<Map<string, string | null>>(`byline-field-group-values:${g}`);
			if (cached) {
				result.set(g, await cached);
			} else {
				missing.push(g);
			}
		}

		if (missing.length === 0) return result;

		const fetched = new Map<string, Map<string, string | null>>();
		for (const g of missing) fetched.set(g, new Map());
		for (const chunk of chunks(missing, SQL_BATCH_SIZE)) {
			const grpRows = await this.db
				.selectFrom("_emdash_byline_field_group_values")
				.select(["translation_group", "field_id", "value"])
				.where("translation_group", "in", chunk)
				.execute();
			for (const grpRow of grpRows) {
				const fieldMap = fetched.get(grpRow.translation_group);
				if (!fieldMap) continue;
				fieldMap.set(grpRow.field_id, grpRow.value);
			}
		}

		for (const g of missing) {
			const m = fetched.get(g);
			if (!m) continue;
			setRequestCacheEntry(`byline-field-group-values:${g}`, m);
			result.set(g, m);
		}

		return result;
	}

	async findById(id: string): Promise<BylineSummary | null> {
		const row = await this.db
			.selectFrom("_emdash_bylines")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst();
		return this.withCustomFieldsOne(row);
	}

	async findBySlug(slug: string, options?: { locale?: string }): Promise<BylineSummary | null> {
		let query = this.db.selectFrom("_emdash_bylines").selectAll().where("slug", "=", slug);
		if (options?.locale !== undefined) query = query.where("locale", "=", options.locale);
		const row = await query.orderBy("locale", "asc").executeTakeFirst();
		return this.withCustomFieldsOne(row);
	}

	async findByUserId(userId: string, options?: { locale?: string }): Promise<BylineSummary | null> {
		let query = this.db.selectFrom("_emdash_bylines").selectAll().where("user_id", "=", userId);
		if (options?.locale !== undefined) query = query.where("locale", "=", options.locale);
		const row = await query.orderBy("locale", "asc").executeTakeFirst();
		return this.withCustomFieldsOne(row);
	}

	async findMany(options?: {
		search?: string;
		isGuest?: boolean;
		userId?: string;
		locale?: string;
		cursor?: string;
		limit?: number;
	}): Promise<FindManyResult<BylineSummary>> {
		const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

		let query = this.db
			.selectFrom("_emdash_bylines")
			.selectAll()
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.limit(limit + 1);

		if (options?.search) {
			const escaped = options.search
				.replaceAll("\\", "\\\\")
				.replaceAll("%", "\\%")
				.replaceAll("_", "\\_");
			const term = `%${escaped}%`;
			query = query.where((eb) =>
				eb.or([eb("display_name", "like", term), eb("slug", "like", term)]),
			);
		}

		if (options?.isGuest !== undefined) {
			query = query.where("is_guest", "=", options.isGuest ? 1 : 0);
		}

		if (options?.userId !== undefined) {
			query = query.where("user_id", "=", options.userId);
		}

		if (options?.locale !== undefined) {
			query = query.where("locale", "=", options.locale);
		}

		if (options?.cursor) {
			const decoded = decodeCursor(options.cursor);
			query = query.where((eb) =>
				eb.or([
					eb("created_at", "<", decoded.orderValue),
					eb.and([eb("created_at", "=", decoded.orderValue), eb("id", "<", decoded.id)]),
				]),
			);
		}

		const rows = await query.execute();
		const pageRows = rows.slice(0, limit);
		const items = await this.withCustomFields(pageRows);
		const result: FindManyResult<BylineSummary> = { items };

		if (rows.length > limit) {
			const last = items.at(-1);
			if (last) {
				result.nextCursor = encodeCursor(last.createdAt, last.id);
			}
		}

		return result;
	}

	async listTranslations(id: string): Promise<BylineSummary[]> {
		const anchor = await this.findById(id);
		if (!anchor) return [];
		const group = anchor.translationGroup ?? anchor.id;
		return this.findByTranslationGroup(group);
	}

	async findByTranslationGroup(translationGroup: string): Promise<BylineSummary[]> {
		const rows = await this.db
			.selectFrom("_emdash_bylines")
			.selectAll()
			.where("translation_group", "=", translationGroup)
			.orderBy("locale", "asc")
			.execute();
		return this.withCustomFields(rows);
	}

	private async resolveCustomFieldWrites(
		customFields: Record<string, unknown> | undefined,
	): Promise<Array<{ field: BylineFieldDefinition; value: CustomFieldValue }>> {
		if (!customFields || Object.keys(customFields).length === 0) return [];
		const defs = await getBylineFieldDefs(this.db);
		const bySlug = new Map(defs.map((d) => [d.slug, d]));
		const writes: Array<{ field: BylineFieldDefinition; value: CustomFieldValue }> = [];
		for (const [slug, raw] of Object.entries(customFields)) {
			const field = bySlug.get(slug);
			if (!field) {
				throw new EmDashValidationError(`Unknown byline custom field "${slug}"`, {
					slug,
					registered: defs.map((d) => d.slug),
				});
			}
			writes.push({ field, value: coerceFieldValue(field, raw) });
		}
		return writes;
	}

	private async applyCustomFieldWritesInTrx(
		trx: Kysely<Database>,
		bylineId: string,
		translationGroup: string,
		writes: Array<{ field: BylineFieldDefinition; value: CustomFieldValue }>,
		now: string,
	): Promise<boolean> {
		if (writes.length === 0) return false;
		let touchedGroupShared = false;
		for (const { field, value } of writes) {
			if (!field.translatable) touchedGroupShared = true;
			if (field.translatable) {
				if (value === null) {
					await trx
						.deleteFrom("_emdash_byline_field_values")
						.where("byline_id", "=", bylineId)
						.where("field_id", "=", field.id)
						.execute();
				} else {
					const encoded = JSON.stringify(value);
					await trx
						.insertInto("_emdash_byline_field_values")
						.values({
							byline_id: bylineId,
							field_id: field.id,
							value: encoded,
							created_at: now,
							updated_at: now,
						})
						.onConflict((oc) =>
							oc.columns(["byline_id", "field_id"]).doUpdateSet({
								value: encoded,
								updated_at: now,
							}),
						)
						.execute();
				}
			} else {
				if (value === null) {
					await trx
						.deleteFrom("_emdash_byline_field_group_values")
						.where("translation_group", "=", translationGroup)
						.where("field_id", "=", field.id)
						.execute();
				} else {
					const encoded = JSON.stringify(value);
					await trx
						.insertInto("_emdash_byline_field_group_values")
						.values({
							translation_group: translationGroup,
							field_id: field.id,
							value: encoded,
							created_at: now,
							updated_at: now,
						})
						.onConflict((oc) =>
							oc.columns(["translation_group", "field_id"]).doUpdateSet({
								value: encoded,
								updated_at: now,
							}),
						)
						.execute();
				}
			}
		}
		return touchedGroupShared;
	}

	async create(input: CreateBylineInput): Promise<BylineSummary> {
		const id = ulid();
		const now = new Date().toISOString();

		const customFieldWrites = await this.resolveCustomFieldWrites(input.customFields);

		let translationGroup: string = id;
		if (input.translationOf) {
			const source = await this.findById(input.translationOf);
			if (!source) throw new Error("Source byline for translation not found");
			translationGroup = source.translationGroup ?? source.id;
		}

		let touchedGroupShared = false;
		await withTransaction(this.db, async (trx) => {
			await trx
				.insertInto("_emdash_bylines")
				.values({
					id,
					slug: input.slug,
					display_name: input.displayName,
					bio: input.bio ?? null,
					avatar_media_id: input.avatarMediaId ?? null,
					website_url: input.websiteUrl ?? null,
					user_id: input.userId ?? null,
					is_guest: input.isGuest ? 1 : 0,
					created_at: now,
					updated_at: now,
					...(input.locale !== undefined ? { locale: input.locale } : {}),
					translation_group: translationGroup,
				})
				.execute();

			touchedGroupShared = await this.applyCustomFieldWritesInTrx(
				trx,
				id,
				translationGroup,
				customFieldWrites,
				now,
			);
		});

		if (touchedGroupShared) {
			clearRequestCacheEntry(`byline-field-group-values:${translationGroup}`);
		}
		invalidateBylineObjectCache();

		const byline = await this.findById(id);
		if (!byline) {
			throw new Error("Failed to create byline");
		}
		return byline;
	}

	async update(id: string, input: UpdateBylineInput): Promise<BylineSummary | null> {
		const existing = await this.findById(id);
		if (!existing) return null;

		const customFieldWrites = await this.resolveCustomFieldWrites(input.customFields);

		const now = new Date().toISOString();
		const updates: Record<string, unknown> = { updated_at: now };

		if (input.slug !== undefined) updates.slug = input.slug;
		if (input.displayName !== undefined) updates.display_name = input.displayName;
		if (input.bio !== undefined) updates.bio = input.bio;
		if (input.avatarMediaId !== undefined) updates.avatar_media_id = input.avatarMediaId;
		if (input.websiteUrl !== undefined) updates.website_url = input.websiteUrl;
		if (input.userId !== undefined) updates.user_id = input.userId;
		if (input.isGuest !== undefined) updates.is_guest = input.isGuest ? 1 : 0;

		const group = existing.translationGroup ?? existing.id;
		let touchedGroupShared = false;
		await withTransaction(this.db, async (trx) => {
			await trx.updateTable("_emdash_bylines").set(updates).where("id", "=", id).execute();
			touchedGroupShared = await this.applyCustomFieldWritesInTrx(
				trx,
				id,
				group,
				customFieldWrites,
				now,
			);
		});

		if (touchedGroupShared) {
			clearRequestCacheEntry(`byline-field-group-values:${group}`);
		}
		invalidateBylineObjectCache();

		return await this.findById(id);
	}

	async delete(id: string): Promise<boolean> {
		const existing = await this.findById(id);
		if (!existing) return false;

		const group = existing.translationGroup ?? existing.id;

		await withTransaction(this.db, async (trx) => {
			await trx.deleteFrom("_emdash_byline_field_values").where("byline_id", "=", id).execute();

			await trx.deleteFrom("_emdash_bylines").where("id", "=", id).execute();

			const remaining = await trx
				.selectFrom("_emdash_bylines")
				.select(({ fn }) => [fn.count<number>("id").as("count")])
				.where("translation_group", "=", group)
				.executeTakeFirst();
			const remainingCount = Number(remaining?.count ?? 0);
			if (remainingCount > 0) return;

			await trx.deleteFrom("_emdash_content_bylines").where("byline_id", "=", group).execute();

			await trx
				.deleteFrom("_emdash_byline_field_group_values")
				.where("translation_group", "=", group)
				.execute();

			const tableNames = await listTablesLike(trx, "ec_%");
			for (const tableName of tableNames) {
				validateIdentifier(tableName, "content table");
				await sql`
					UPDATE ${sql.ref(tableName)}
					SET primary_byline_id = NULL
					WHERE primary_byline_id = ${group}
				`.execute(trx);
			}
		});

		invalidateBylineObjectCache();
		return true;
	}

	async getContentBylines(
		collectionSlug: string,
		contentId: string,
		options?: { locale?: string },
	): Promise<ContentBylineCredit[]> {
		let query = this.db
			.selectFrom("_emdash_content_bylines as cb")
			.innerJoin("_emdash_bylines as b", "b.translation_group", "cb.byline_id")
			.leftJoin("media as m", "m.id", "b.avatar_media_id")
			.select([
				"cb.sort_order as sort_order",
				"cb.role_label as role_label",
				"b.id as id",
				"b.slug as slug",
				"b.display_name as display_name",
				"b.bio as bio",
				"b.avatar_media_id as avatar_media_id",
				"m.storage_key as avatar_storage_key",
				"m.alt as avatar_alt",
				"m.blurhash as avatar_blurhash",
				"m.dominant_color as avatar_dominant_color",
				"b.website_url as website_url",
				"b.user_id as user_id",
				"b.is_guest as is_guest",
				"b.created_at as created_at",
				"b.updated_at as updated_at",
				"b.locale as locale",
				"b.translation_group as translation_group",
			])
			.where("cb.collection_slug", "=", collectionSlug)
			.where("cb.content_id", "=", contentId)
			.orderBy("cb.sort_order", "asc");
		if (options?.locale !== undefined) query = query.where("b.locale", "=", options.locale);

		const rows = await query.execute();
		const bylineRows: BylineRowWithAvatar[] = rows.map((row) => ({
			id: row.id,
			slug: row.slug,
			display_name: row.display_name,
			bio: row.bio,
			avatar_media_id: row.avatar_media_id,
			avatar_storage_key: row.avatar_storage_key,
			avatar_alt: row.avatar_alt,
			avatar_blurhash: row.avatar_blurhash,
			avatar_dominant_color: row.avatar_dominant_color,
			website_url: row.website_url,
			user_id: row.user_id,
			is_guest: row.is_guest,
			created_at: row.created_at,
			updated_at: row.updated_at,
			locale: row.locale,
			translation_group: row.translation_group,
		}));
		const hydrated = await this.withCustomFields(bylineRows);
		return rows.map((row, i) => {
			const byline = hydrated[i];
			if (!byline) {
				throw new Error("getContentBylines: hydration row count mismatch");
			}
			return {
				byline,
				sortOrder: row.sort_order,
				roleLabel: row.role_label,
			};
		});
	}

	async hasContentBylines(collectionSlug: string, contentId: string): Promise<boolean> {
		const row = await this.db
			.selectFrom("_emdash_content_bylines")
			.select("id")
			.where("collection_slug", "=", collectionSlug)
			.where("content_id", "=", contentId)
			.limit(1)
			.executeTakeFirst();
		return row !== undefined;
	}

	async hasContentBylinesMany(collectionSlug: string, contentIds: string[]): Promise<Set<string>> {
		const result = new Set<string>();
		if (contentIds.length === 0) return result;

		const uniqueContentIds = [...new Set(contentIds)];
		for (const chunk of chunks(uniqueContentIds, SQL_BATCH_SIZE)) {
			const rows = await this.db
				.selectFrom("_emdash_content_bylines")
				.select("content_id")
				.distinct()
				.where("collection_slug", "=", collectionSlug)
				.where("content_id", "in", chunk)
				.execute();
			for (const row of rows) result.add(row.content_id);
		}
		return result;
	}

	async getContentBylinesMany(
		collectionSlug: string,
		contentIds: string[],
		options?: { locale?: string; skipHydration?: boolean },
	): Promise<Map<string, ContentBylineCredit[]>> {
		const result = new Map<string, ContentBylineCredit[]>();
		if (contentIds.length === 0) return result;

		const uniqueContentIds = [...new Set(contentIds)];
		for (const chunk of chunks(uniqueContentIds, SQL_BATCH_SIZE)) {
			let query = this.db
				.selectFrom("_emdash_content_bylines as cb")
				.innerJoin("_emdash_bylines as b", "b.translation_group", "cb.byline_id")
				.leftJoin("media as m", "m.id", "b.avatar_media_id")
				.select([
					"cb.content_id as content_id",
					"cb.sort_order as sort_order",
					"cb.role_label as role_label",
					"b.id as id",
					"b.slug as slug",
					"b.display_name as display_name",
					"b.bio as bio",
					"b.avatar_media_id as avatar_media_id",
					"m.storage_key as avatar_storage_key",
					"m.alt as avatar_alt",
					"m.blurhash as avatar_blurhash",
					"m.dominant_color as avatar_dominant_color",
					"b.website_url as website_url",
					"b.user_id as user_id",
					"b.is_guest as is_guest",
					"b.created_at as created_at",
					"b.updated_at as updated_at",
					"b.locale as locale",
					"b.translation_group as translation_group",
				])
				.where("cb.collection_slug", "=", collectionSlug)
				.where("cb.content_id", "in", chunk)
				.orderBy("cb.sort_order", "asc");
			if (options?.locale !== undefined) query = query.where("b.locale", "=", options.locale);

			const rows = await query.execute();
			const bylineRows: BylineRowWithAvatar[] = rows.map((row) => ({
				id: row.id,
				slug: row.slug,
				display_name: row.display_name,
				bio: row.bio,
				avatar_media_id: row.avatar_media_id,
				avatar_storage_key: row.avatar_storage_key,
				avatar_alt: row.avatar_alt,
				avatar_blurhash: row.avatar_blurhash,
				avatar_dominant_color: row.avatar_dominant_color,
				website_url: row.website_url,
				user_id: row.user_id,
				is_guest: row.is_guest,
				created_at: row.created_at,
				updated_at: row.updated_at,
				locale: row.locale,
				translation_group: row.translation_group,
			}));

			let bylines: BylineSummary[];
			if (options?.skipHydration === true) {
				bylines = bylineRows.map(rowToByline);
				for (const b of bylines) b.customFields = {};
			} else {
				bylines = await this.withCustomFields(bylineRows);
			}

			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				const byline = bylines[i];
				if (!row || !byline) continue;
				const contentId = row.content_id;
				const credit: ContentBylineCredit = {
					byline,
					sortOrder: row.sort_order,
					roleLabel: row.role_label,
				};
				const existing = result.get(contentId);
				if (existing) {
					existing.push(credit);
				} else {
					result.set(contentId, [credit]);
				}
			}
		}

		return result;
	}

	async findByUserIds(
		userIds: string[],
		options?: { locale?: string; skipHydration?: boolean },
	): Promise<Map<string, BylineSummary>> {
		const result = new Map<string, BylineSummary>();
		if (userIds.length === 0) return result;

		for (const chunk of chunks(userIds, SQL_BATCH_SIZE)) {
			let query = this.db
				.selectFrom("_emdash_bylines as b")
				.leftJoin("media as m", "m.id", "b.avatar_media_id")
				.select([
					"b.id as id",
					"b.slug as slug",
					"b.display_name as display_name",
					"b.bio as bio",
					"b.avatar_media_id as avatar_media_id",
					"m.storage_key as avatar_storage_key",
					"m.alt as avatar_alt",
					"m.blurhash as avatar_blurhash",
					"m.dominant_color as avatar_dominant_color",
					"b.website_url as website_url",
					"b.user_id as user_id",
					"b.is_guest as is_guest",
					"b.created_at as created_at",
					"b.updated_at as updated_at",
					"b.locale as locale",
					"b.translation_group as translation_group",
				])
				.where("b.user_id", "in", chunk);
			if (options?.locale !== undefined) query = query.where("b.locale", "=", options.locale);

			const rows = await query.execute();
			let bylines: BylineSummary[];
			if (options?.skipHydration === true) {
				bylines = rows.map(rowToByline);
				for (const b of bylines) b.customFields = {};
			} else {
				bylines = await this.withCustomFields(rows);
			}

			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				const summary = bylines[i];
				if (!row || !summary || !row.user_id) continue;
				result.set(row.user_id, summary);
			}
		}
		return result;
	}

	async copyContentBylines(
		collection: string,
		sourceContentId: string,
		targetContentId: string,
	): Promise<void> {
		validateIdentifier(collection, "collection slug");
		const tableName = `ec_${collection}`;
		validateIdentifier(tableName, "content table");

		const existing = await this.db
			.selectFrom("_emdash_content_bylines")
			.select("id")
			.where("collection_slug", "=", collection)
			.where("content_id", "=", targetContentId)
			.executeTakeFirst();
		if (existing) return;

		const sourceRows = await this.db
			.selectFrom("_emdash_content_bylines")
			.select(["byline_id", "sort_order", "role_label"])
			.where("collection_slug", "=", collection)
			.where("content_id", "=", sourceContentId)
			.orderBy("sort_order", "asc")
			.execute();
		if (sourceRows.length === 0) return;

		const now = new Date().toISOString();
		await this.db
			.insertInto("_emdash_content_bylines")
			.values(
				sourceRows.map((row) => ({
					id: ulid(),
					collection_slug: collection,
					content_id: targetContentId,
					byline_id: row.byline_id,
					sort_order: row.sort_order,
					role_label: row.role_label,
					created_at: now,
				})),
			)
			.execute();

		const firstByline = sourceRows[0]?.byline_id ?? null;
		await sql`
			UPDATE ${sql.ref(tableName)}
			SET primary_byline_id = ${firstByline}
			WHERE id = ${targetContentId}
		`.execute(this.db);

		invalidateCollectionCache(collection);
	}

	async setContentBylines(
		collectionSlug: string,
		contentId: string,
		inputBylines: ContentBylineInput[],
	): Promise<ContentBylineCredit[]> {
		validateIdentifier(collectionSlug, "collection slug");
		const tableName = `ec_${collectionSlug}`;
		validateIdentifier(tableName, "content table");

		const idToGroup = new Map<string, string>();
		if (inputBylines.length > 0) {
			const wireIds = [...new Set(inputBylines.map((item) => item.bylineId))];
			const rows = await this.db
				.selectFrom("_emdash_bylines")
				.select(["id", "translation_group"])
				.where("id", "in", wireIds)
				.execute();
			if (rows.length !== wireIds.length) {
				throw new Error("One or more byline IDs do not exist");
			}
			for (const row of rows) {
				idToGroup.set(row.id, row.translation_group ?? row.id);
			}
		}

		const seenGroups = new Set<string>();
		const bylines: Array<ContentBylineInput & { group: string }> = [];
		for (const item of inputBylines) {
			const group = idToGroup.get(item.bylineId);
			if (!group) {
				throw new Error(`Missing translation_group for byline ${item.bylineId}`);
			}
			if (seenGroups.has(group)) continue;
			seenGroups.add(group);
			bylines.push({ ...item, group });
		}

		await this.db
			.deleteFrom("_emdash_content_bylines")
			.where("collection_slug", "=", collectionSlug)
			.where("content_id", "=", contentId)
			.execute();

		for (let i = 0; i < bylines.length; i++) {
			const item = bylines[i];
			if (!item) continue;
			await this.db
				.insertInto("_emdash_content_bylines")
				.values({
					id: ulid(),
					collection_slug: collectionSlug,
					content_id: contentId,
					byline_id: item.group,
					sort_order: i,
					role_label: item.roleLabel ?? null,
					created_at: new Date().toISOString(),
				})
				.execute();
		}

		const primaryGroup = bylines[0]?.group ?? null;
		await sql`
			UPDATE ${sql.ref(tableName)}
			SET primary_byline_id = ${primaryGroup}
			WHERE id = ${contentId}
		`.execute(this.db);

		invalidateCollectionCache(collectionSlug);

		return await this.getContentBylines(collectionSlug, contentId);
	}
}
