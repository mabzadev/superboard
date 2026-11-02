import { sql, type Kysely, type Selectable } from "kysely";
import { ulid } from "ulidx";

import { invalidateTaxonomyObjectCache } from "../../object-cache/index.js";
import { slugify } from "../../utils/slugify.js";
import { withTransaction } from "../transaction.js";
import type { Database, TaxonomyTable } from "../types.js";
import { validateIdentifier } from "../validate.js";

export interface SiblingPosition {
	group: string;
	position: number;
}

const GROUPS_PER_UPDATE = 32;
const NUMERIC_SUFFIX_PATTERN = /^\d+$/;

function permuteWithinSlots(
	listed: readonly string[],
	occupied: readonly number[],
): Map<string, number> {
	const slots = occupied.toSorted((a, b) => a - b);
	const target = new Map<string, number>();
	listed.forEach((group, index) => {
		const position = slots[index];
		if (position !== undefined) target.set(group, position);
	});
	return target;
}

function renumberSiblings(
	listed: readonly string[],
	siblings: readonly SiblingPosition[],
): Map<string, number> {
	const sequence = siblings.toSorted((a, b) => a.position - b.position);
	const wanted = new Set(listed);
	const target = new Map<string, number>();
	let next = 0;
	sequence.forEach(({ group }, index) => {
		const replacement = wanted.has(group) ? listed[next++] : undefined;
		target.set(replacement ?? group, index);
	});
	return target;
}

export interface Taxonomy {
	id: string;
	name: string;
	slug: string;
	label: string;
	parentId: string | null;
	data: Record<string, unknown> | null;
	locale: string;
	translationGroup: string | null;
	sortOrder: number;
}

export interface CreateTaxonomyInput {
	name: string;
	slug: string;
	label: string;
	parentId?: string;
	data?: Record<string, unknown>;
	locale?: string;
	translationOf?: string;
}

export interface UpdateTaxonomyInput {
	slug?: string;
	label?: string;
	parentId?: string | null;
	data?: Record<string, unknown>;
}

export interface FindOptions {
	parentId?: string | null;
	locale?: string;
}

export interface TaxonomyManualPageCursor {
	sortOrder: number;
	label: string;
	id: string;
}

export interface TaxonomyPageOptions extends FindOptions {
	cursor?: TaxonomyManualPageCursor;
	limit?: number;
}

export interface TaxonomyPage {
	items: Taxonomy[];
	hasMore: boolean;
}

export interface TaxonomyAssignmentTranslation {
	id: string;
	slug: string;
	locale: string;
}

export interface TaxonomyAssignmentResolution {
	translationGroup: string;
	term: Taxonomy | null;
	availableLocales: string[];
	translations: TaxonomyAssignmentTranslation[];
}

export class TaxonomyRepository {
	constructor(private db: Kysely<Database>) {}

	async create(input: CreateTaxonomyInput): Promise<Taxonomy> {
		const id = ulid();

		const parentInput =
			input.parentId === undefined || input.parentId === "" ? null : input.parentId;
		const parentId = parentInput ? await this.resolveParentRef(parentInput) : null;

		let translationGroup = id;
		let sortOrder: number | null = null;
		if (input.translationOf) {
			const source = await this.findById(input.translationOf);
			if (source?.translationGroup) translationGroup = source.translationGroup;
			if (source && source.parentId === parentId) sortOrder = source.sortOrder;
		}
		sortOrder ??= await this.nextSortOrder(input.name, parentId);

		await this.db
			.insertInto("taxonomies")
			.values({
				id,
				name: input.name,
				slug: input.slug,
				label: input.label,
				parent_id: parentId,
				data: input.data ? JSON.stringify(input.data) : null,
				sort_order: sortOrder,
				...(input.locale !== undefined ? { locale: input.locale } : {}),
				translation_group: translationGroup,
			})
			.execute();

		invalidateTaxonomyObjectCache();

		const taxonomy = await this.findById(id);
		if (!taxonomy) throw new Error("Failed to create taxonomy");
		return taxonomy;
	}

	async findById(id: string): Promise<Taxonomy | null> {
		const row = await this.db
			.selectFrom("taxonomies")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst();
		return row ? this.rowToTaxonomy(row) : null;
	}

	async findBySlug(name: string, slug: string, locale?: string): Promise<Taxonomy | null> {
		let query = this.db
			.selectFrom("taxonomies")
			.selectAll()
			.where("name", "=", name)
			.where("slug", "=", slug);
		if (locale !== undefined) query = query.where("locale", "=", locale);
		const row = await query.orderBy("locale", "asc").executeTakeFirst();
		return row ? this.rowToTaxonomy(row) : null;
	}

