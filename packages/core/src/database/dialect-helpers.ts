import type { ColumnDataType, Kysely, RawBuilder } from "kysely";
import { PostgresAdapter, sql } from "kysely";

import type { DatabaseDialectType } from "../db/adapters.js";
import { validateIdentifier, validateJsonFieldName } from "./validate.js";

export type { DatabaseDialectType };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function detectDialect(db: Kysely<any>): DatabaseDialectType {
	if (db.getExecutor().adapter instanceof PostgresAdapter) return "postgres";
	return "sqlite";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function isSqlite(db: Kysely<any>): boolean {
	return detectDialect(db) === "sqlite";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function isPostgres(db: Kysely<any>): boolean {
	return detectDialect(db) === "postgres";
}

export interface CompoundSelectLimitedAdapter {
	readonly compoundSelectLimit: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function compoundSelectLimit(db: Kysely<any>): number | null {
	const adapter: object = db.getExecutor().adapter;
	if (!("compoundSelectLimit" in adapter)) return null;

	const limit: unknown = adapter.compoundSelectLimit;
	if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
		throw new Error(
			`${adapter.constructor.name} declares compoundSelectLimit ${String(limit)}; it must be a positive integer.`,
		);
	}
	return limit;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function currentTimestamp(db: Kysely<any>): RawBuilder<string> {
	if (isPostgres(db)) {
		return sql`CURRENT_TIMESTAMP`;
	}
	return sql`(datetime('now'))`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function currentTimestampValue(db: Kysely<any>): RawBuilder<string> {
	if (isPostgres(db)) {
		return sql`CURRENT_TIMESTAMP`;
	}
	return sql`datetime('now')`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function buildStatusCondition(
	_db: Kysely<any>,
	status: string,
	tablePrefix?: string,
): ReturnType<typeof sql> {
	const statusField = tablePrefix ? `${tablePrefix}.status` : "status";
	return sql`${sql.ref(statusField)} = ${status}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export async function tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
	if (isPostgres(db)) {
		const result = await sql<{ exists: boolean }>`
			SELECT EXISTS(
				SELECT 1 FROM information_schema.tables
				WHERE table_schema = current_schema() AND table_name = ${tableName}
			) as exists
		`.execute(db);
		return result.rows[0]?.exists === true;
	}

	const result = await sql<{ name: string }>`
		SELECT name FROM sqlite_master
		WHERE type = 'table' AND name = ${tableName}
	`.execute(db);
	return result.rows.length > 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export async function indexExists(db: Kysely<any>, indexName: string): Promise<boolean> {
	if (isPostgres(db)) {
		const result = await sql<{ exists: boolean }>`
			SELECT EXISTS(
				SELECT 1 FROM pg_indexes
				WHERE schemaname = current_schema() AND indexname = ${indexName}
			) as exists
		`.execute(db);
		return result.rows[0]?.exists === true;
	}

	const result = await sql<{ name: string }>`
		SELECT name FROM sqlite_master
		WHERE type = 'index' AND name = ${indexName}
	`.execute(db);
	return result.rows.length > 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export async function columnExists(
	db: Kysely<any>,
	tableName: string,
	columnName: string,
): Promise<boolean> {
	if (isPostgres(db)) {
		const result = await sql<{ exists: boolean }>`
			SELECT EXISTS(
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = current_schema()
					AND table_name = ${tableName}
					AND column_name = ${columnName}
			) as exists
		`.execute(db);
		return result.rows[0]?.exists === true;
	}

	const result = await sql<{ name: string }>`
		SELECT name FROM pragma_table_info(${tableName})
		WHERE name = ${columnName}
	`.execute(db);
	return result.rows.length > 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export async function listTablesLike(db: Kysely<any>, pattern: string): Promise<string[]> {
	if (isPostgres(db)) {
		const result = await sql<{ table_name: string }>`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = current_schema() AND table_name LIKE ${pattern}
		`.execute(db);
		return result.rows.map((r) => r.table_name);
	}

	const result = await sql<{ name: string }>`
		SELECT name FROM sqlite_master
		WHERE type = 'table' AND name LIKE ${pattern}
	`.execute(db);
	return result.rows.map((r) => r.name);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function binaryType(db: Kysely<any>): ColumnDataType {
	if (isPostgres(db)) {
		return "bytea";
	}
	return "blob";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function jsonExtractExpr(db: Kysely<any>, column: string, path: string): string {
	validateIdentifier(column, "JSON column name");
	validateJsonFieldName(path, "JSON path");
	if (isPostgres(db)) {
		return `(${column})::jsonb->>'${path}'`;
	}
	return `json_extract(${column}, '$.${path}')`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function pluginDataExtractExpr(
	db: Kysely<any>,
	field: string,
	options?: { numeric?: boolean },
): string {
	validateJsonFieldName(field, "plugin storage field name");
	if (isPostgres(db)) {
		const text = `(data)::jsonb->>'${field}'`;
		if (!options?.numeric) return text;
		return `CASE WHEN jsonb_typeof((data)::jsonb->'${field}') = 'number' THEN (${text})::numeric END`;
	}
	const extract = `json_extract(data, '$.${field}')`;
	if (!options?.numeric) return extract;
	return `CASE WHEN json_type(data, '$.${field}') IN ('integer', 'real') THEN ${extract} END`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function pluginDataOrderExpr(db: Kysely<any>, field: string): string {
	validateJsonFieldName(field, "plugin storage order field name");
	if (isPostgres(db)) {
		return `(data)::jsonb->'${field}'`;
	}
	return `json_extract(data, '$.${field}')`;
}
