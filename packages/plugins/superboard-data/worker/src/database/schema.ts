import type { DataEnv } from "../platform/env.js";
import { DataError, isRecord, nowIso } from "../platform/http.js";
import { parseAccessRule, type AccessRule } from "../platform/policy.js";

export const COLUMN_TYPES = [
	"text",
	"integer",
	"number",
	"boolean",
	"json",
	"timestamp",
	"uuid",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const SYSTEM_COLUMNS = ["id", "owner_id", "created_at", "updated_at"] as const;
export type SystemColumn = (typeof SYSTEM_COLUMNS)[number];

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,47}$/u;
const MAXIMUM_TABLES = 200;
const MAXIMUM_COLUMNS = 64;
const MAXIMUM_LABEL_LENGTH = 120;

export interface ColumnDefinition {
	name: string;
	type: ColumnType;
	nullable: boolean;
	default: unknown;
	unique: boolean;
	indexed: boolean;
	position: number;
}

export interface TableRules {
	read: AccessRule;
	insert: AccessRule;
	update: AccessRule;
	delete: AccessRule;
}

export interface TableDefinition {
	name: string;
	label: string | null;
	rules: TableRules;
	realtime: boolean;
	columns: ColumnDefinition[];
	created_at: string;
	updated_at: string;
}

export interface TableInput {
	name: string;
	label: string | null;
	rules: TableRules;
	realtime: boolean;
	columns: ColumnDefinition[];
}

const DEFAULT_RULES: TableRules = {
	read: "owner",
	insert: "owner",
	update: "owner",
	delete: "owner",
};

type TableRow = {
	name: string;
	label: string | null;
	read_rule: AccessRule;
	insert_rule: AccessRule;
	update_rule: AccessRule;
	delete_rule: AccessRule;
	realtime: number;
	created_at: string;
	updated_at: string;
	column_name: string | null;
	column_type: ColumnType | null;
	column_nullable: number | null;
	column_default: string | null;
	column_unique: number | null;
	column_indexed: number | null;
	column_position: number | null;
};

export function physicalTable(projectId: number, table: string): string {
	assertName(table, "table");
	if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error("project_invalid");
	return `adb_${projectId}_${table}`;
}

export function quoteIdentifier(identifier: string): string {
	if (!/^[a-z][a-z0-9_]{0,127}$/u.test(identifier)) throw new Error("identifier_invalid");
	return `"${identifier}"`;
}

export function assertName(value: unknown, kind: "table" | "column"): asserts value is string {
	if (typeof value !== "string" || !NAME_PATTERN.test(value))
		throw new DataError(
			422,
			`${kind}_name_invalid`,
			`A ${kind} name starts with a lowercase letter and contains up to 48 lowercase letters, digits or underscores`,
		);
}

export function sqliteType(type: ColumnType): string {
	if (type === "integer" || type === "boolean") return "INTEGER";
	if (type === "number") return "REAL";
	return "TEXT";
}

export async function listTables(env: DataEnv, projectId: number): Promise<TableDefinition[]> {
	return tablesFromRows(await tableRows(env, projectId, null));
}

export async function getTable(
	env: DataEnv,
	projectId: number,
	name: string,
): Promise<TableDefinition | null> {
	assertName(name, "table");
	return tablesFromRows(await tableRows(env, projectId, name))[0] ?? null;
}

export async function requireTable(
	env: DataEnv,
	projectId: number,
	name: string,
): Promise<TableDefinition> {
	const table = await getTable(env, projectId, name);
	if (!table) throw new DataError(404, "table_not_found", `Table ${name} does not exist`);
	return table;
}

export function parseTableInput(value: unknown): TableInput {
	if (!isRecord(value)) throw new DataError(422, "table_invalid", "Table must be an object");
	assertName(value.name, "table");
	const columnsInput = value.columns ?? [];
	if (!Array.isArray(columnsInput))
		throw new DataError(422, "columns_invalid", "columns must be an array");
	if (columnsInput.length > MAXIMUM_COLUMNS)
		throw new DataError(422, "columns_limit", `A table has at most ${MAXIMUM_COLUMNS} columns`);
	const columns = columnsInput.map((column, position) => parseColumnInput(column, position));
	const names = new Set<string>();
	for (const column of columns) {
		if (names.has(column.name))
			throw new DataError(422, "column_duplicate", `Column ${column.name} is declared twice`);
		names.add(column.name);
	}
	return {
		name: value.name,
		label: parseLabel(value.label),
		rules: parseRules(value.rules, DEFAULT_RULES),
		realtime: parseBoolean(value.realtime, false, "realtime"),
		columns,
	};
}

