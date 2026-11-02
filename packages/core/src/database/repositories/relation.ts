import type { Kysely, Selectable } from "kysely";
import { ulid } from "ulidx";

import { chunks, SQL_BATCH_SIZE } from "../../utils/chunks.js";
import type { Database, RelationTable, ContentReferenceTable } from "../types.js";
import { decodeCursor, encodeCursor, InvalidCursorError, type FindManyResult } from "./types.js";

export interface Relation {
	id: string;
	name: string;
	parentCollection: string;
	childCollection: string;
	parentLabel: string;
	childLabel: string;
	locale: string;
	translationGroup: string;
}

export interface CreateRelationInput {
	name: string;
	parentCollection?: string;
	childCollection?: string;
	parentLabel: string;
	childLabel: string;
	locale?: string;
	translationOf?: string;
}

export interface UpdateRelationInput {
	parentLabel?: string;
	childLabel?: string;
}

export interface ContentReference {
	id: string;
	relationGroup: string;
	parentGroup: string;
	childGroup: string;
	sortOrder: number;
}

export class RelationRepository {
	constructor(private db: Kysely<Database>) {}

	async create(input: CreateRelationInput): Promise<Relation> {
		const id = ulid();
		const now = new Date().toISOString();

		let translationGroup = id;
		let name: string;
		let parentCollection: string;
		let childCollection: string;

		if (input.translationOf) {
			const source = await this.findById(input.translationOf);
			if (!source) throw new Error("Source relation for translation not found");
			translationGroup = source.translationGroup;
			name = source.name;
			parentCollection = source.parentCollection;
			childCollection = source.childCollection;
		} else {
			if (input.parentCollection === undefined || input.childCollection === undefined) {
				throw new Error(
					"parentCollection and childCollection are required unless translationOf is set",
				);
			}
			name = input.name;
			parentCollection = input.parentCollection;
			childCollection = input.childCollection;
		}

		await this.db
			.insertInto("_emdash_relations")
			.values({
				id,
				name,
				parent_collection: parentCollection,
				child_collection: childCollection,
				parent_label: input.parentLabel,
				child_label: input.childLabel,
				created_at: now,
				updated_at: now,
				...(input.locale !== undefined ? { locale: input.locale } : {}),
				translation_group: translationGroup,
			})
			.execute();

		const relation = await this.findById(id);
		if (!relation) throw new Error("Failed to create relation");
		return relation;
	}

	async findById(id: string): Promise<Relation | null> {
		const row = await this.db
			.selectFrom("_emdash_relations")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst();
		return row ? this.rowToRelation(row) : null;
	}

	async findByName(name: string, locale?: string): Promise<Relation | null> {
		let query = this.db.selectFrom("_emdash_relations").selectAll().where("name", "=", name);
		if (locale !== undefined) query = query.where("locale", "=", locale);
		const row = await query.orderBy("locale", "asc").executeTakeFirst();
		return row ? this.rowToRelation(row) : null;
	}

	async findTranslations(translationGroup: string): Promise<Relation[]> {
		const rows = await this.db
			.selectFrom("_emdash_relations")
			.selectAll()
			.where("translation_group", "=", translationGroup)
			.orderBy("locale", "asc")
			.execute();
		return rows.map((row) => this.rowToRelation(row));
	}

	async list(locale?: string): Promise<Relation[]> {
		let query = this.db
			.selectFrom("_emdash_relations")
			.selectAll()
			.orderBy("name", "asc")
			.orderBy("id", "asc");
		if (locale !== undefined) query = query.where("locale", "=", locale);
		const rows = await query.execute();
		return rows.map((row) => this.rowToRelation(row));
	}

	async findForCollection(collection: string, locale?: string): Promise<Relation[]> {
		let query = this.db
			.selectFrom("_emdash_relations")
			.selectAll()
			.where((eb) =>
				eb.or([eb("parent_collection", "=", collection), eb("child_collection", "=", collection)]),
			)
			.orderBy("name", "asc")
			.orderBy("id", "asc");
		if (locale !== undefined) query = query.where("locale", "=", locale);
		const rows = await query.execute();
		return rows.map((row) => this.rowToRelation(row));
	}

