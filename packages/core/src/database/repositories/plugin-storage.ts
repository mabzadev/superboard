import type { Kysely, RawBuilder } from "kysely";
import { sql } from "kysely";

import {
	buildWhereClause,
	validateWhereClause,
	validateOrderByClause,
	getIndexedFields,
	jsonOrderExtract,
} from "../../plugins/storage-query.js";
import type {
	StorageCollection,
	QueryOptions,
	PaginatedResult,
	WhereClause,
} from "../../plugins/types.js";
import { withTransaction } from "../transaction.js";
import type { Database } from "../types.js";
import { encodeCursor, decodeCursor } from "./types.js";

function rawWhereExpr(sqlText: string, params: unknown[]): RawBuilder<boolean> {
	const parts: ReturnType<typeof sql>[] = [];
	let paramIndex = 0;
	const sqlParts = sqlText.split("?");
	for (let i = 0; i < sqlParts.length; i++) {
		if (i > 0) {
			parts.push(sql`${params[paramIndex++]}`);
		}
		if (sqlParts[i]) {
			parts.push(sql.raw(sqlParts[i]));
		}
	}
	return sql<boolean>`(${sql.join(parts, sql.raw(""))})`;
}

export class PluginStorageRepository<T = unknown> implements StorageCollection<T> {
	private indexedFields: Set<string>;

	constructor(
		private db: Kysely<Database>,
		private pluginId: string,
		private collection: string,
		indexes: Array<string | string[]>,
	) {
		this.indexedFields = getIndexedFields(indexes);
	}

	async get(id: string): Promise<T | null> {
		const row = await this.db
			.selectFrom("_plugin_storage")
			.select("data")
			.where("plugin_id", "=", this.pluginId)
			.where("collection", "=", this.collection)
			.where("id", "=", id)
			.executeTakeFirst();

		if (!row) return null;
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns any; generic callers provide T
		return JSON.parse(row.data) as T;
	}

	async put(id: string, data: T): Promise<void> {
		const now = new Date().toISOString();
		const jsonData = JSON.stringify(data);

		await this.db
			.insertInto("_plugin_storage")
			.values({
				plugin_id: this.pluginId,
				collection: this.collection,
				id,
				data: jsonData,
				created_at: now,
				updated_at: now,
			})
			.onConflict((oc) =>
				oc.columns(["plugin_id", "collection", "id"]).doUpdateSet({
					data: jsonData,
					updated_at: now,
				}),
			)
			.execute();
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db
			.deleteFrom("_plugin_storage")
			.where("plugin_id", "=", this.pluginId)
			.where("collection", "=", this.collection)
			.where("id", "=", id)
			.executeTakeFirst();

		return (result.numDeletedRows ?? 0) > 0;
	}

	async exists(id: string): Promise<boolean> {
		const row = await this.db
			.selectFrom("_plugin_storage")
			.select("id")
			.where("plugin_id", "=", this.pluginId)
			.where("collection", "=", this.collection)
			.where("id", "=", id)
			.executeTakeFirst();

		return !!row;
	}

	async getMany(ids: string[]): Promise<Map<string, T>> {
		if (ids.length === 0) return new Map();

		const rows = await this.db
			.selectFrom("_plugin_storage")
			.select(["id", "data"])
			.where("plugin_id", "=", this.pluginId)
			.where("collection", "=", this.collection)
			.where("id", "in", ids)
			.execute();

		const result = new Map<string, T>();
		for (const row of rows) {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns any; generic callers provide T
			result.set(row.id, JSON.parse(row.data) as T);
		}
		return result;
	}

	async putMany(items: Array<{ id: string; data: T }>): Promise<void> {
		if (items.length === 0) return;

		const now = new Date().toISOString();

		await withTransaction(this.db, async (trx) => {
			for (const item of items) {
				const jsonData = JSON.stringify(item.data);
				await trx
					.insertInto("_plugin_storage")
					.values({
						plugin_id: this.pluginId,
						collection: this.collection,
						id: item.id,
						data: jsonData,
						created_at: now,
						updated_at: now,
					})
					.onConflict((oc) =>
						oc.columns(["plugin_id", "collection", "id"]).doUpdateSet({
							data: jsonData,
							updated_at: now,
						}),
					)
					.execute();
			}
		});
	}

