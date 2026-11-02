import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../../../../../packages/core/src/database/connection.js";
import {
	MIGRATION_COUNT,
	runMigrations,
} from "../../../../../../packages/core/src/database/migrations/runner.js";

describe("Migration race condition (#762)", () => {
	let tmpDir: string;
	let dbPath: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "emdash-migration-race-"));
		dbPath = join(tmpDir, "data.db");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should not throw when two callers run migrations concurrently", async () => {
		const dbA = createDatabase({ url: `file:${dbPath}` });
		const dbB = createDatabase({ url: `file:${dbPath}` });

		try {
			const results = await Promise.allSettled([runMigrations(dbA), runMigrations(dbB)]);

			const failures = results.filter((r) => r.status === "rejected");
			if (failures.length > 0) {
				const messages = failures.map((f) =>
					f.status === "rejected" ? String(f.reason?.message ?? f.reason) : "",
				);
				throw new Error(
					`Concurrent runMigrations should not throw, but got ${failures.length} failure(s):\n${messages.join("\n")}`,
				);
			}

			const verifyDb = createDatabase({ url: `file:${dbPath}` });
			try {
				const row = await sql<{ count: number }>`
					SELECT COUNT(*) as count FROM _emdash_migrations
				`.execute(verifyDb);
				expect(Number(row.rows[0]?.count)).toBe(MIGRATION_COUNT);
			} finally {
				await verifyDb.destroy();
			}
		} finally {
			await dbA.destroy();
			await dbB.destroy();
		}
	});

	it("should fast-path when the migration table has more rows than this build knows about", async () => {
		const db = createDatabase({ url: `file:${dbPath}` });
		try {
			await runMigrations(db);
			await sql`
				INSERT INTO _emdash_migrations (name, timestamp)
				VALUES ('999_future_build', ${new Date().toISOString()})
			`.execute(db);

			const result = await runMigrations(db);
			expect(result.applied).toEqual([]);

			const row = await sql<{ count: number }>`
				SELECT COUNT(*) as count FROM _emdash_migrations
			`.execute(db);
			expect(Number(row.rows[0]?.count)).toBe(MIGRATION_COUNT + 1);
		} finally {
			await db.destroy();
		}
	});

	it("should still surface unrelated migration errors", async () => {
		const db = createDatabase({ url: `file:${dbPath}` });
		try {
			await runMigrations(db);
			await sql`DELETE FROM _emdash_migrations WHERE name = '001_initial'`.execute(db);
			await expect(runMigrations(db)).rejects.toThrow(/Migration failed/i);
		} finally {
			await db.destroy();
		}
	});
});
