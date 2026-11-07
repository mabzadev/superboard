import type { DataEnv } from "../platform/env.js";
import { DataError, isRecord } from "../platform/http.js";

const MAXIMUM_QUERY_LENGTH = 10_000;
const MAXIMUM_ROWS = 500;
const WRITE_KEYWORDS =
	/\b(insert|update|delete|replace|upsert|drop|alter|create|attach|detach|pragma|vacuum|reindex|analyze|savepoint|release|begin|commit|rollback)\b/iu;
const FORBIDDEN_TABLES =
	/\b(data_[a-z0-9_]+|operator_[a-z0-9_]+|application_files|d1_[a-z0-9_]+|sqlite_[a-z0-9_]+|_cf_[a-z0-9_]+)\b/iu;

export interface SqlResult {
	columns: string[];
	rows: unknown[][];
	truncated: boolean;
}

export async function runReadOnlySql(
	env: DataEnv,
	projectId: number,
	body: unknown,
): Promise<SqlResult> {
	if (!isRecord(body) || typeof body.query !== "string")
		throw new DataError(422, "sql_invalid", "query must be a string");
	const query = body.query.trim().replace(/;+\s*$/u, "");
	if (!query || query.length > MAXIMUM_QUERY_LENGTH)
		throw new DataError(422, "sql_invalid", `query has 1 to ${MAXIMUM_QUERY_LENGTH} characters`);
	const code = withoutLiterals(query);
	if (code.includes(";") || code.includes("--") || code.includes("/*"))
		throw new DataError(422, "sql_single_statement", "Run one statement without comments");
	if (!/^\s*(select|with)\b/iu.test(code) || WRITE_KEYWORDS.test(code))
		throw new DataError(422, "sql_read_only", "Only SELECT queries are allowed");
	if (FORBIDDEN_TABLES.test(code))
		throw new DataError(403, "sql_table_forbidden", "System tables are not available here");
	for (const match of code.matchAll(/\badb_(\d+)_/giu))
		if (Number(match[1]) !== projectId)
			throw new DataError(
				403,
				"sql_table_forbidden",
				"Tables of another project are not available",
			);
	let raw: unknown[][];
	try {
		raw = await env.DB.prepare(`SELECT * FROM (${query}) LIMIT ${MAXIMUM_ROWS + 1}`).raw({
			columnNames: true,
		});
	} catch (cause) {
		throw new DataError(422, "sql_failed", cause instanceof Error ? cause.message : "Query failed");
	}
	const [columns = [], ...rows] = raw;
	return {
		columns: columns.map(String),
		rows: rows.slice(0, MAXIMUM_ROWS),
		truncated: rows.length > MAXIMUM_ROWS,
	};
}

function withoutLiterals(query: string): string {
	return query.replace(/'(?:[^']|'')*'/gu, "''");
}