	async deleteMany(ids: string[]): Promise<number> {
		if (ids.length === 0) return 0;

		const result = await this.db
			.deleteFrom("_plugin_storage")
			.where("plugin_id", "=", this.pluginId)
			.where("collection", "=", this.collection)
			.where("id", "in", ids)
			.executeTakeFirst();

		return Number(result.numDeletedRows ?? 0);
	}

	async query(options: QueryOptions = {}): Promise<PaginatedResult<{ id: string; data: T }>> {
		const { where = {}, orderBy = {}, cursor } = options;
		const limit = Math.min(options.limit ?? 50, 100);

		validateWhereClause(where, this.indexedFields, this.pluginId, this.collection);
		if (Object.keys(orderBy).length > 0) {
			validateOrderByClause(orderBy, this.indexedFields, this.pluginId, this.collection);
		}

		let query = this.db
			.selectFrom("_plugin_storage")
			.select(["id", "data", "created_at"])
			.where("plugin_id", "=", this.pluginId)
			.where("collection", "=", this.collection);

		const whereResult = buildWhereClause(this.db, where);
		if (whereResult.sql) {
			query = query.where(rawWhereExpr(whereResult.sql, whereResult.params));
		}

		if (cursor) {
			const decoded = decodeCursor(cursor);
			query = query.where(({ eb }) =>
				eb(sql`(created_at, id)`, ">", sql`(${decoded.orderValue}, ${decoded.id})`),
			);
		}

		if (Object.keys(orderBy).length > 0) {
			for (const [field, direction] of Object.entries(orderBy)) {
				const extract = jsonOrderExtract(this.db, field);
				const orderExpr =
					direction === "desc" ? sql`${sql.raw(extract)} desc` : sql`${sql.raw(extract)} asc`;
				query = query.orderBy(orderExpr);
			}
		} else {
			query = query.orderBy("created_at", "asc").orderBy("id", "asc");
		}

		query = query.limit(limit + 1);

		const rows = await query.execute();

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map((row) => ({
			id: row.id,
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns any; generic callers provide T
			data: JSON.parse(row.data) as T,
		}));

		let nextCursor: string | undefined;
		if (hasMore) {
			const lastItem = rows[limit - 1];
			if (lastItem) {
				nextCursor = encodeCursor(lastItem.created_at, lastItem.id);
			}
		}

		return { items, cursor: nextCursor, hasMore };
	}

	async count(where?: WhereClause): Promise<number> {
		if (where && Object.keys(where).length > 0) {
			validateWhereClause(where, this.indexedFields, this.pluginId, this.collection);
		}

		let query = this.db
			.selectFrom("_plugin_storage")
			.select(sql<number>`COUNT(*)`.as("count"))
			.where("plugin_id", "=", this.pluginId)
			.where("collection", "=", this.collection);

		if (where && Object.keys(where).length > 0) {
			const whereResult = buildWhereClause(this.db, where);
			if (whereResult.sql) {
				query = query.where(rawWhereExpr(whereResult.sql, whereResult.params));
			}
		}

		const result = await query.executeTakeFirst();
		return Number(result?.count ?? 0);
	}
}

export function createPluginStorageAccessor(
	db: Kysely<Database>,
	pluginId: string,
	storageConfig: Record<
		string,
		{ indexes: Array<string | string[]>; uniqueIndexes?: Array<string | string[]> }
	>,
): Record<string, StorageCollection> {
	const accessor: Record<string, StorageCollection> = {};

	for (const [collectionName, config] of Object.entries(storageConfig)) {
		const allIndexes = [...config.indexes, ...(config.uniqueIndexes ?? [])];
		accessor[collectionName] = new PluginStorageRepository(
			db,
			pluginId,
			collectionName,
			allIndexes,
		);
	}

	return accessor;
}

export async function deleteAllPluginStorage(
	db: Kysely<Database>,
	pluginId: string,
): Promise<number> {
	const result = await db
		.deleteFrom("_plugin_storage")
		.where("plugin_id", "=", pluginId)
		.executeTakeFirst();

	return Number(result.numDeletedRows ?? 0);
}

export async function deletePluginCollection(
	db: Kysely<Database>,
	pluginId: string,
	collection: string,
): Promise<number> {
	const result = await db
		.deleteFrom("_plugin_storage")
		.where("plugin_id", "=", pluginId)
		.where("collection", "=", collection)
		.executeTakeFirst();

	return Number(result.numDeletedRows ?? 0);
}