	async generateUniqueSlug(name: string, text: string, locale?: string): Promise<string> {
		const baseSlug = slugify(text);
		let query = this.db
			.selectFrom("taxonomies")
			.select("slug")
			.where("name", "=", name)
			.where((eb) => eb.or([eb("slug", "=", baseSlug), eb("slug", "like", `${baseSlug}-%`)]));
		if (locale !== undefined) query = query.where("locale", "=", locale);
		const candidates = await query.execute();
		if (!candidates.some((candidate) => candidate.slug === baseSlug)) return baseSlug;

		let maxSuffix = 0;
		const prefix = `${baseSlug}-`;
		for (const candidate of candidates) {
			if (!candidate.slug.startsWith(prefix)) continue;
			const suffix = candidate.slug.slice(prefix.length);
			if (!NUMERIC_SUFFIX_PATTERN.test(suffix)) continue;
			maxSuffix = Math.max(maxSuffix, Number.parseInt(suffix, 10));
		}
		return `${baseSlug}-${maxSuffix + 1}`;
	}

	async findByName(name: string, options: FindOptions = {}): Promise<Taxonomy[]> {
		let query = this.db
			.selectFrom("taxonomies")
			.selectAll()
			.where("name", "=", name)
			.orderBy("sort_order", "asc")
			.orderBy("label", "asc")
			.orderBy("id", "asc");

		if (options.locale !== undefined) query = query.where("locale", "=", options.locale);

		if (options.parentId !== undefined) {
			if (options.parentId === null) {
				query = query.where("parent_id", "is", null);
			} else {
				query = query.where("parent_id", "=", options.parentId);
			}
		}

		const rows = await query.execute();
		return rows.map((row) => this.rowToTaxonomy(row));
	}

	async findByNameResolved(
		name: string,
		locale: string,
		defaultLocale: string,
	): Promise<Taxonomy[]> {
		const locales = [...new Set([locale, defaultLocale])];
		const rows = await this.db
			.selectFrom("taxonomies")
			.selectAll()
			.where("name", "=", name)
			.where("locale", "in", locales)
			.orderBy("sort_order", "asc")
			.orderBy("label", "asc")
			.orderBy("id", "asc")
			.execute();

		const selected = new Map<string, Taxonomy>();
		for (const row of rows) {
			const term = this.rowToTaxonomy(row);
			const group = term.translationGroup ?? term.id;
			const current = selected.get(group);
			if (!current || term.locale === locale) selected.set(group, term);
		}
		return [...selected.values()].toSorted(
			(a, b) =>
				a.sortOrder - b.sortOrder || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
		);
	}

	async findPageByName(name: string, options: TaxonomyPageOptions = {}): Promise<TaxonomyPage> {
		const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
		let query = this.db.selectFrom("taxonomies").selectAll().where("name", "=", name);

		if (options.locale !== undefined) query = query.where("locale", "=", options.locale);

		if (options.parentId !== undefined) {
			query =
				options.parentId === null
					? query.where("parent_id", "is", null)
					: query.where("parent_id", "=", options.parentId);
		}

		if (options.cursor) {
			const cursor = options.cursor;
			query = query.where((eb) =>
				eb.or([
					eb("sort_order", ">", cursor.sortOrder),
					eb.and([eb("sort_order", "=", cursor.sortOrder), eb("label", ">", cursor.label)]),
					eb.and([
						eb("sort_order", "=", cursor.sortOrder),
						eb("label", "=", cursor.label),
						eb("id", ">", cursor.id),
					]),
				]),
			);
		}
		query = query.orderBy("sort_order", "asc").orderBy("label", "asc").orderBy("id", "asc");

		const rows = await query.limit(limit + 1).execute();
		return {
			items: rows.slice(0, limit).map((row) => this.rowToTaxonomy(row)),
			hasMore: rows.length > limit,
		};
	}

	async findChildren(parentIdOrGroup: string, locale?: string): Promise<Taxonomy[]> {
		const group = await this.resolveTranslationGroup(parentIdOrGroup);
		if (!group) return [];

		let query = this.db
			.selectFrom("taxonomies")
			.selectAll()
			.where("parent_id", "=", group)
			.orderBy("sort_order", "asc")
			.orderBy("label", "asc")
			.orderBy("id", "asc");
		if (locale !== undefined) query = query.where("locale", "=", locale);

		const rows = await query.execute();
		return rows.map((row) => this.rowToTaxonomy(row));
	}

