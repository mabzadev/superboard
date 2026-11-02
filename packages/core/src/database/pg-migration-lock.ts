import type { DialectAdapter, Kysely, MigrationLockOptions } from "kysely";
import { PostgresAdapter as KyselyPostgresAdapter, PostgresDialect, sql } from "kysely";

export const MIGRATION_LOCK_BUSY_MESSAGE = "EMDASH_MIGRATION_LOCK_BUSY";

const KYSELY_PG_MIGRATION_LOCK_ID = BigInt("3853314791062309107");

class PostgresAdapter extends KyselyPostgresAdapter {
	// eslint-disable-next-line typescript/no-explicit-any -- matches the DialectAdapter signature
	override async acquireMigrationLock(db: Kysely<any>, _opt: MigrationLockOptions): Promise<void> {
		const result = await sql<{ acquired: boolean }>`
			select pg_try_advisory_xact_lock(${sql.lit(KYSELY_PG_MIGRATION_LOCK_ID)}) as acquired
		`.execute(db);
		if (!result.rows[0]?.acquired) {
			throw new Error(MIGRATION_LOCK_BUSY_MESSAGE);
		}
	}
}

export class FailFastPostgresDialect extends PostgresDialect {
	override createAdapter(): DialectAdapter {
		return new PostgresAdapter();
	}
}
