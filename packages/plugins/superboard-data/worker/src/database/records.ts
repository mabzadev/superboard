import type { Caller } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import { DataError, isRecord, nowIso } from "../platform/http.js";
import { assertAllowed, ownerScope } from "../platform/policy.js";
import {
	cursorClause,
	encodeCursor,
	hasFilters,
	orderClause,
	parseFilters,
	parseLimit,
	parseOrder,
	parseSelect,
	type SqlFragment,
} from "./query.js";
import {
	UUID_PATTERN,
	coerceValue,
	physicalTable,
	quoteIdentifier,
	storedValue,
	type TableDefinition,
} from "./schema.js";

export type Row = Record<string, unknown>;

export interface RowChange {
	event: "INSERT" | "UPDATE" | "DELETE";
	record: Row | null;
	old_record: Row | null;
}

export interface WriteResult {
	rows: Row[];
	changes: RowChange[];
}

const MAXIMUM_BATCH = 100;
const MAXIMUM_BOUND_PARAMETERS = 100;
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;

export async function listRows(
	env: DataEnv,
	caller: Caller,
	projectId: number,
	table: TableDefinition,
	params: URLSearchParams,
): Promise<{ items: Row[]; nextCursor?: string; count?: number }> {
	assertAllowed(table.rules.read, caller, "read this table");
	const filters = parseFilters(params, table);
	const order = parseOrder(params, table);
	const limit = parseLimit(params);
	const select = parseSelect(params, table);
	const owner = ownerFragment(ownerScope(table.rules.read, caller));
	const cursor = cursorClause(params.get("cursor"), order, table);
	const quoted = quoteIdentifier(physicalTable(projectId, table.name));
	const scope = where([filters, owner]);
	const page = where([filters, owner, cursor]);
	const projection = select
		? [...new Set([...select, order.column])].map(quoteIdentifier).join(", ")
		: "*";
	const { results } = await env.DB.prepare(
		`SELECT ${projection} FROM ${quoted}${page.sql} ORDER BY ${orderClause(order)} LIMIT ?`,
	)
		.bind(...page.values, limit + 1)
		.all<Row>();
	const visible = results.slice(0, limit);
	const response: { items: Row[]; nextCursor?: string; count?: number } = {
		items: visible.map((row) => serializeRow(table, row, select)),
	};
	const last = visible.at(-1);
	if (results.length > limit && last)
		response.nextCursor = encodeCursor(order, serializeRow(table, last, null));
	if (params.get("count") === "exact") {
		const counted = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${quoted}${scope.sql}`)
			.bind(...scope.values)
			.first<{ total: number }>();
		response.count = Number(counted?.total ?? 0);
	}
	return response;
}

export async function getRow(
	env: DataEnv,
	caller: Caller,
	projectId: number,
	table: TableDefinition,
	id: string,
	params: URLSearchParams,
): Promise<Row> {
	assertAllowed(table.rules.read, caller, "read this table");
	const select = parseSelect(params, table);
	const scope = where([idFragment(id), ownerFragment(ownerScope(table.rules.read, caller))]);
	const row = await env.DB.prepare(
		`SELECT * FROM ${quoteIdentifier(physicalTable(projectId, table.name))}${scope.sql}`,
	)
		.bind(...scope.values)
		.first<Row>();
	if (!row) throw notFound();
	return serializeRow(table, row, select);
}

export async function insertRows(
	env: DataEnv,
	caller: Caller,
	projectId: number,
	table: TableDefinition,
	body: unknown,
	options: { upsert: boolean },
): Promise<WriteResult> {
	assertAllowed(table.rules.insert, caller, "insert rows");
	if (options.upsert) assertAllowed(table.rules.update, caller, "update rows");
	const inputs = Array.isArray(body) ? body : [body];
	if (inputs.length === 0 || inputs.length > MAXIMUM_BATCH)
		throw new DataError(422, "batch_invalid", `Insert 1 to ${MAXIMUM_BATCH} rows at once`);
	const now = nowIso();
	const quoted = quoteIdentifier(physicalTable(projectId, table.name));
	const updateOwner = options.upsert ? ownerScope(table.rules.update, caller) : null;
	const statements = inputs.map((input) => {
		const values = insertValues(table, caller, input, now);
		const names = [...values.keys()];
		const columns = names.map(quoteIdentifier).join(", ");
		const placeholders = names.map(() => "?").join(", ");
		let sql = `INSERT INTO ${quoted} (${columns}) VALUES (${placeholders})`;
		const bound = [...values.values()];
		if (options.upsert) {
			const updates = names
				.filter((name) => !["id", "owner_id", "created_at"].includes(name))
				.map((name) => `${quoteIdentifier(name)} = excluded.${quoteIdentifier(name)}`);
			sql += ` ON CONFLICT("id") DO UPDATE SET ${updates.join(", ")}`;
			if (updateOwner !== null) {
				sql += ` WHERE ${quoted}."owner_id" = ?`;
				bound.push(updateOwner);
			}
		}
		if (bound.length > MAXIMUM_BOUND_PARAMETERS)
			throw new DataError(422, "query_too_complex", "The row has too many values");
		return env.DB.prepare(`${sql} RETURNING *`).bind(...bound);
	});
	let results: D1Result<Row>[];
	try {
		results = await env.DB.batch<Row>(statements);
	} catch (cause) {
		throw constraintError(cause);
	}
	const rows = results.map((result) => {
		const row = result.results[0];
		if (!row)
			throw new DataError(409, "upsert_denied", "An existing row cannot be updated by this caller");
		return serializeRow(table, row, null);
	});
	return {
		rows,
		changes: rows.map((row) => ({
			event: row.created_at === now || !options.upsert ? "INSERT" : "UPDATE",
			record: row,
			old_record: null,
		})),
	};
}

export async function updateRows(
	env: DataEnv,
	caller: Caller,
	projectId: number,
	table: TableDefinition,
	selection: { id: string } | { params: URLSearchParams },
	body: unknown,
): Promise<WriteResult> {
	assertAllowed(table.rules.update, caller, "update rows");
	const assignments = updateValues(table, caller, body);
	assignments.set("updated_at", nowIso());
	const set: SqlFragment = {
		sql: [...assignments.keys()].map((name) => `${quoteIdentifier(name)} = ?`).join(", "),
		values: [...assignments.values()],
	};
	const target = selectionFragment(
		projectId,
		table,
		selection,
		ownerScope(table.rules.update, caller),
	);
	if (set.values.length + target.values.length > MAXIMUM_BOUND_PARAMETERS)
		throw new DataError(422, "query_too_complex", "The update has too many values");
	let results: Row[];
	try {
		({ results } = await env.DB.prepare(
			`UPDATE ${quoteIdentifier(physicalTable(projectId, table.name))} SET ${set.sql}${target.sql} RETURNING *`,
		)
			.bind(...set.values, ...target.values)
			.all<Row>());
	} catch (cause) {
		throw constraintError(cause);
	}
	if ("id" in selection && results.length === 0) throw notFound();
	const rows = results.map((row) => serializeRow(table, row, null));
	return { rows, changes: rows.map((row) => ({ event: "UPDATE", record: row, old_record: null })) };
}

export async function deleteRows(
	env: DataEnv,
	caller: Caller,
	projectId: number,
	table: TableDefinition,
	selection: { id: string } | { params: URLSearchParams },
): Promise<WriteResult> {
	assertAllowed(table.rules.delete, caller, "delete rows");
	const target = selectionFragment(
		projectId,
		table,
		selection,
		ownerScope(table.rules.delete, caller),
	);
	const { results } = await env.DB.prepare(
		`DELETE FROM ${quoteIdentifier(physicalTable(projectId, table.name))}${target.sql} RETURNING *`,
	)
		.bind(...target.values)
		.all<Row>();
	if ("id" in selection && results.length === 0) throw notFound();
	const rows = results.map((row) => serializeRow(table, row, null));
	return { rows, changes: rows.map((row) => ({ event: "DELETE", record: null, old_record: row })) };
}

export function serializeRow(table: TableDefinition, row: Row, select: string[] | null): Row {
	const output: Row = {};
	const types = new Map(table.columns.map((column) => [column.name, column.type]));
	for (const [name, value] of Object.entries(row)) {
		if (select && !select.includes(name)) continue;
		const type = types.get(name);
		if (value === null || value === undefined) output[name] = null;
		else if (type === "boolean") output[name] = Number(value) === 1;
		else if (type === "json") output[name] = JSON.parse(String(value)) as unknown;
		else if (type === "integer" || type === "number") output[name] = Number(value);
		else output[name] = value;
	}
	return output;
}

function insertValues(table: TableDefinition, caller: Caller, input: unknown, now: string) {
	if (!isRecord(input)) throw new DataError(422, "row_invalid", "Each row must be a JSON object");
	rejectUnknownKeys(table, input, ["id", "owner_id"]);
	const values = new Map<string, unknown>();
	const id = input.id ?? crypto.randomUUID();
	if (typeof id !== "string" || !UUID_PATTERN.test(id))
		throw new DataError(422, "id_invalid", "id must be a UUID");
	values.set("id", id.toLowerCase());
	values.set("owner_id", ownerValue(caller, input));
	values.set("created_at", now);
	values.set("updated_at", now);
	for (const column of table.columns) {
		const provided = Object.hasOwn(input, column.name);
		const value = provided ? input[column.name] : column.default;
		if (value === null || value === undefined) {
			if (!column.nullable)
				throw new DataError(422, "column_required", `${column.name} is required`, {
					column: column.name,
				});
			values.set(column.name, null);
		} else values.set(column.name, storedValue(column, coerceValue(column, value)));
	}
	return values;
}

function updateValues(table: TableDefinition, caller: Caller, input: unknown) {
	if (!isRecord(input)) throw new DataError(422, "row_invalid", "Body must be a JSON object");
	rejectUnknownKeys(table, input, ["owner_id"]);
	const values = new Map<string, unknown>();
	if (Object.hasOwn(input, "owner_id")) {
		if (caller.role !== "service")
			throw new DataError(403, "owner_readonly", "Only a server key can change owner_id");
		values.set("owner_id", ownerValue(caller, input));
	}
	for (const column of table.columns) {
		if (!Object.hasOwn(input, column.name)) continue;
		const value = input[column.name];
		if (value === null) {
			if (!column.nullable)
				throw new DataError(422, "column_required", `${column.name} cannot be null`, {
					column: column.name,
				});
			values.set(column.name, null);
		} else values.set(column.name, storedValue(column, coerceValue(column, value)));
	}
	if (values.size === 0) throw new DataError(422, "update_empty", "Nothing to update");
	return values;
}

function ownerValue(caller: Caller, input: Record<string, unknown>): string | null {
	if (caller.role !== "service") {
		if (Object.hasOwn(input, "owner_id") && input.owner_id !== caller.userId)
			throw new DataError(403, "owner_readonly", "Only a server key can choose owner_id");
		return caller.userId;
	}
	const owner = input.owner_id ?? null;
	if (owner !== null && (typeof owner !== "string" || !OWNER_PATTERN.test(owner)))
		throw new DataError(422, "owner_invalid", "owner_id is invalid");
	return owner;
}

function rejectUnknownKeys(
	table: TableDefinition,
	input: Record<string, unknown>,
	allowed: string[],
) {
	const columns = new Set([...allowed, ...table.columns.map((column) => column.name)]);
	for (const key of Object.keys(input)) {
		if (key === "created_at" || key === "updated_at" || (key === "id" && !allowed.includes("id")))
			throw new DataError(422, "column_readonly", `${key} is managed by SuperBoard`, {
				column: key,
			});
		if (!columns.has(key))
			throw new DataError(422, "column_unknown", `Column ${key} does not exist`, { column: key });
	}
}

function selectionFragment(
	projectId: number,
	table: TableDefinition,
	selection: { id: string } | { params: URLSearchParams },
	owner: string | null,
): SqlFragment {
	if ("id" in selection) return where([idFragment(selection.id), ownerFragment(owner)]);
	if (!hasFilters(selection.params))
		throw new DataError(422, "filter_required", "Add at least one filter to change several rows");
	const scope = where([parseFilters(selection.params, table), ownerFragment(owner)]);
	const quoted = quoteIdentifier(physicalTable(projectId, table.name));
	return {
		sql: ` WHERE "id" IN (SELECT "id" FROM ${quoted}${scope.sql} ORDER BY "id" LIMIT ${MAXIMUM_BATCH})`,
		values: scope.values,
	};
}

function idFragment(id: string): SqlFragment {
	if (!UUID_PATTERN.test(id)) throw notFound();
	return { sql: `"id" = ?`, values: [id.toLowerCase()] };
}

function ownerFragment(owner: string | null): SqlFragment | null {
	return owner === null ? null : { sql: `"owner_id" = ?`, values: [owner] };
}

function where(fragments: (SqlFragment | null)[]): SqlFragment {
	const present = fragments.filter((fragment): fragment is SqlFragment => Boolean(fragment?.sql));
	if (present.length === 0) return { sql: "", values: [] };
	return {
		sql: ` WHERE ${present.map((fragment) => `(${fragment.sql})`).join(" AND ")}`,
		values: present.flatMap((fragment) => fragment.values),
	};
}

function notFound() {
	return new DataError(404, "row_not_found", "Row does not exist");
}

function constraintError(cause: unknown): unknown {
	const message = cause instanceof Error ? cause.message : String(cause);
	if (!message.includes("UNIQUE constraint failed")) return cause;
	if (/\.id\b/u.test(message))
		return new DataError(409, "row_exists", "A row with this id already exists");
	return new DataError(409, "unique_violation", "A unique column already holds this value");
}
