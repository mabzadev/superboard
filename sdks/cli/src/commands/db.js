import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ApiError, UsageError } from "../errors.js";
import { schemaPlan, table } from "../format.js";

export function schemaFromTables(tables) {
	return {
		tables: tables.map((definition) => ({
			name: definition.name,
			...(definition.label ? { label: definition.label } : {}),
			rules: definition.rules,
			realtime: definition.realtime === true,
			columns: [...(definition.columns ?? [])]
				.sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
				.map((column) => ({
					name: column.name,
					type: column.type,
					nullable: column.nullable,
					...(column.default === null || column.default === undefined
						? {}
						: { default: column.default }),
					unique: column.unique === true,
					indexed: column.indexed === true,
				})),
		})),
	};
}

async function readSchema(ctx, file) {
	let schema;
	try {
		schema = JSON.parse(await readFile(resolve(ctx.cwd, file), "utf8"));
	} catch (error) {
		throw new UsageError(
			error?.code === "ENOENT" ? `${file} does not exist.` : `${file} is not valid JSON.`,
		);
	}
	if (!schema || !Array.isArray(schema.tables))
		throw new UsageError(
			`${file} must contain a "tables" array, as written by superboard db pull.`,
		);
	return schema;
}

export const dbCommands = {
	"db tables": {
		summary: "List the tables, their columns and access rules",
		usage: "superboard db tables",
		async run(ctx) {
			const result = await ctx.api().request("GET", "/manage/tables");
			ctx.print(result, ({ items }) =>
				table(
					items,
					[
						["NAME", (row) => row.name],
						[
							"COLUMNS",
							(row) => row.columns.map((column) => `${column.name}:${column.type}`).join(", "),
						],
						["READ", (row) => row.rules.read],
						["INSERT", (row) => row.rules.insert],
						["UPDATE", (row) => row.rules.update],
						["DELETE", (row) => row.rules.delete],
						["REALTIME", (row) => (row.realtime ? "yes" : "no")],
					],
					"No tables yet. Create them in the Front or with superboard db push.",
				),
			);
		},
	},
	"db pull": {
		summary: "Write the current schema in the format accepted by db push",
		usage: "superboard db pull [--out schema.json]",
		options: { out: { type: "string", description: "File to write; standard output by default" } },
		async run(ctx, values) {
			const { items } = await ctx.api().request("GET", "/manage/tables");
			const schema = schemaFromTables(items);
			const text = `${JSON.stringify(schema, null, 2)}\n`;
			if (!values.out) return ctx.out(text);
			await writeFile(resolve(ctx.cwd, values.out), text);
			if (ctx.json) ctx.print({ path: values.out, tables: schema.tables.length });
			else ctx.out(`Wrote ${schema.tables.length} table(s) to ${values.out}\n`);
		},
	},
	"db push": {
		summary: "Apply a declarative schema and print the plan",
		usage: "superboard db push <schema.json> [--dry-run] [--allow-destructive] [--prune]",
		positionals: ["schema.json"],
		options: {
			"dry-run": { type: "boolean", description: "Show the plan without applying it" },
			"allow-destructive": { type: "boolean", description: "Allow dropping tables or columns" },
			prune: { type: "boolean", description: "Drop tables that the file does not declare" },
		},
		async run(ctx, values, [file]) {
			const schema = await readSchema(ctx, file);
			const body = values.prune ? { ...schema, prune: true } : schema;
			let plan;
			try {
				plan = await ctx.api().request("POST", "/manage/schema", {
					query: [
						["dry_run", values["dry-run"] === true],
						["allow_destructive", values["allow-destructive"] === true],
					],
					json: body,
				});
			} catch (error) {
				if (error instanceof ApiError && error.code === "destructive_changes" && !ctx.json) {
					ctx.err(`${schemaPlan(error.details?.changes ?? [])}\n`);
					error.hint =
						"Re-run with --allow-destructive to apply these changes, or --dry-run to review the full plan.";
				}
				throw error;
			}
			ctx.print(
				plan,
				(result) =>
					`${result.applied ? "Applied" : "Plan (dry run, nothing applied)"}:\n${schemaPlan(result.changes)}`,
			);
		},
	},
	"gen types": {
		summary: "Generate TypeScript types for the tables",
		usage: "superboard gen types [--out database.ts]",
		options: { out: { type: "string", description: "File to write; standard output by default" } },
		async run(ctx, values) {
			const source = await ctx.api().request("GET", "/manage/types", { as: "text" });
			if (!values.out) return ctx.out(source);
			await writeFile(resolve(ctx.cwd, values.out), source);
			if (ctx.json) ctx.print({ path: values.out });
			else ctx.out(`Wrote types to ${values.out}\n`);
		},
	},
};