	async findTranslations(translationGroup: string): Promise<Taxonomy[]> {
		const rows = await this.db
			.selectFrom("taxonomies")
			.selectAll()
			.where("translation_group", "=", translationGroup)
			.orderBy("locale", "asc")
			.execute();
		return rows.map((row) => this.rowToTaxonomy(row));
	}

	async update(id: string, input: UpdateTaxonomyInput): Promise<Taxonomy | null> {
		const existing = await this.findById(id);
		if (!existing) return null;

		const updates: Record<string, unknown> = {};
		if (input.slug !== undefined) updates.slug = input.slug;
		if (input.label !== undefined) updates.label = input.label;
		if (input.data !== undefined) updates.data = JSON.stringify(input.data);

		const group: { parent_id?: string | null; sort_order?: number } = {};
		if (input.parentId !== undefined) {
			const parentId =
				input.parentId === "" || input.parentId === null
					? null
					: await this.resolveParentRef(input.parentId);

			if (parentId !== existing.parentId) {
				group.parent_id = parentId;
				group.sort_order = await this.nextSortOrder(existing.name, parentId);
			}
		}

		const hasRowUpdates = Object.keys(updates).length > 0;
		const hasGroupUpdates = Object.keys(group).length > 0;
		if (hasRowUpdates || hasGroupUpdates) {
			await withTransaction(this.db, async (trx) => {
				if (hasRowUpdates) {
					await trx.updateTable("taxonomies").set(updates).where("id", "=", id).execute();
				}
				if (hasGroupUpdates) {
					await trx
						.updateTable("taxonomies")
						.set(group)
						.where("translation_group", "=", existing.translationGroup ?? existing.id)
						.execute();
				}
			});
			invalidateTaxonomyObjectCache();
		}

		return this.findById(id);
	}

	async reorder(groups: string[], siblings: readonly SiblingPosition[]): Promise<void> {
		const current = new Map(siblings.map(({ group, position }) => [group, position]));

		const listed: string[] = [];
		const occupied: number[] = [];
		for (const group of groups) {
			const position = current.get(group);
			if (position === undefined) continue;
			listed.push(group);
			occupied.push(position);
		}
		if (listed.length === 0) return;

		const target =
			new Set(occupied).size === occupied.length
				? permuteWithinSlots(listed, occupied)
				: renumberSiblings(listed, siblings);

		const changed = [...target].filter(([group, position]) => current.get(group) !== position);
		if (changed.length === 0) return;

		await this.applyPositions(changed);

		invalidateTaxonomyObjectCache();
	}

	private async applyPositions(positions: readonly (readonly [string, number])[]): Promise<void> {
		for (let index = 0; index < positions.length; index += GROUPS_PER_UPDATE) {
			const chunk = positions.slice(index, index + GROUPS_PER_UPDATE);
			const arms = sql.join(
				chunk.map(([group, position]) => sql`WHEN ${group} THEN CAST(${position} AS INTEGER)`),
				sql` `,
			);
			const keys = sql.join(chunk.map(([group]) => sql`${group}`));
			await sql`
				UPDATE taxonomies
				SET sort_order = CASE translation_group ${arms} END
				WHERE translation_group IN (${keys})
			`.execute(this.db);
		}
	}

	private async nextSortOrder(name: string, parentId: string | null): Promise<number> {
		let query = this.db
			.selectFrom("taxonomies")
			.select((eb) => eb.fn.max("sort_order").as("max"))
			.where("name", "=", name);
		query =
			parentId === null
				? query.where("parent_id", "is", null)
				: query.where("parent_id", "=", parentId);

		const bounds = await query.executeTakeFirst();
		if (!bounds || bounds.max === null) return 0;
		return bounds.max + 1;
	}

	async delete(id: string): Promise<boolean> {
		const term = await this.findById(id);
		if (!term) return false;

		if (term.translationGroup) {
			const siblings = await this.db
				.selectFrom("taxonomies")
				.select("id")
				.where("translation_group", "=", term.translationGroup)
				.where("id", "!=", id)
				.execute();
			if (siblings.length === 0) {
				await this.db
					.deleteFrom("content_taxonomies")
					.where("taxonomy_id", "=", term.translationGroup)
					.execute();
			}
		}

		const result = await this.db.deleteFrom("taxonomies").where("id", "=", id).executeTakeFirst();
		invalidateTaxonomyObjectCache();
		return (result.numDeletedRows ?? 0n) > 0n;
	}

	async attachToEntry(collection: string, entryId: string, taxonomyId: string): Promise<void> {
		const taxonomyGroup = await this.resolveTranslationGroup(taxonomyId);
		if (!taxonomyGroup) return;
		await this.attachGroupsToEntry(collection, entryId, [taxonomyGroup]);
	}

