import type { DataEnv } from "../platform/env.js";
import { DataError, isRecord } from "../platform/http.js";
import {
	addColumn,
	createTable,
	dropColumn,
	dropTable,
	listTables,
	parseRules,
	parseTableInput,
	sameColumn,
	updateColumn,
	updateTable,
	type TableDefinition,
	type TableInput,
} from "./schema.js";

export interface SchemaChange {
	action:
		| "create_table"
		| "update_table"
		| "drop_table"
		| "add_column"
		| "update_column"
		| "drop_column";
	table: string;
	column?: string;
	destructive: boolean;
}

export interface SchemaPlan {
	changes: SchemaChange[];
	applied: boolean;
}

export async function applySchema(
	env: DataEnv,
	projectId: number,
	body: unknown,
	options: { dryRun: boolean; allowDestructive: boolean },
): Promise<SchemaPlan> {
	if (!isRecord(body) || !Array.isArray(body.tables))
		throw new DataError(422, "schema_invalid", "Schema must contain a tables array");
	const current = new Map((await listTables(env, projectId)).map((table) => [table.name, table]));
	const desired = body.tables.map((raw) => {
		const table = parseTableInput(raw);
		const existing = current.get(table.name);
		if (!existing || !isRecord(raw)) return table;
		return {
			...table,
			label: raw.label === undefined ? existing.label : table.label,
			rules: parseRules(raw.rules, existing.rules),
			realtime: raw.realtime === undefined ? existing.realtime : table.realtime,
		};
	});
	const names = new Set<string>();
	for (const table of desired) {
		if (names.has(table.name))
			throw new DataError(422, "table_duplicate", `Table ${table.name} is declared twice`);
		names.add(table.name);
	}
	const changes = plan(desired, current, body.prune === true);
	const destructive = changes.filter((change) => change.destructive);
	if (destructive.length && !options.allowDestructive && !options.dryRun)
		throw new DataError(409, "destructive_changes", "The schema deletes tables or columns", {
			changes: destructive,
		});
	if (options.dryRun) return { changes, applied: false };
	for (const change of changes) await apply(env, projectId, change, desired, current);
	return { changes, applied: true };
}

function plan(
	desired: TableInput[],
	current: Map<string, TableDefinition>,
	prune: boolean,
): SchemaChange[] {
	const changes: SchemaChange[] = [];
	for (const table of desired) {
		const existing = current.get(table.name);
		if (!existing) {
			changes.push({ action: "create_table", table: table.name, destructive: false });
			continue;
		}
		if (
			existing.label !== table.label ||
			existing.realtime !== table.realtime ||
			JSON.stringify(existing.rules) !== JSON.stringify(table.rules)
		)
			changes.push({ action: "update_table", table: table.name, destructive: false });
		const existingColumns = new Map(existing.columns.map((column) => [column.name, column]));
		for (const column of table.columns) {
			const previous = existingColumns.get(column.name);
			if (!previous)
				changes.push({
					action: "add_column",
					table: table.name,
					column: column.name,
					destructive: false,
				});
			else if (previous.type !== column.type)
				throw new DataError(
					422,
					"column_type_immutable",
					`${table.name}.${column.name} cannot change type`,
				);
			else if (!sameColumn(previous, { ...column, position: previous.position }))
				changes.push({
					action: "update_column",
					table: table.name,
					column: column.name,
					destructive: false,
				});
		}
		for (const column of existing.columns)
			if (!table.columns.some((candidate) => candidate.name === column.name))
				changes.push({
					action: "drop_column",
					table: table.name,
					column: column.name,
					destructive: true,
				});
	}
	if (prune)
		for (const name of current.keys())
			if (!desired.some((table) => table.name === name))
				changes.push({ action: "drop_table", table: name, destructive: true });
	return changes;
}

async function apply(
	env: DataEnv,
	projectId: number,
	change: SchemaChange,
	desired: TableInput[],
	current: Map<string, TableDefinition>,
): Promise<void> {
	if (change.action === "drop_table") {
		if (current.has(change.table)) await dropTable(env, projectId, change.table, change.table);
		return;
	}
	const table = desired.find((candidate) => candidate.name === change.table);
	if (!table) return;
	if (change.action === "create_table") await createTable(env, projectId, table);
	else if (change.action === "update_table")
		await updateTable(env, projectId, change.table, {
			label: table.label,
			rules: table.rules,
			realtime: table.realtime,
		});
	const name = change.column ?? "";
	const column = table.columns.find((candidate) => candidate.name === name);
	if (change.action === "add_column") await addColumn(env, projectId, change.table, column);
	else if (change.action === "update_column")
		await updateColumn(env, projectId, change.table, name, column);
	else if (change.action === "drop_column")
		await dropColumn(env, projectId, change.table, name, name);
}
