import { type Dialect, SqliteDialect } from "kysely";

import type { SqliteConfig } from "./adapters.js";
import { openNodeSqliteDatabase } from "./node-sqlite-compat.js";

export function createDialect(config: SqliteConfig): Dialect {
	const url = config.url;
	const filePath = url.startsWith("file:") ? url.slice(5) : url;

	const database = openNodeSqliteDatabase(filePath);

	return new SqliteDialect({ database });
}
