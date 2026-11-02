import type { Kysely, RawBuilder } from "kysely";
import { sql } from "kysely";

import { jsonExtractExpr, isPostgres } from "../database/dialect-helpers.js";
import type { Database } from "../database/types.js";
import {
	validateJsonFieldName,
	validatePluginIdentifier,
	validateStorageCollectionName,
} from "../database/validate.js";

export function generateIndexName(
	pluginId: string,
	collection: string,
	fields: string[],
	options?: { unique?: boolean },
): string {
	const prefix = options?.unique ? "uidx" : "idx";
	const fieldPart = fields.join("_");
	return `${prefix}_plugin_${pluginId}_${collection}_${fieldPart}`.substring(0, 128);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function generateCreateIndexSql(
	db: Kysely<any>,
	pluginId: string,
	collection: string,
	fields: string[],
	options?: { unique?: boolean },
): RawBuilder<unknown> {
	validatePluginIdentifier(pluginId, "plugin ID");
	validateStorageCollectionName(collection, "collection name");
	for (const field of fields) {
		validateJsonFieldName(field, "index field name");
	}

	const indexName = generateIndexName(pluginId, collection, fields, options);

	const expressions = fields
		.map((field) => {
			if (isPostgres(db)) {
				return `(${jsonExtractExpr(db, "data", field)})`;
			}
			return jsonExtractExpr(db, "data", field);
		})
		.join(", ");

	const createKeyword = options?.unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
	return sql`${sql.raw(createKeyword)} IF NOT EXISTS ${sql.ref(indexName)}
		ON _plugin_storage(plugin_id, collection, ${sql.raw(expressions)})
	`;
}

export function generateDropIndexSql(indexName: string): RawBuilder<unknown> {
	return sql`DROP INDEX IF EXISTS ${sql.ref(indexName)}`;
}

export function normalizeIndexes(indexes: Array<string | string[]>): string[][] {
	return indexes.map((index) => (Array.isArray(index) ? index : [index]));
}

export async function createStorageIndexes(
	db: Kysely<Database>,
	pluginId: string,
	collection: string,
	indexes: Array<string | string[]>,
	options?: { uniqueIndexes?: Array<string | string[]> },
): Promise<{
	created: string[];
	errors: Array<{ index: string; error: string }>;
}> {
	const normalized = normalizeIndexes(indexes);
	const uniqueNormalized = options?.uniqueIndexes ? normalizeIndexes(options.uniqueIndexes) : [];
	const uniqueSet = new Set(uniqueNormalized.map((f) => f.join(",")));

	const deduped = normalized.filter((f) => !uniqueSet.has(f.join(",")));
	const allEntries: Array<{ fields: string[]; unique: boolean }> = [
		...deduped.map((fields) => ({ fields, unique: false })),
		...uniqueNormalized.map((fields) => ({ fields, unique: true })),
	];

	const created: string[] = [];
	const errors: Array<{ index: string; error: string }> = [];

	for (const entry of allEntries) {
		const { fields } = entry;
		const indexName = generateIndexName(pluginId, collection, fields, { unique: entry.unique });

		try {
			const createSql = generateCreateIndexSql(db, pluginId, collection, fields, {
				unique: entry.unique,
			});
			await createSql.execute(db);

			await db
				.insertInto("_plugin_indexes")
				.values({
					plugin_id: pluginId,
					collection,
					index_name: indexName,
					fields: JSON.stringify(fields),
				})
				.onConflict((oc) =>
					oc
						.columns(["plugin_id", "collection", "index_name"])
						.doUpdateSet({ fields: JSON.stringify(fields) }),
				)
				.execute();

			created.push(indexName);
		} catch (error) {
			errors.push({
				index: indexName,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { created, errors };
}

export async function removeOrphanedIndexes(
	db: Kysely<Database>,
	pluginId: string,
	collection: string,
	currentIndexes: Array<string | string[]>,
	options?: { uniqueIndexes?: Array<string | string[]> },
): Promise<{
	removed: string[];
	errors: Array<{ index: string; error: string }>;
}> {
	const normalized = normalizeIndexes(currentIndexes);
	const uniqueNormalized = options?.uniqueIndexes ? normalizeIndexes(options.uniqueIndexes) : [];
	const uniqueSet = new Set(uniqueNormalized.map((f) => f.join(",")));

	const currentIndexNames = new Set<string>();
	for (const fields of normalized) {
		if (!uniqueSet.has(fields.join(","))) {
			currentIndexNames.add(generateIndexName(pluginId, collection, fields));
		}
	}
	for (const fields of uniqueNormalized) {
		currentIndexNames.add(generateIndexName(pluginId, collection, fields, { unique: true }));
	}

	const existingIndexes = await db
		.selectFrom("_plugin_indexes")
		.select(["index_name"])
		.where("plugin_id", "=", pluginId)
		.where("collection", "=", collection)
		.execute();

	const removed: string[] = [];
	const errors: Array<{ index: string; error: string }> = [];

	for (const { index_name } of existingIndexes) {
		if (!currentIndexNames.has(index_name)) {
			try {
				await generateDropIndexSql(index_name).execute(db);

				await db
					.deleteFrom("_plugin_indexes")
					.where("plugin_id", "=", pluginId)
					.where("collection", "=", collection)
					.where("index_name", "=", index_name)
					.execute();

				removed.push(index_name);
			} catch (error) {
				errors.push({
					index: index_name,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	return { removed, errors };
}

export async function syncStorageIndexes(
	db: Kysely<Database>,
	pluginId: string,
	collection: string,
	indexes: Array<string | string[]>,
	options?: { uniqueIndexes?: Array<string | string[]> },
): Promise<{
	created: string[];
	removed: string[];
	errors: Array<{ index: string; error: string }>;
}> {
	const [createResult, removeResult] = await Promise.all([
		createStorageIndexes(db, pluginId, collection, indexes, options),
		removeOrphanedIndexes(db, pluginId, collection, indexes, options),
	]);

	return {
		created: createResult.created,
		removed: removeResult.removed,
		errors: [...createResult.errors, ...removeResult.errors],
	};
}

export async function syncDeclaredStorageIndexes(
	db: Kysely<Database>,
	plugins: Array<{
		id: string;
		storage?: Record<
			string,
			{ indexes: Array<string | string[]>; uniqueIndexes?: Array<string | string[]> }
		>;
	}>,
): Promise<void> {
	for (const plugin of plugins) {
		for (const [collection, config] of Object.entries(plugin.storage ?? {})) {
			try {
				const result = await syncStorageIndexes(db, plugin.id, collection, config.indexes, {
					uniqueIndexes: config.uniqueIndexes,
				});
				for (const failure of result.errors) {
					console.error(
						`[plugins] Failed to sync storage index ${failure.index} for ${plugin.id}/${collection}: ${failure.error}`,
					);
				}
			} catch (error) {
				console.error(
					`[plugins] Failed to sync storage indexes for ${plugin.id}/${collection}:`,
					error,
				);
			}
		}
	}
}

export async function removeAllPluginIndexes(
	db: Kysely<Database>,
	pluginId: string,
): Promise<{
	removed: string[];
	errors: Array<{ index: string; error: string }>;
}> {
	const existingIndexes = await db
		.selectFrom("_plugin_indexes")
		.select(["index_name", "collection"])
		.where("plugin_id", "=", pluginId)
		.execute();

	const removed: string[] = [];
	const errors: Array<{ index: string; error: string }> = [];

	for (const { index_name } of existingIndexes) {
		try {
			await generateDropIndexSql(index_name).execute(db);
			removed.push(index_name);
		} catch (error) {
			errors.push({
				index: index_name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	await db.deleteFrom("_plugin_indexes").where("plugin_id", "=", pluginId).execute();

	return { removed, errors };
}

export async function getPluginIndexStatus(
	db: Kysely<Database>,
	pluginId: string,
): Promise<
	Array<{
		collection: string;
		indexName: string;
		fields: string[];
		createdAt: string;
	}>
> {
	const rows = await db
		.selectFrom("_plugin_indexes")
		.select(["collection", "index_name", "fields", "created_at"])
		.where("plugin_id", "=", pluginId)
		.execute();

	return rows.map((row) => {
		const parsed: unknown = JSON.parse(row.fields);
		const fields = Array.isArray(parsed)
			? parsed.filter((f): f is string => typeof f === "string")
			: [];
		return {
			collection: row.collection,
			indexName: row.index_name,
			fields,
			createdAt: row.created_at,
		};
	});
}
