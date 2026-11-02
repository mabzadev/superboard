import { sql } from "kysely";
import { describe, expect, it } from "vitest";

import {
	ConcurrentMigrationTimeoutError,
	MIGRATION_COUNT,
	runMigrations,
} from "../../../../../../packages/core/src/database/migrations/runner.js";
import {
	createTestPostgresDatabase,
	hasPgTestDatabase,
	type PgTestContext,
	setupTestPostgresDatabase,
	teardownTestPostgresDatabase,
} from "../../utils/test-db.js";

const LOCK_ID = BigInt("3853314791062309107");

async function holdMigrationLock(
	ctx: PgTestContext,
): Promise<{ release: () => void; done: Promise<void> }> {
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let acquired!: () => void;
	let failed!: (error: unknown) => void;
	const acquiredPromise = new Promise<void>((resolve, reject) => {
		acquired = resolve;
		failed = reject;
	});
	const done = ctx.db
		.transaction()
		.execute(async (trx) => {
			await sql`select pg_advisory_xact_lock(${sql.lit(LOCK_ID)})`.execute(trx);
			acquired();
			await held;
		})
		.catch((error: unknown) => {
			failed(error);
			throw error;
		});
	await acquiredPromise;
	return { release, done };
}

describe.runIf(hasPgTestDatabase)("Fail-fast Postgres migration lock (#1744)", () => {
	it("fails fast instead of blocking when another migrator holds the lock", async () => {
		const ctx = await createTestPostgresDatabase();
		try {
			const lock = await holdMigrationLock(ctx);
			try {
				const start = Date.now();
				await expect(
					runMigrations(ctx.db, { migrationTableSchema: ctx.schemaName, raceWaitMs: 300 }),
				).rejects.toThrow(ConcurrentMigrationTimeoutError);
				expect(Date.now() - start).toBeLessThan(5000);
			} finally {
				lock.release();
				await lock.done;
			}
		} finally {
			await teardownTestPostgresDatabase(ctx);
		}
	});

	it("treats the busy lock as success once the concurrent migrator finishes", async () => {
		const ctx = await setupTestPostgresDatabase();
		try {
			const lastRow = await sql<{ name: string; timestamp: string }>`
				SELECT name, timestamp FROM _emdash_migrations ORDER BY name DESC LIMIT 1
			`.execute(ctx.db);
			const last = lastRow.rows[0]!;
			await sql`DELETE FROM _emdash_migrations WHERE name = ${last.name}`.execute(ctx.db);

			const lock = await holdMigrationLock(ctx);
			try {
				const migration = runMigrations(ctx.db, {
					migrationTableSchema: ctx.schemaName,
					raceWaitMs: 10_000,
				});
				await sql`
					INSERT INTO _emdash_migrations (name, timestamp)
					VALUES (${last.name}, ${last.timestamp})
				`.execute(ctx.db);
				await expect(migration).resolves.toEqual({ applied: [] });
			} finally {
				lock.release();
				await lock.done;
			}
		} finally {
			await teardownTestPostgresDatabase(ctx);
		}
	});

	it("surfaces a genuinely failing migration without queueing concurrent callers", async () => {
		const ctx = await setupTestPostgresDatabase();
		try {
			await sql`DELETE FROM _emdash_migrations WHERE name = '001_initial'`.execute(ctx.db);

			const start = Date.now();
			const results = await Promise.allSettled([
				runMigrations(ctx.db, { migrationTableSchema: ctx.schemaName, raceWaitMs: 500 }),
				runMigrations(ctx.db, { migrationTableSchema: ctx.schemaName, raceWaitMs: 500 }),
			]);
			expect(Date.now() - start).toBeLessThan(15_000);

			expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
			const messages = results.map((r) =>
				r.status === "rejected" ? String((r.reason as Error).message) : "",
			);
			expect(messages.some((m) => /Migration failed/i.test(m))).toBe(true);

			const count = await sql<{ count: number }>`
				SELECT COUNT(*) as count FROM _emdash_migrations
			`.execute(ctx.db);
			expect(Number(count.rows[0]?.count)).toBe(MIGRATION_COUNT - 1);
		} finally {
			await teardownTestPostgresDatabase(ctx);
		}
	});
});
