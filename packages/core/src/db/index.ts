export { sqlite, libsql, postgres } from "./adapters.js";
export type {
	DatabaseDescriptor,
	DatabaseDialectType,
	SqliteConfig,
	LibsqlConfig,
	PostgresConfig,
	CollectionDeletionGuardInput,
	CollectionDeletionGuardResult,
	ExecuteCollectionDeletionGuard,
} from "./adapters.js";

export {
	runMigrations,
	getMigrationStatus,
	getExactMigrationStatus,
	rollbackMigration,
	MIGRATION_NAMES,
} from "../database/migrations/runner.js";
export type { MigrationStatus, ExactMigrationStatus } from "../database/migrations/runner.js";
