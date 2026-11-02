import type { DatabaseIntrospector, SchemaMetadata, TableMetadata } from "kysely";
import { sql } from "kysely";

const DEFAULT_MIGRATION_TABLE = "kysely_migration";
const DEFAULT_MIGRATION_LOCK_TABLE = "kysely_migration_lock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKysely = any;

const SPLIT_PARENS_PATTERN = /[(),]/;
const WHITESPACE_PATTERN = /\s+/;
const QUOTES_PATTERN = /["`]/g;

export class D1Introspector implements DatabaseIntrospector {
	readonly #db: AnyKysely;

	constructor(db: AnyKysely) {
		this.#db = db;
	}

	async getSchemas(): Promise<SchemaMetadata[]> {
		return [];
	}

	async getTables(options: { withInternalKyselyTables?: boolean } = {}): Promise<TableMetadata[]> {
		let query = this.#db
			.selectFrom("sqlite_master")
			.where("type", "in", ["table", "view"])
			.where("name", "not like", "sqlite_%")
			.where("name", "not like", "_cf_%")
			.select(["name", "sql", "type"])
			.orderBy("name");

		if (!options.withInternalKyselyTables) {
			query = query
				.where("name", "!=", DEFAULT_MIGRATION_TABLE)
				.where("name", "!=", DEFAULT_MIGRATION_LOCK_TABLE);
		}

		const tables = await query.execute();

		const result: TableMetadata[] = [];

		for (const table of tables) {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Kysely's DatabaseIntrospector returns untyped results
			const tableName = table.name as string;
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Kysely's DatabaseIntrospector returns untyped results
			const tableType = table.type as string;
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Kysely's DatabaseIntrospector returns untyped results
			const tableSql = table.sql as string | null;

			const columns = await sql<{
				cid: number;
				name: string;
				type: string;
				notnull: number;
				dflt_value: string | null;
				pk: number;
			}>`SELECT * FROM pragma_table_info('${sql.raw(tableName)}')`.execute(this.#db);

			let autoIncrementCol = tableSql
				?.split(SPLIT_PARENS_PATTERN)
				?.find((it) => it.toLowerCase().includes("autoincrement"))
				?.trimStart()
				?.split(WHITESPACE_PATTERN)?.[0]
				?.replace(QUOTES_PATTERN, "");

			if (!autoIncrementCol) {
				const pkCols = columns.rows.filter((r) => r.pk > 0);
				if (pkCols.length === 1 && pkCols[0]!.type.toLowerCase() === "integer") {
					autoIncrementCol = pkCols[0]!.name;
				}
			}

			result.push({
				name: tableName,
				isView: tableType === "view",
				isForeign: false,
				columns: columns.rows.map((col) => ({
					name: col.name,
					dataType: col.type,
					isNullable: !col.notnull,
					isAutoIncrementing: col.name === autoIncrementCol,
					hasDefaultValue: col.dflt_value != null,
					comment: undefined,
				})),
			});
		}

		return result;
	}
}