export function parseColumnInput(value: unknown, position: number): ColumnDefinition {
	if (!isRecord(value)) throw new DataError(422, "column_invalid", "Column must be an object");
	assertName(value.name, "column");
	if ((SYSTEM_COLUMNS as readonly string[]).includes(value.name))
		throw new DataError(422, "column_reserved", `${value.name} is a system column`);
	if (typeof value.type !== "string" || !(COLUMN_TYPES as readonly string[]).includes(value.type))
		throw new DataError(
			422,
			"column_type_invalid",
			`Column type must be one of ${COLUMN_TYPES.join(", ")}`,
		);
	const type = value.type as ColumnType;
	const nullable = parseBoolean(value.nullable, true, "nullable");
	const unique = parseBoolean(value.unique, false, "unique");
	const column: ColumnDefinition = {
		name: value.name,
		type,
		nullable,
		default: null,
		unique,
		indexed: unique || parseBoolean(value.indexed, false, "indexed"),
		position,
	};
	if (value.default !== undefined && value.default !== null) {
		if (unique) throw new DataError(422, "column_default_unique", "A unique column has no default");
		column.default = coerceDefault(column, value.default);
	}
	return column;
}

export function parseRules(value: unknown, fallback: TableRules): TableRules {
	if (value === undefined || value === null) return { ...fallback };
	if (!isRecord(value)) throw new DataError(422, "rules_invalid", "rules must be an object");
	return {
		read: value.read === undefined ? fallback.read : parseAccessRule(value.read, "rules.read"),
		insert:
			value.insert === undefined ? fallback.insert : parseAccessRule(value.insert, "rules.insert"),
		update:
			value.update === undefined ? fallback.update : parseAccessRule(value.update, "rules.update"),
		delete:
			value.delete === undefined ? fallback.delete : parseAccessRule(value.delete, "rules.delete"),
	};
}

export async function createTable(
	env: DataEnv,
	projectId: number,
	input: TableInput,
): Promise<TableDefinition> {
	const count = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM data_tables WHERE project_id = ?",
	)
		.bind(projectId)
		.first<{ total: number }>();
	if (Number(count?.total ?? 0) >= MAXIMUM_TABLES)
		throw new DataError(409, "table_limit", `A project has at most ${MAXIMUM_TABLES} tables`);
	if (await getTable(env, projectId, input.name))
		throw new DataError(409, "table_exists", `Table ${input.name} already exists`);
	const now = nowIso();
	const physical = physicalTable(projectId, input.name);
	const table = quoteIdentifier(physical);
	const definitions = [
		`"id" TEXT PRIMARY KEY NOT NULL`,
		`"owner_id" TEXT`,
		`"created_at" TEXT NOT NULL`,
		`"updated_at" TEXT NOT NULL`,
		...input.columns.map((column) => `${quoteIdentifier(column.name)} ${sqliteType(column.type)}`),
	];
	const statements = [
		env.DB.prepare(
			`INSERT INTO data_tables (project_id, name, label, read_rule, insert_rule, update_rule, delete_rule, realtime, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			projectId,
			input.name,
			input.label,
			input.rules.read,
			input.rules.insert,
			input.rules.update,
			input.rules.delete,
			input.realtime ? 1 : 0,
			now,
			now,
		),
		...input.columns.map((column) =>
			insertColumnStatement(env, projectId, input.name, column, now),
		),
		env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${table} (${definitions.join(", ")})`),
		env.DB.prepare(
			`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${physical}__owner`)} ON ${table} ("owner_id", "created_at")`,
		),
		env.DB.prepare(
			`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${physical}__created`)} ON ${table} ("created_at", "id")`,
		),
		...input.columns.flatMap((column) => indexStatements(env, physical, column)),
	];
	await env.DB.batch(statements);
	return requireTable(env, projectId, input.name);
}

export async function updateTable(
	env: DataEnv,
	projectId: number,
	name: string,
	value: unknown,
): Promise<TableDefinition> {
	const current = await requireTable(env, projectId, name);
	if (!isRecord(value)) throw new DataError(422, "table_invalid", "Body must be an object");
	const rules = parseRules(value.rules, current.rules);
	const realtime = parseBoolean(value.realtime, current.realtime, "realtime");
	const label = value.label === undefined ? current.label : parseLabel(value.label);
	await env.DB.prepare(
		`UPDATE data_tables SET label = ?, read_rule = ?, insert_rule = ?, update_rule = ?, delete_rule = ?, realtime = ?, updated_at = ?
		 WHERE project_id = ? AND name = ?`,
	)
		.bind(
			label,
			rules.read,
			rules.insert,
			rules.update,
			rules.delete,
			realtime ? 1 : 0,
			nowIso(),
			projectId,
			name,
		)
		.run();
	return requireTable(env, projectId, name);
}

