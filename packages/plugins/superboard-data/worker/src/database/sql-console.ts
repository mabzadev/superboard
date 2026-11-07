import type { DataEnv } from "../platform/env.js";
import { DataError, isRecord } from "../platform/http.js";

const MAXIMUM_QUERY_LENGTH = 10_000;
const MAXIMUM_ROWS = 500;
const FORBIDDEN_KEYWORDS = new Set([
	"insert",
	"update",
	"delete",
	"replace",
	"upsert",
	"drop",
	"alter",
	"create",
	"attach",
	"detach",
	"pragma",
	"vacuum",
	"reindex",
	"analyze",
	"savepoint",
	"release",
	"begin",
	"commit",
	"rollback",
	"load_extension",
]);

type TokenKind = "word" | "identifier" | "string" | "symbol";

interface Token {
	kind: TokenKind;
	value: string;
}

interface SqlResult {
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
	const tokens = tokenize(body.query);
	while (tokens.at(-1)?.value === ";") tokens.pop();
	if (tokens.length === 0 || body.query.length > MAXIMUM_QUERY_LENGTH)
		throw new DataError(422, "sql_invalid", `query has 1 to ${MAXIMUM_QUERY_LENGTH} characters`);
	if (tokens.some((token) => token.kind === "symbol" && token.value === ";"))
		throw new DataError(422, "sql_single_statement", "Run one statement at a time");
	const first = tokens[0];
	if (first?.kind !== "word" || !["select", "with"].includes(first.value.toLowerCase()))
		throw new DataError(422, "sql_read_only", "Only SELECT queries are allowed");
	for (const token of tokens)
		if (token.kind === "word" && FORBIDDEN_KEYWORDS.has(token.value.toLowerCase()))
			throw new DataError(422, "sql_read_only", "Only SELECT queries are allowed");
	await assertProjectTables(env, projectId, tokens);
	const query = body.query.trim().replace(/;+\s*$/u, "");
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

async function assertProjectTables(env: DataEnv, projectId: number, tokens: Token[]) {
	const { results } = await env.DB.prepare(
		"SELECT lower(name) AS name FROM sqlite_master WHERE type IN ('table', 'view')",
	)
		.bind()
		.all<{ name: string }>();
	const tables = new Set(results.map((row) => row.name));
	const own = `adb_${projectId}_`;
	for (const token of tokens) {
		if (token.kind === "symbol") continue;
		const name = token.value.toLowerCase();
		const foreignProject = /^adb_\d+_/u.test(name) && !name.startsWith(own);
		if (
			foreignProject ||
			/^(?:pragma_|sqlite_|_cf_)/u.test(name) ||
			(tables.has(name) && !name.startsWith(own))
		)
			throw new DataError(
				403,
				"sql_table_forbidden",
				"Only the tables of this project are available",
			);
	}
}

function tokenize(query: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;
	const quoted = (close: string, kind: TokenKind) => {
		let value = "";
		index += 1;
		for (;;) {
			if (index >= query.length)
				throw new DataError(422, "sql_invalid", "The query has an unterminated quote");
			const character = query.charAt(index);
			if (character === close) {
				if (close !== "]" && query.charAt(index + 1) === close) {
					value += close;
					index += 2;
					continue;
				}
				index += 1;
				return { kind, value };
			}
			value += character;
			index += 1;
		}
	};
	while (index < query.length) {
		const character = query.charAt(index);
		const next = query.charAt(index + 1);
		if (/\s/u.test(character)) index += 1;
		else if ((character === "-" && next === "-") || (character === "/" && next === "*"))
			throw new DataError(422, "sql_comment_forbidden", "Remove comments from the query");
		else if (character === "'") tokens.push(quoted("'", "string"));
		else if (character === '"') tokens.push(quoted('"', "identifier"));
		else if (character === "`") tokens.push(quoted("`", "identifier"));
		else if (character === "[") tokens.push(quoted("]", "identifier"));
		else if (/[A-Za-z_]/u.test(character)) {
			const match = /^[A-Za-z_][A-Za-z0-9_$]*/u.exec(query.slice(index));
			const value = match?.[0] ?? character;
			tokens.push({ kind: "word", value });
			index += value.length;
		} else {
			tokens.push({ kind: "symbol", value: character });
			index += 1;
		}
	}
	return tokens;
}
