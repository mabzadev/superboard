import type { ColumnDefinition, ColumnType, TableDefinition } from "./schema.js";

const TYPESCRIPT_TYPES: Record<ColumnType, string> = {
	text: "string",
	integer: "number",
	number: "number",
	boolean: "boolean",
	json: "Json",
	timestamp: "string",
	uuid: "string",
};

const JSON_SCHEMA_TYPES: Record<ColumnType, Record<string, unknown>> = {
	text: { type: "string" },
	integer: { type: "integer" },
	number: { type: "number" },
	boolean: { type: "boolean" },
	json: {},
	timestamp: { type: "string", format: "date-time" },
	uuid: { type: "string", format: "uuid" },
};

export function typescriptTypes(tables: TableDefinition[]): string {
	const lines = [
		"export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
		"",
		"export interface Database {",
	];
	for (const table of tables) {
		lines.push(`\t${propertyName(table.name)}: {`);
		lines.push("\t\tRow: {");
		lines.push(
			"\t\t\tid: string;",
			"\t\t\towner_id: string | null;",
			"\t\t\tcreated_at: string;",
			"\t\t\tupdated_at: string;",
		);
		for (const column of table.columns)
			lines.push(`\t\t\t${propertyName(column.name)}: ${columnType(column)};`);
		lines.push("\t\t};", "\t\tInsert: {", "\t\t\tid?: string;", "\t\t\towner_id?: string | null;");
		for (const column of table.columns)
			lines.push(
				`\t\t\t${propertyName(column.name)}${column.nullable || column.default !== null ? "?" : ""}: ${columnType(column)};`,
			);
		lines.push("\t\t};", "\t\tUpdate: {", "\t\t\towner_id?: string | null;");
		for (const column of table.columns)
			lines.push(`\t\t\t${propertyName(column.name)}?: ${columnType(column)};`);
		lines.push("\t\t};", "\t};");
	}
	lines.push("}", "");
	return lines.join("\n");
}

export function openApiDocument(
	tables: TableDefinition[],
	serverUrl: string,
): Record<string, unknown> {
	const schemas: Record<string, unknown> = {};
	const paths: Record<string, unknown> = {};
	for (const table of tables) {
		const name = schemaName(table.name);
		schemas[name] = {
			type: "object",
			required: [
				"id",
				"owner_id",
				"created_at",
				"updated_at",
				...table.columns.filter((column) => !column.nullable).map((column) => column.name),
			],
			properties: {
				id: { type: "string", format: "uuid" },
				owner_id: { type: ["string", "null"] },
				created_at: { type: "string", format: "date-time" },
				updated_at: { type: "string", format: "date-time" },
				...Object.fromEntries(table.columns.map((column) => [column.name, columnSchema(column)])),
			},
		};
		const reference = { $ref: `#/components/schemas/${name}` };
		const page = {
			type: "object",
			required: ["items"],
			properties: {
				items: { type: "array", items: reference },
				nextCursor: { type: "string" },
				count: { type: "integer" },
			},
		};
		const listParameters = [
			{ name: "select", in: "query", schema: { type: "string" } },
			{ name: "order", in: "query", schema: { type: "string" } },
			{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
			{ name: "cursor", in: "query", schema: { type: "string" } },
			{ name: "count", in: "query", schema: { type: "string", enum: ["exact"] } },
		];
		const idParameter = {
			name: "id",
			in: "path",
			required: true,
			schema: { type: "string", format: "uuid" },
		};
		const rowBody = {
			required: true,
			content: { "application/json": { schema: { type: "object" } } },
		};
		paths[`/db/${table.name}`] = {
			get: {
				operationId: `list_${table.name}`,
				tags: [table.name],
				parameters: listParameters,
				responses: {
					"200": { description: "Rows", content: { "application/json": { schema: page } } },
				},
			},
			post: {
				operationId: `insert_${table.name}`,
				tags: [table.name],
				parameters: [{ name: "upsert", in: "query", schema: { type: "boolean" } }],
				requestBody: rowBody,
				responses: {
					"201": {
						description: "Inserted row",
						content: { "application/json": { schema: reference } },
					},
				},
			},
		};
		paths[`/db/${table.name}/{id}`] = {
			get: {
				operationId: `get_${table.name}`,
				tags: [table.name],
				parameters: [idParameter],
				responses: {
					"200": { description: "Row", content: { "application/json": { schema: reference } } },
				},
			},
			patch: {
				operationId: `update_${table.name}`,
				tags: [table.name],
				parameters: [idParameter],
				requestBody: rowBody,
				responses: {
					"200": {
						description: "Updated row",
						content: { "application/json": { schema: reference } },
					},
				},
			},
			delete: {
				operationId: `delete_${table.name}`,
				tags: [table.name],
				parameters: [idParameter],
				responses: { "200": { description: "Deleted" } },
			},
		};
	}
	return {
		openapi: "3.1.0",
		info: { title: "SuperBoard Data API", version: "1.0.0" },
		servers: [{ url: serverUrl }],
		components: {
			securitySchemes: {
				projectKey: { type: "apiKey", in: "header", name: "PROJECT-KEY" },
				bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
			},
			schemas,
		},
		security: [{ projectKey: [] }, { projectKey: [], bearer: [] }, { bearer: [] }],
		paths,
	};
}

function columnType(column: ColumnDefinition): string {
	return `${TYPESCRIPT_TYPES[column.type]}${column.nullable ? " | null" : ""}`;
}

function columnSchema(column: ColumnDefinition): Record<string, unknown> {
	const schema = { ...JSON_SCHEMA_TYPES[column.type] };
	if (column.nullable && typeof schema.type === "string") schema.type = [schema.type, "null"];
	if (column.default !== null) schema.default = column.default;
	return schema;
}

function propertyName(name: string): string {
	return /^[a-z_][a-z0-9_]*$/u.test(name) ? name : JSON.stringify(name);
}

function schemaName(table: string): string {
	return table
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}