export async function dropTable(
	env: DataEnv,
	projectId: number,
	name: string,
	confirmation: string | null,
): Promise<void> {
	await requireTable(env, projectId, name);
	if (confirmation !== name)
		throw new DataError(422, "confirmation_required", `Pass confirm=${name} to delete this table`);
	await env.DB.batch([
		env.DB.prepare(`DROP TABLE IF EXISTS ${quoteIdentifier(physicalTable(projectId, name))}`),
		env.DB.prepare("DELETE FROM data_columns WHERE project_id = ? AND table_name = ?").bind(
			projectId,
			name,
		),
		env.DB.prepare("DELETE FROM data_tables WHERE project_id = ? AND name = ?").bind(
			projectId,
			name,
		),
	]);
}

export async function addColumn(
	env: DataEnv,
	projectId: number,
	tableName: string,
	value: unknown,
): Promise<TableDefinition> {
	const table = await requireTable(env, projectId, tableName);
	if (table.columns.length >= MAXIMUM_COLUMNS)
		throw new DataError(422, "columns_limit", `A table has at most ${MAXIMUM_COLUMNS} columns`);
	const column = parseColumnInput(value, nextPosition(table));
	if (table.columns.some((existing) => existing.name === column.name))
		throw new DataError(409, "column_exists", `Column ${column.name} already exists`);
	const physical = physicalTable(projectId, tableName);
	const quotedTable = quoteIdentifier(physical);
	if (!column.nullable && column.default === null) {
		const existing = await env.DB.prepare(
			`SELECT 1 AS present FROM ${quotedTable} LIMIT 1`,
		).first();
		if (existing)
			throw new DataError(
				422,
				"column_default_required",
				"A required column added to a table with rows needs a default value",
			);
	}
	const statements = [
		insertColumnStatement(env, projectId, tableName, column, nowIso()),
		env.DB.prepare(
			`ALTER TABLE ${quotedTable} ADD COLUMN ${quoteIdentifier(column.name)} ${sqliteType(column.type)}`,
		),
	];
	if (column.default !== null)
		statements.push(
			env.DB.prepare(
				`UPDATE ${quotedTable} SET ${quoteIdentifier(column.name)} = ? WHERE ${quoteIdentifier(column.name)} IS NULL`,
			).bind(storedValue(column, column.default)),
		);
	statements.push(...indexStatements(env, physical, column));
	statements.push(
		env.DB.prepare("UPDATE data_tables SET updated_at = ? WHERE project_id = ? AND name = ?").bind(
			nowIso(),
			projectId,
			tableName,
		),
	);
	try {
		await env.DB.batch(statements);
	} catch (cause) {
		if (String(cause).includes("UNIQUE"))
			throw new DataError(409, "unique_violation", "Existing rows break the unique constraint");
		throw cause;
	}
	return requireTable(env, projectId, tableName);
}

export async function dropColumn(
	env: DataEnv,
	projectId: number,
	tableName: string,
	columnName: string,
	confirmation: string | null,
): Promise<TableDefinition> {
	const table = await requireTable(env, projectId, tableName);
	assertName(columnName, "column");
	if (!table.columns.some((column) => column.name === columnName))
		throw new DataError(404, "column_not_found", `Column ${columnName} does not exist`);
	if (confirmation !== columnName)
		throw new DataError(
			422,
			"confirmation_required",
			`Pass confirm=${columnName} to delete this column`,
		);
	const physical = physicalTable(projectId, tableName);
	await env.DB.batch([
		env.DB.prepare(
			`DROP INDEX IF EXISTS ${quoteIdentifier(indexName(physical, columnName, false))}`,
		),
		env.DB.prepare(
			`DROP INDEX IF EXISTS ${quoteIdentifier(indexName(physical, columnName, true))}`,
		),
		env.DB.prepare(
			`ALTER TABLE ${quoteIdentifier(physical)} DROP COLUMN ${quoteIdentifier(columnName)}`,
		),
		env.DB.prepare(
			"DELETE FROM data_columns WHERE project_id = ? AND table_name = ? AND name = ?",
		).bind(projectId, tableName, columnName),
		env.DB.prepare("UPDATE data_tables SET updated_at = ? WHERE project_id = ? AND name = ?").bind(
			nowIso(),
			projectId,
			tableName,
		),
	]);
	return requireTable(env, projectId, tableName);
}

