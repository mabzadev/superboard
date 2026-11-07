import {
	DataError,
	base64UrlDecode,
	base64UrlEncode,
	boundedInteger,
	isRecord,
} from "../platform/http.js";
import {
	coerceValue,
	quoteIdentifier,
	storedValue,
	type ColumnDefinition,
	type ColumnType,
	type TableDefinition,
} from "./schema.js";

const RESERVED_PARAMETERS = new Set([
	"select",
	"order",
	"limit",
	"cursor",
	"count",
	"upsert",
	"confirm",
]);

const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"] as const;
const MAXIMUM_BOUND_PARAMETERS = 90;
const MAXIMUM_IN_VALUES = 50;

interface QueryColumn {
	name: string;
	type: ColumnType;
}

export interface SqlFragment {
	sql: string;
	values: unknown[];
}

interface OrderSpec {
	column: string;
	direction: "asc" | "desc";
}

function queryColumns(table: TableDefinition): Map<string, QueryColumn> {
	const columns = new Map<string, QueryColumn>([
		["id", { name: "id", type: "uuid" }],
		["owner_id", { name: "owner_id", type: "text" }],
		["created_at", { name: "created_at", type: "timestamp" }],
		["updated_at", { name: "updated_at", type: "timestamp" }],
	]);
	for (const column of table.columns) columns.set(column.name, column);
	return columns;
}

export function parseFilters(params: URLSearchParams, table: TableDefinition): SqlFragment {
	const columns = queryColumns(table);
	const clauses: string[] = [];
	const values: unknown[] = [];
	for (const [key, raw] of params) {
		if (RESERVED_PARAMETERS.has(key)) continue;
		const column = columns.get(key);
		if (!column)
			throw new DataError(422, "filter_column_unknown", `Column ${key} does not exist`, {
				column: key,
			});
		const clause = filterClause(column, raw);
		clauses.push(clause.sql);
		values.push(...clause.values);
	}
	if (values.length > MAXIMUM_BOUND_PARAMETERS)
		throw new DataError(422, "query_too_complex", "The query has too many filter values");
	return { sql: clauses.join(" AND "), values };
}

export function hasFilters(params: URLSearchParams): boolean {
	for (const key of params.keys()) if (!RESERVED_PARAMETERS.has(key)) return true;
	return false;
}

export function parseSelect(params: URLSearchParams, table: TableDefinition): string[] | null {
	const raw = params.get("select");
	if (!raw || raw === "*") return null;
	const columns = queryColumns(table);
	const selected = new Set<string>(["id"]);
	for (const name of raw.split(",").map((value) => value.trim())) {
		if (!columns.has(name))
			throw new DataError(422, "select_column_unknown", `Column ${name} does not exist`, {
				column: name,
			});
		selected.add(name);
	}
	return [...selected];
}

export function parseOrder(params: URLSearchParams, table: TableDefinition): OrderSpec {
	const raw = params.get("order") ?? "created_at.asc";
	const [name = "", direction = "asc", extra] = raw.split(".");
	const column = queryColumns(table).get(name);
	if (
		!column ||
		column.type === "json" ||
		extra !== undefined ||
		(direction !== "asc" && direction !== "desc")
	)
		throw new DataError(422, "order_invalid", "order must be <column>.asc or <column>.desc");
	return { column: column.name, direction };
}

export function parseLimit(params: URLSearchParams): number {
	return boundedInteger(params.get("limit"), 50, 1, 100, "limit_invalid");
}

export function orderClause(order: OrderSpec): string {
	const direction = order.direction === "asc" ? "ASC" : "DESC";
	return order.column === "id"
		? `"id" ${direction}`
		: `${quoteIdentifier(order.column)} ${direction}, "id" ${direction}`;
}

export function encodeCursor(order: OrderSpec, row: Record<string, unknown>): string {
	return base64UrlEncode(
		new TextEncoder().encode(
			JSON.stringify({
				c: order.column,
				d: order.direction,
				v: row[order.column] ?? null,
				i: row.id,
			}),
		),
	);
}