	async attachGroupsToEntry(
		collection: string,
		entryId: string,
		taxonomyGroups: string[],
	): Promise<number> {
		const uniqueGroups = [...new Set(taxonomyGroups)];
		if (uniqueGroups.length === 0) return 0;
		const entryGroup = await this.resolveEntryTranslationGroup(collection, entryId);
		if (!entryGroup) return 0;

		const result = await this.db
			.insertInto("content_taxonomies")
			.values(
				uniqueGroups.map((taxonomy_id) => ({
					collection,
					entry_id: entryGroup,
					taxonomy_id,
				})),
			)
			.onConflict((oc) => oc.doNothing())
			.executeTakeFirst();
		const inserted = Number(result.numInsertedOrUpdatedRows ?? 0n);
		if (inserted > 0) invalidateTaxonomyObjectCache();
		return inserted;
	}

	async detachFromEntry(collection: string, entryId: string, taxonomyId: string): Promise<void> {
		const [entryGroup, taxonomyGroup] = await Promise.all([
			this.resolveEntryTranslationGroup(collection, entryId),
			this.resolveTranslationGroup(taxonomyId),
		]);
		if (!entryGroup || !taxonomyGroup) return;

		await this.db
			.deleteFrom("content_taxonomies")
			.where("collection", "=", collection)
			.where("entry_id", "=", entryGroup)
			.where("taxonomy_id", "=", taxonomyGroup)
			.execute();
		invalidateTaxonomyObjectCache();
	}

	async getTermsForEntry(
		collection: string,
		entryId: string,
		taxonomyName?: string,
		locale?: string,
	): Promise<Taxonomy[]> {
		const entryGroup = await this.resolveEntryTranslationGroup(collection, entryId);
		if (!entryGroup) return [];

		let query = this.db
			.selectFrom("content_taxonomies")
			.innerJoin("taxonomies", "taxonomies.translation_group", "content_taxonomies.taxonomy_id")
			.selectAll("taxonomies")
			.where("content_taxonomies.collection", "=", collection)
			.where("content_taxonomies.entry_id", "=", entryGroup);

		if (taxonomyName) query = query.where("taxonomies.name", "=", taxonomyName);
		if (locale !== undefined) query = query.where("taxonomies.locale", "=", locale);

		const rows = await query.orderBy("taxonomies.locale", "asc").execute();
		return rows.map((row) => this.rowToTaxonomy(row));
	}

	async getTermAssignmentsForEntry(
		collection: string,
		entryId: string,
		taxonomyName: string,
		locale: string,
		defaultLocale: string,
	): Promise<TaxonomyAssignmentResolution[]> {
		const entryGroup = await this.resolveEntryTranslationGroup(collection, entryId);
		if (!entryGroup) return [];

		const rows = await this.db
			.selectFrom("content_taxonomies")
			.innerJoin("taxonomies", "taxonomies.translation_group", "content_taxonomies.taxonomy_id")
			.selectAll("taxonomies")
			.select("content_taxonomies.taxonomy_id as assignment_group")
			.where("content_taxonomies.collection", "=", collection)
			.where("content_taxonomies.entry_id", "=", entryGroup)
			.where("taxonomies.name", "=", taxonomyName)
			.orderBy("content_taxonomies.taxonomy_id", "asc")
			.orderBy("taxonomies.locale", "asc")
			.execute();

		const byGroup = new Map<string, Taxonomy[]>();
		for (const row of rows) {
			const variants = byGroup.get(row.assignment_group) ?? [];
			variants.push(this.rowToTaxonomy(row));
			byGroup.set(row.assignment_group, variants);
		}

		return Array.from(byGroup, ([translationGroup, variants]) => {
			const term =
				variants.find((variant) => variant.locale === locale) ??
				variants.find((variant) => variant.locale === defaultLocale) ??
				null;
			return {
				translationGroup,
				term,
				availableLocales: variants.map((variant) => variant.locale),
				translations: variants.map((variant) => ({
					id: variant.id,
					slug: variant.slug,
					locale: variant.locale,
				})),
			};
		});
	}