export async function updateColumn(
	env: DataEnv,
	projectId: number,
	tableName: string,
	columnName: string,
	value: unknown,
): Promise<TableDefinition> {
	const table = await requireTable(env, projectId, tableName);
	assertName(columnName, "column");
	const current = table.columns.find((column) => column.name === columnName);
	if (!current) throw new DataError(404, "column_not_found", `Column ${columnName} does not exist`);
	if (!isRecord(value)) throw new DataError(422, "column_invalid", "Body must be an object");
	if (value.type !== undefined && value.type !== current.type)
		throw new DataError(422, "column_type_immutable", "A column type cannot change");
	const next = parseColumnInput(
		{
			name: current.name,
			type: current.type,
			nullable: value.nullable ?? current.nullable,
			unique: value.unique ?? current.unique,
			indexed: value.indexed ?? current.indexed,
			default: value.default === undefined ? current.default : value.default,
		},
		current.position,
	);
	const physical = physicalTable(projectId, tableName);
	const quotedTable = quoteIdentifier(physical);
	const quotedColumn = quoteIdentifier(columnName);
	const statements: D1PreparedStatement[] = [];
	if (!next.nullable && current.nullable) {
		if (next.default !== null)
			statements.push(
				env.DB.prepare(
					`UPDATE ${quotedTable} SET ${quotedColumn} = ? WHERE ${quotedColumn} IS NULL`,
				).bind(storedValue(next, next.default)),
			);
		else if (
			await env.DB.prepare(
				`SELECT 1 AS present FROM ${quotedTable} WHERE ${quotedColumn} IS NULL LIMIT 1`,
			).first()
		)
			throw new DataError(422, "column_has_nulls", "Rows hold null values; give a default first");
	}
	if (current.unique && !next.unique)
		statements.push(
			env.DB.prepare(
				`DROP INDEX IF EXISTS ${quoteIdentifier(indexName(physical, columnName, true))}`,
			),
		);
	if (current.indexed && !current.unique && (!next.indexed || next.unique))
		statements.push(
			env.DB.prepare(
				`DROP INDEX IF EXISTS ${quoteIdentifier(indexName(physical, columnName, false))}`,
			),
		);
	if (next.indexed && (next.unique !== current.unique || !current.indexed))
		statements.push(...indexStatements(env, physical, next));
	statements.push(
		env.DB.prepare(
			`UPDATE data_columns SET nullable = ?, default_json = ?, is_unique = ?, indexed = ?
			 WHERE project_id = ? AND table_name = ? AND name = ?`,
		).bind(
			next.nullable ? 1 : 0,
			next.default === null ? null : JSON.stringify(next.default),
			next.unique ? 1 : 0,
			next.indexed ? 1 : 0,
			projectId,
			tableName,
			columnName,
		),
		env.DB.prepare("UPDATE data_tables SET updated_at = ? WHERE project_id = ? AND name = ?").bind(
			nowIso(),
			projectId,
			tableName,
		),
	);
	try {
		await env.DB.batch(statements);
	} catch (cause) {
		if (String(cause).includes("UNIQUE"))
			throw new DataError(409, "unique_violation", "Existing rows break the unique constraint");
		throw cause;
	}
	return requireTable(env, projectId, tableName);
}

export function sameColumn(left: ColumnDefinition, right: ColumnDefinition): boolean {
	return (
		left.type === right.type &&
		left.nullable === right.nullable &&
		left.unique === right.unique &&
		left.indexed === right.indexed &&
		JSON.stringify(left.default) === JSON.stringify(right.default)
	);
}

export async function countRows(env: DataEnv, projectId: number, table: string): Promise<number> {
	const row = await env.DB.prepare(
		`SELECT COUNT(*) AS total FROM ${quoteIdentifier(physicalTable(projectId, table))}`,
	).first<{ total: number }>();
	return Number(row?.total ?? 0);
}

export function storedValue(column: Pick<ColumnDefinition, "type">, value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (column.type === "boolean") return value ? 1 : 0;
	if (column.type === "json") return JSON.stringify(value);
	return value;
}

