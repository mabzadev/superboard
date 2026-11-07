import type { DialectAdapter } from "kysely";
import { Kysely, SqliteDialect } from "kysely";
import { describe, expect, it } from "vitest";

import {
	LockingSqliteAdapter,
	readMigrationLock,
} from "../../../../../../packages/core/src/database/migration-lock.js";
import {
	MIGRATION_NAMES,
	runMigrations,
} from "../../../../../../packages/core/src/database/migrations/runner.js";
import type { Database as EmDashDatabase } from "../../../../../../packages/core/src/database/types.js";
import { NodeSqliteCompatDatabase as Database } from "../../../../../../packages/core/src/db/node-sqlite-compat.js";

class LockingSqliteDialect extends SqliteDialect {
	override createAdapter(): DialectAdapter {
		return new LockingSqliteAdapter();
	}
}

const LOCK_WRITE = /^update "_emdash_migrations_lock" set "is_locked" = \?/i;

describe("LockingSqliteAdapter", () => {
	it("releases the lock after a successful run when the first release write fails", async () => {
		const sqlite = new Database(":memory:");
		const prepare = sqlite.prepare.bind(sqlite);
		let lockWrites = 0;
		sqlite.prepare = ((source: string) => {
			if (LOCK_WRITE.test(source) && ++lockWrites === 2) {
				throw new Error("D1_ERROR: Network connection lost.");
			}
			return prepare(source);
		}) as typeof sqlite.prepare;
		const db = new Kysely<EmDashDatabase>({
			dialect: new LockingSqliteDialect({ database: sqlite }),
		});
		try {
			await expect(runMigrations(db)).resolves.toEqual({ applied: [...MIGRATION_NAMES] });
			expect(await readMigrationLock(db)).toBeNull();
		} finally {
			await db.destroy();
		}
	});
});