export function cursorClause(
	raw: string | null,
	order: OrderSpec,
	table: TableDefinition,
): SqlFragment | null {
	if (!raw) return null;
	let decoded: unknown;
	try {
		decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(raw)));
	} catch {
		throw new DataError(422, "cursor_invalid", "cursor is invalid");
	}
	if (!isRecord(decoded)) throw new DataError(422, "cursor_invalid", "cursor is invalid");
	const parsed = decoded;
	if (parsed.c !== order.column || parsed.d !== order.direction || typeof parsed.i !== "string")
		throw new DataError(422, "cursor_invalid", "cursor does not match this order");
	const after = order.direction === "asc" ? ">" : "<";
	if (order.column === "id") return { sql: `"id" ${after} ?`, values: [parsed.i] };
	const column = queryColumns(table).get(order.column);
	if (!column) throw new DataError(422, "cursor_invalid", "cursor does not match this order");
	const quoted = quoteIdentifier(order.column);
	if (parsed.v === null)
		return order.direction === "asc"
			? { sql: `((${quoted} IS NULL AND "id" > ?) OR ${quoted} IS NOT NULL)`, values: [parsed.i] }
			: { sql: `(${quoted} IS NULL AND "id" < ?)`, values: [parsed.i] };
	const value = storedValue(column, parsed.v);
	return order.direction === "asc"
		? { sql: `(${quoted} > ? OR (${quoted} = ? AND "id" > ?))`, values: [value, value, parsed.i] }
		: {
				sql: `(${quoted} < ? OR (${quoted} = ? AND "id" < ?) OR ${quoted} IS NULL)`,
				values: [value, value, parsed.i],
			};
}

function filterClause(column: QueryColumn, raw: string): SqlFragment {
	const negated = raw.startsWith("not.");
	const expression = negated ? raw.slice(4) : raw;
	const separator = expression.indexOf(".");
	const name = separator < 0 ? expression : expression.slice(0, separator);
	const operand = separator < 0 ? "" : expression.slice(separator + 1);
	const operator = OPERATORS.find((candidate) => candidate === name);
	if (!operator)
		throw new DataError(
			422,
			"filter_operator_invalid",
			`Unknown operator in ${column.name}=${raw}`,
			{
				column: column.name,
			},
		);
	const quoted = quoteIdentifier(column.name);
	let clause: SqlFragment;
	if (operator === "is") {
		if (operand === "null") clause = { sql: `${quoted} IS NULL`, values: [] };
		else if ((operand === "true" || operand === "false") && column.type === "boolean")
			clause = { sql: `${quoted} = ?`, values: [operand === "true" ? 1 : 0] };
		else throw new DataError(422, "filter_value_invalid", "is accepts null, true or false");
	} else {
		if (column.type === "json")
			throw new DataError(422, "filter_column_invalid", "JSON columns accept only is.null");
		if (operator === "in") {
			const values = parseList(operand).map((item) => filterValue(column, item));
			if (values.length === 0 || values.length > MAXIMUM_IN_VALUES)
				throw new DataError(
					422,
					"filter_value_invalid",
					`in accepts 1 to ${MAXIMUM_IN_VALUES} values`,
				);
			clause = { sql: `${quoted} IN (${values.map(() => "?").join(", ")})`, values };
		} else if (operator === "like" || operator === "ilike") {
			if (column.type !== "text" && column.type !== "uuid")
				throw new DataError(422, "filter_operator_invalid", `${operator} applies to text columns`);
			clause =
				operator === "like"
					? {
							sql: `${quoted} GLOB ?`,
							values: [operand.replace(/[?[]/gu, (match) => `[${match}]`)],
						}
					: {
							sql: `${quoted} LIKE ? ESCAPE '\\'`,
							values: [operand.replace(/[\\%_]/gu, (match) => `\\${match}`).replaceAll("*", "%")],
						};
		} else {
			const comparison = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[operator];
			clause = { sql: `${quoted} ${comparison} ?`, values: [filterValue(column, operand)] };
		}
	}
	return negated ? { sql: `NOT (${clause.sql})`, values: clause.values } : clause;
}

function filterValue(column: QueryColumn, raw: string): unknown {
	let value: unknown = raw;
	if (column.type === "integer" || column.type === "number")
		value = raw === "" ? Number.NaN : Number(raw);
	if (column.type === "boolean") {
		if (raw !== "true" && raw !== "false")
			throw new DataError(422, "filter_value_invalid", `${column.name} expects true or false`);
		value = raw === "true";
	}
	const definition: Pick<ColumnDefinition, "name" | "type"> = {
		name: column.name,
		type: column.type,
	};
	try {
		return storedValue(definition, coerceValue(definition, value));
	} catch {
		throw new DataError(
			422,
			"filter_value_invalid",
			`${column.name} expects a ${column.type} value`,
			{
				column: column.name,
			},
		);
	}
}

function parseList(operand: string): string[] {
	if (!operand.startsWith("(") || !operand.endsWith(")"))
		throw new DataError(422, "filter_value_invalid", "in expects a list such as in.(a,b)");
	const values: string[] = [];
	let current = "";
	let quoted = false;
	const body = operand.slice(1, -1);
	for (let index = 0; index < body.length; index += 1) {
		const character = body.charAt(index);
		if (character === '"') {
			if (quoted && body.charAt(index + 1) === '"') {
				current += '"';
				index += 1;
			} else quoted = !quoted;
		} else if (character === "," && !quoted) {
			values.push(current);
			current = "";
		} else current += character;
	}
	if (quoted) throw new DataError(422, "filter_value_invalid", "in has an unterminated quote");
	values.push(current);
	return values;
}