export function coerceValue(
	column: Pick<ColumnDefinition, "name" | "type">,
	value: unknown,
): unknown {
	const invalid = () =>
		new DataError(422, "value_invalid", `${column.name} expects a ${column.type} value`, {
			column: column.name,
		});
	switch (column.type) {
		case "text":
			if (typeof value !== "string" || value.length > 1_000_000) throw invalid();
			return value;
		case "integer":
			if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalid();
			return value;
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value)) throw invalid();
			return value;
		case "boolean":
			if (typeof value !== "boolean") throw invalid();
			return value;
		case "json": {
			const serialized = JSON.stringify(value);
			if (serialized === undefined || serialized.length > 1_000_000) throw invalid();
			return value;
		}
		case "timestamp": {
			if (typeof value !== "string") throw invalid();
			const time = Date.parse(value);
			if (!Number.isFinite(time)) throw invalid();
			return new Date(time).toISOString();
		}
		case "uuid":
			if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
			return value.toLowerCase();
	}
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function coerceDefault(column: ColumnDefinition, value: unknown): unknown {
	try {
		return coerceValue(column, value);
	} catch {
		throw new DataError(
			422,
			"column_default_invalid",
			`Default of ${column.name} has the wrong type`,
		);
	}
}

function insertColumnStatement(
	env: DataEnv,
	projectId: number,
	table: string,
	column: ColumnDefinition,
	now: string,
) {
	return env.DB.prepare(
		`INSERT INTO data_columns (project_id, table_name, name, type, nullable, default_json, is_unique, indexed, position, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).bind(
		projectId,
		table,
		column.name,
		column.type,
		column.nullable ? 1 : 0,
		column.default === null ? null : JSON.stringify(column.default),
		column.unique ? 1 : 0,
		column.indexed ? 1 : 0,
		column.position,
		now,
	);
}

function indexStatements(env: DataEnv, physical: string, column: ColumnDefinition) {
	if (!column.indexed) return [];
	return [
		env.DB.prepare(
			`CREATE ${column.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quoteIdentifier(
				indexName(physical, column.name, column.unique),
			)} ON ${quoteIdentifier(physical)} (${quoteIdentifier(column.name)})`,
		),
	];
}

function indexName(physical: string, column: string, unique: boolean): string {
	return `${physical}__${unique ? "uq" : "ix"}__${column}`;
}

function nextPosition(table: TableDefinition): number {
	return table.columns.reduce((maximum, column) => Math.max(maximum, column.position + 1), 0);
}

function parseLabel(value: unknown): string | null {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string" || value.trim().length > MAXIMUM_LABEL_LENGTH)
		throw new DataError(
			422,
			"label_invalid",
			`label has at most ${MAXIMUM_LABEL_LENGTH} characters`,
		);
	return value.trim();
}

function parseBoolean(value: unknown, fallback: boolean, field: string): boolean {
	if (value === undefined || value === null) return fallback;
	if (typeof value !== "boolean")
		throw new DataError(422, "boolean_invalid", `${field} must be a boolean`);
	return value;
}

async function tableRows(
	env: DataEnv,
	projectId: number,
	name: string | null,
): Promise<TableRow[]> {
	const { results } = await env.DB.prepare(
		`SELECT t.name, t.label, t.read_rule, t.insert_rule, t.update_rule, t.delete_rule, t.realtime,
		        t.created_at, t.updated_at,
		        c.name AS column_name, c.type AS column_type, c.nullable AS column_nullable,
		        c.default_json AS column_default, c.is_unique AS column_unique,
		        c.indexed AS column_indexed, c.position AS column_position
		 FROM data_tables t
		 LEFT JOIN data_columns c ON c.project_id = t.project_id AND c.table_name = t.name
		 WHERE t.project_id = ? AND (? IS NULL OR t.name = ?)
		 ORDER BY t.name, c.position`,
	)
		.bind(projectId, name, name)
		.all<TableRow>();
	return results;
}

function tablesFromRows(rows: TableRow[]): TableDefinition[] {
	const tables = new Map<string, TableDefinition>();
	for (const row of rows) {
		let table = tables.get(row.name);
		if (!table) {
			table = {
				name: row.name,
				label: row.label,
				rules: {
					read: row.read_rule,
					insert: row.insert_rule,
					update: row.update_rule,
					delete: row.delete_rule,
				},
				realtime: Number(row.realtime) === 1,
				columns: [],
				created_at: row.created_at,
				updated_at: row.updated_at,
			};
			tables.set(row.name, table);
		}
		if (row.column_name && row.column_type)
			table.columns.push({
				name: row.column_name,
				type: row.column_type,
				nullable: Number(row.column_nullable) === 1,
				default: row.column_default === null ? null : (JSON.parse(row.column_default) as unknown),
				unique: Number(row.column_unique) === 1,
				indexed: Number(row.column_indexed) === 1,
				position: Number(row.column_position),
			});
	}
	return [...tables.values()];
}
