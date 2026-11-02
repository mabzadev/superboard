import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	MAX_404_LOG_ROWS,
	REFERRER_MAX_LENGTH,
	RedirectRepository,
	USER_AGENT_MAX_LENGTH,
} from "../../../../../../packages/core/src/database/repositories/redirect.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

async function seedToCapacity(db: Kysely<Database>): Promise<void> {
	const now = Date.now();
	const batchSize = 500;
	for (let start = 0; start < MAX_404_LOG_ROWS; start += batchSize) {
		const end = Math.min(start + batchSize, MAX_404_LOG_ROWS);
		const rows = [];
		for (let i = start; i < end; i++) {
			const ts = new Date(now - (MAX_404_LOG_ROWS - i) * 1000).toISOString();
			rows.push({
				id: `seed-${i.toString().padStart(6, "0")}`,
				path: `/seed-${i}`,
				referrer: null,
				user_agent: null,
				ip: null,
				hits: 1,
				last_seen_at: ts,
				created_at: ts,
			});
		}
		await db.insertInto("_emdash_404_log").values(rows).execute();
	}
}

describe("RedirectRepository.log404 — bounded logging", () => {
	let db: Kysely<Database>;
	let repo: RedirectRepository;

	beforeEach(async () => {
		db = await setupTestDatabase();
		repo = new RedirectRepository(db);
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("dedups repeat hits by path instead of inserting new rows", async () => {
		await repo.log404({ path: "/missing" });
		await repo.log404({ path: "/missing" });
		await repo.log404({ path: "/missing" });

		const rows = await db
			.selectFrom("_emdash_404_log")
			.selectAll()
			.where("path", "=", "/missing")
			.execute();

		expect(rows).toHaveLength(1);
		expect(rows[0]!.hits).toBe(3);
		expect(rows[0]!.last_seen_at).toBeTruthy();
	});

	it("truncates oversize referrer and user_agent on insert", async () => {
		const bigReferrer = "https://evil.example.com/" + "a".repeat(10_000);
		const bigUserAgent = "Mozilla/5.0 " + "b".repeat(10_000);

		await repo.log404({
			path: "/missing",
			referrer: bigReferrer,
			userAgent: bigUserAgent,
		});

		const row = await db
			.selectFrom("_emdash_404_log")
			.selectAll()
			.where("path", "=", "/missing")
			.executeTakeFirstOrThrow();

		expect(row.referrer?.length).toBeLessThanOrEqual(REFERRER_MAX_LENGTH);
		expect(row.user_agent?.length).toBeLessThanOrEqual(USER_AGENT_MAX_LENGTH);
		expect(row.referrer!.length).toBe(REFERRER_MAX_LENGTH);
		expect(row.user_agent!.length).toBe(USER_AGENT_MAX_LENGTH);
	});

	it("preserves null referrer / user_agent without coercing to empty string", async () => {
		await repo.log404({ path: "/missing", referrer: null, userAgent: null });

		const row = await db
			.selectFrom("_emdash_404_log")
			.selectAll()
			.where("path", "=", "/missing")
			.executeTakeFirstOrThrow();

		expect(row.referrer).toBeNull();
		expect(row.user_agent).toBeNull();
	});

	it("evicts the oldest entry when the table is at capacity", async () => {
		await seedToCapacity(db);

		const before = await db
			.selectFrom("_emdash_404_log")
			.select((eb) => eb.fn.countAll<number>().as("c"))
			.executeTakeFirstOrThrow();
		expect(Number(before.c)).toBe(MAX_404_LOG_ROWS);

		await repo.log404({ path: "/brand-new" });

		const after = await db
			.selectFrom("_emdash_404_log")
			.select((eb) => eb.fn.countAll<number>().as("c"))
			.executeTakeFirstOrThrow();
		expect(Number(after.c)).toBe(MAX_404_LOG_ROWS);

		const oldest = await db
			.selectFrom("_emdash_404_log")
			.select("id")
			.where("id", "=", "seed-000000")
			.executeTakeFirst();
		expect(oldest).toBeUndefined();

		const fresh = await db
			.selectFrom("_emdash_404_log")
			.select("path")
			.where("path", "=", "/brand-new")
			.executeTakeFirst();
		expect(fresh?.path).toBe("/brand-new");
	});

	it("does not evict when an existing path is hit again, even at capacity", async () => {
		await seedToCapacity(db);

		await repo.log404({ path: "/seed-500" });

		const oldest = await db
			.selectFrom("_emdash_404_log")
			.select("id")
			.where("id", "=", "seed-000000")
			.executeTakeFirst();
		expect(oldest?.id).toBe("seed-000000");

		const bumped = await db
			.selectFrom("_emdash_404_log")
			.select(["hits"])
			.where("path", "=", "/seed-500")
			.executeTakeFirstOrThrow();
		expect(bumped.hits).toBe(2);
	});

	it("handles concurrent inserts for the same new path atomically", async () => {
		const concurrency = 10;
		const pending: Array<Promise<void>> = [];
		for (let i = 0; i < concurrency; i++) {
			pending.push(repo.log404({ path: "/race" }));
		}
		await Promise.all(pending);

		const rows = await db
			.selectFrom("_emdash_404_log")
			.selectAll()
			.where("path", "=", "/race")
			.execute();

		expect(rows).toHaveLength(1);
		expect(rows[0]!.hits).toBe(concurrency);
	});
});