	async update(id: string, input: UpdateRelationInput): Promise<Relation | null> {
		const existing = await this.findById(id);
		if (!existing) return null;

		const updates: Record<string, unknown> = {};
		if (input.parentLabel !== undefined) updates.parent_label = input.parentLabel;
		if (input.childLabel !== undefined) updates.child_label = input.childLabel;

		if (Object.keys(updates).length > 0) {
			updates.updated_at = new Date().toISOString();
			await this.db.updateTable("_emdash_relations").set(updates).where("id", "=", id).execute();
		}

		return this.findById(id);
	}

	async delete(id: string): Promise<boolean> {
		const relation = await this.findById(id);
		if (!relation) return false;

		const siblings = await this.db
			.selectFrom("_emdash_relations")
			.select("id")
			.where("translation_group", "=", relation.translationGroup)
			.where("id", "!=", id)
			.execute();
		if (siblings.length === 0) {
			await this.db
				.deleteFrom("_emdash_content_references")
				.where("relation_group", "=", relation.translationGroup)
				.execute();
		}

		const result = await this.db
			.deleteFrom("_emdash_relations")
			.where("id", "=", id)
			.executeTakeFirst();
		return (result.numDeletedRows ?? 0n) > 0n;
	}

	private async resolveRelationGroup(idOrGroup: string): Promise<string | null> {
		const row = await this.db
			.selectFrom("_emdash_relations")
			.select(["translation_group"])
			.where((eb) => eb.or([eb("id", "=", idOrGroup), eb("translation_group", "=", idOrGroup)]))
			.executeTakeFirst();
		return row?.translation_group ?? null;
	}

	private rowToReference(row: Selectable<ContentReferenceTable>): ContentReference {
		return {
			id: row.id,
			relationGroup: row.relation_group,
			parentGroup: row.parent_group,
			childGroup: row.child_group,
			sortOrder: row.sort_order,
		};
	}

	async addReference(
		relation: string,
		parentGroup: string,
		childGroup: string,
		sortOrder?: number,
	): Promise<void> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return;

		let order = sortOrder;
		if (order === undefined) {
			const max = await this.db
				.selectFrom("_emdash_content_references")
				.select((eb) => eb.fn.max("sort_order").as("max"))
				.where("relation_group", "=", relationGroup)
				.where("parent_group", "=", parentGroup)
				.executeTakeFirst();
			order = max?.max === null || max?.max === undefined ? 0 : Number(max.max) + 1;
		}

