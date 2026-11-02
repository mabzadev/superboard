import type { PostgresDialect } from "kysely";
import { Pool } from "pg";

import { FailFastPostgresDialect } from "../database/pg-migration-lock.js";
import type { PostgresConfig } from "./adapters.js";

export function createDialect(config: PostgresConfig): PostgresDialect {
	const pool = new Pool({
		connectionString: config.connectionString,
		host: config.host,
		port: config.port,
		database: config.database,
		user: config.user,
		password: config.password,
		ssl: config.ssl,
		min: config.pool?.min ?? 0,
		max: config.pool?.max ?? 10,
	});

	return new FailFastPostgresDialect({ pool });
}