	async setTermsForEntry(
		collection: string,
		entryId: string,
		taxonomyName: string,
		termIds: string[],
	): Promise<void> {
		const entryGroup = await this.resolveEntryTranslationGroup(collection, entryId);
		if (!entryGroup) return;

		const groups: string[] = [];
		for (const id of termIds) {
			const group = await this.resolveTranslationGroup(id);
			if (group) groups.push(group);
		}
		const newGroups = new Set(groups);

		const current = await this.db
			.selectFrom("content_taxonomies")
			.innerJoin("taxonomies", "taxonomies.translation_group", "content_taxonomies.taxonomy_id")
			.select(["content_taxonomies.taxonomy_id as group"])
			.distinct()
			.where("content_taxonomies.collection", "=", collection)
			.where("content_taxonomies.entry_id", "=", entryGroup)
			.where("taxonomies.name", "=", taxonomyName)
			.execute();
		const currentGroups = new Set(current.map((r) => r.group));

		const toRemove = [...currentGroups].filter((g) => !newGroups.has(g));
		if (toRemove.length > 0) {
			await this.db
				.deleteFrom("content_taxonomies")
				.where("collection", "=", collection)
				.where("entry_id", "=", entryGroup)
				.where("taxonomy_id", "in", toRemove)
				.execute();
		}

		const toAdd = [...newGroups].filter((g) => !currentGroups.has(g));
		if (toAdd.length > 0) {
			await this.db
				.insertInto("content_taxonomies")
				.values(
					toAdd.map((taxonomy_id) => ({
						collection,
						entry_id: entryGroup,
						taxonomy_id,
					})),
				)
				.onConflict((oc) => oc.doNothing())
				.execute();
		}

		if (toRemove.length > 0 || toAdd.length > 0) invalidateTaxonomyObjectCache();
	}

	async clearEntryTerms(collection: string, entryId: string): Promise<number> {
		const entryGroup = await this.resolveEntryTranslationGroup(collection, entryId);
		if (!entryGroup) return 0;

		const result = await this.db
			.deleteFrom("content_taxonomies")
			.where("collection", "=", collection)
			.where("entry_id", "=", entryGroup)
			.executeTakeFirst();
		const removed = Number(result.numDeletedRows ?? 0);
		if (removed > 0) invalidateTaxonomyObjectCache();
		return removed;
	}

	private async resolveEntryTranslationGroup(
		collection: string,
		entryIdOrGroup: string,
	): Promise<string | null> {
		validateIdentifier(collection, "collection type");
		const tableName = `ec_${collection}`;
		const result = await sql<{ translation_group: string }>`
			SELECT translation_group
			FROM ${sql.ref(tableName)}
			WHERE id = ${entryIdOrGroup} OR translation_group = ${entryIdOrGroup}
			LIMIT 1
		`.execute(this.db);
		return result.rows[0]?.translation_group ?? null;
	}

	async countEntriesWithTerm(termIdOrGroup: string): Promise<number> {
		const group = await this.resolveTranslationGroup(termIdOrGroup);
		if (!group) return 0;

		const result = await this.db
			.selectFrom("content_taxonomies")
			.select((eb) => eb.fn.count("entry_id").as("count"))
			.where("taxonomy_id", "=", group)
			.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	private async resolveParentRef(idOrGroup: string): Promise<string> {
		const group = await this.resolveTranslationGroup(idOrGroup);
		if (!group) return idOrGroup;
		const anchor = await this.db
			.selectFrom("taxonomies")
			.select("id")
			.where("id", "=", group)
			.executeTakeFirst();
		return anchor ? group : idOrGroup;
	}

	private async resolveTranslationGroup(idOrGroup: string): Promise<string | null> {
		const row = await this.db
			.selectFrom("taxonomies")
			.select(["translation_group"])
			.where((eb) => eb.or([eb("id", "=", idOrGroup), eb("translation_group", "=", idOrGroup)]))
			.executeTakeFirst();
		return row?.translation_group ?? null;
	}

	async countEntriesForTerms(translationGroups: string[]): Promise<Map<string, number>> {
		if (translationGroups.length === 0) return new Map();

		const { chunks, SQL_BATCH_SIZE } = await import("../../utils/chunks.js");

		const counts = new Map<string, number>();
		for (const chunk of chunks(translationGroups, SQL_BATCH_SIZE)) {
			const rows = await this.db
				.selectFrom("content_taxonomies")
				.select(["taxonomy_id", (eb) => eb.fn.count("entry_id").as("count")])
				.where("taxonomy_id", "in", chunk)
				.groupBy("taxonomy_id")
				.execute();

			for (const row of rows) {
				counts.set(row.taxonomy_id, Number(row.count || 0));
			}
		}
		return counts;
	}

	private rowToTaxonomy(row: Selectable<TaxonomyTable>): Taxonomy {
		return {
			id: row.id,
			name: row.name,
			slug: row.slug,
			label: row.label,
			parentId: row.parent_id,
			data: row.data ? JSON.parse(row.data) : null,
			locale: row.locale,
			translationGroup: row.translation_group,
			sortOrder: row.sort_order,
		};
	}
}