		await this.db
			.insertInto("_emdash_content_references")
			.values({
				id: ulid(),
				relation_group: relationGroup,
				parent_group: parentGroup,
				child_group: childGroup,
				sort_order: order,
				created_at: new Date().toISOString(),
			})
			.onConflict((oc) => oc.doNothing())
			.execute();
	}

	async removeReference(relation: string, parentGroup: string, childGroup: string): Promise<void> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return;

		await this.db
			.deleteFrom("_emdash_content_references")
			.where("relation_group", "=", relationGroup)
			.where("parent_group", "=", parentGroup)
			.where("child_group", "=", childGroup)
			.execute();
	}

	async getChildren(relation: string, parentGroup: string): Promise<ContentReference[]> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return [];

		const rows = await this.db
			.selectFrom("_emdash_content_references")
			.selectAll()
			.where("relation_group", "=", relationGroup)
			.where("parent_group", "=", parentGroup)
			.orderBy("sort_order", "asc")
			.orderBy("id", "asc")
			.execute();
		return rows.map((row) => this.rowToReference(row));
	}

	async getChildrenPage(
		relation: string,
		parentGroup: string,
		options: { limit?: number; cursor?: string } = {},
	): Promise<FindManyResult<ContentReference>> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return { items: [] };

		const limit = Math.min(options.limit || 50, 100);

		let query = this.db
			.selectFrom("_emdash_content_references")
			.selectAll()
			.where("relation_group", "=", relationGroup)
			.where("parent_group", "=", parentGroup);

		if (options.cursor) {
			const decoded = decodeCursor(options.cursor);
			const sortOrder = Number(decoded.orderValue);
			if (!Number.isFinite(sortOrder)) throw new InvalidCursorError(options.cursor);
			query = query.where((eb) =>
				eb.or([
					eb("sort_order", ">", sortOrder),
					eb.and([eb("sort_order", "=", sortOrder), eb("id", ">", decoded.id)]),
				]),
			);
		}

		const rows = await query
			.orderBy("sort_order", "asc")
			.orderBy("id", "asc")
			.limit(limit + 1)
			.execute();

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map((row) => this.rowToReference(row));
		const result: FindManyResult<ContentReference> = { items };
		const last = items.at(-1);
		if (hasMore && last) {
			result.nextCursor = encodeCursor(String(last.sortOrder), last.id);
		}
		return result;
	}

	async getParents(relation: string, childGroup: string): Promise<ContentReference[]> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return [];

		const rows = await this.db
			.selectFrom("_emdash_content_references")
			.selectAll()
			.where("relation_group", "=", relationGroup)
			.where("child_group", "=", childGroup)
			.orderBy("id", "asc")
			.execute();
		return rows.map((row) => this.rowToReference(row));
	}

	async setChildren(relation: string, parentGroup: string, childGroups: string[]): Promise<void> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return;

		await this.db
			.deleteFrom("_emdash_content_references")
			.where("relation_group", "=", relationGroup)
			.where("parent_group", "=", parentGroup)
			.execute();

		const uniqueChildGroups = [...new Set(childGroups)];
		if (uniqueChildGroups.length === 0) return;

		const now = new Date().toISOString();
		await this.db
			.insertInto("_emdash_content_references")
			.values(
				uniqueChildGroups.map((childGroup, index) => ({
					id: ulid(),
					relation_group: relationGroup,
					parent_group: parentGroup,
					child_group: childGroup,
					sort_order: index,
					created_at: now,
				})),
			)
			.onConflict((oc) => oc.doNothing())
			.execute();
	}

	async getParentsPage(
		relation: string,
		childGroup: string,
		options: { limit?: number; cursor?: string } = {},
	): Promise<FindManyResult<ContentReference>> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return { items: [] };

		const limit = Math.min(options.limit || 50, 100);

		let query = this.db
			.selectFrom("_emdash_content_references")
			.selectAll()
			.where("relation_group", "=", relationGroup)
			.where("child_group", "=", childGroup);

		if (options.cursor) {
			const decoded = decodeCursor(options.cursor);
			query = query.where("id", ">", decoded.id);
		}

		const rows = await query
			.orderBy("id", "asc")
			.limit(limit + 1)
			.execute();

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map((row) => this.rowToReference(row));
		const result: FindManyResult<ContentReference> = { items };
		const last = items.at(-1);
		if (hasMore && last) {
			result.nextCursor = encodeCursor(last.id, last.id);
		}
		return result;
	}

	async clearReferencesForGroup(group: string): Promise<number> {
		const result = await this.db
			.deleteFrom("_emdash_content_references")
			.where((eb) => eb.or([eb("parent_group", "=", group), eb("child_group", "=", group)]))
			.executeTakeFirst();
		return Number(result.numDeletedRows ?? 0);
	}

	async countChildren(relation: string, parentGroup: string): Promise<number> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return 0;
		const result = await this.db
			.selectFrom("_emdash_content_references")
			.select((eb) => eb.fn.count("id").as("count"))
			.where("relation_group", "=", relationGroup)
			.where("parent_group", "=", parentGroup)
			.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	async countParents(relation: string, childGroup: string): Promise<number> {
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return 0;
		const result = await this.db
			.selectFrom("_emdash_content_references")
			.select((eb) => eb.fn.count("id").as("count"))
			.where("relation_group", "=", relationGroup)
			.where("child_group", "=", childGroup)
			.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	async countChildrenForParents(
		relation: string,
		parentGroups: string[],
	): Promise<Map<string, number>> {
		const counts = new Map<string, number>();
		if (parentGroups.length === 0) return counts;
		const relationGroup = await this.resolveRelationGroup(relation);
		if (!relationGroup) return counts;

		for (const chunk of chunks(parentGroups, SQL_BATCH_SIZE)) {
			const rows = await this.db
				.selectFrom("_emdash_content_references")
				.select(["parent_group", (eb) => eb.fn.count("id").as("count")])
				.where("relation_group", "=", relationGroup)
				.where("parent_group", "in", chunk)
				.groupBy("parent_group")
				.execute();
			for (const row of rows) {
				counts.set(row.parent_group, Number(row.count ?? 0));
			}
		}
		return counts;
	}

	private rowToRelation(row: Selectable<RelationTable>): Relation {
		return {
			id: row.id,
			name: row.name,
			parentCollection: row.parent_collection,
			childCollection: row.child_collection,
			parentLabel: row.parent_label,
			childLabel: row.child_label,
			locale: row.locale,
			translationGroup: row.translation_group,
		};
	}
}
