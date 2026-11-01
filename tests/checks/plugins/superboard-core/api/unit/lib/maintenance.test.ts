import { afterEach, describe, expect, it, vi } from "vitest";

import {
	cleanupExpiredDownloads,
	runMaintenance,
} from "../../../../../../../packages/plugins/superboard-core/api/src/lib/maintenance";
import { Env } from "../../../../../../../packages/plugins/superboard-core/api/src/types";
import { createFakeD1, FakeD1Call } from "../../helpers/fake-d1";

function permissiveDb() {
	return createFakeD1((call: FakeD1Call) => {
		if (call.op === "all") return [];
		if (call.op === "run") return { meta: { changes: 0 } };
		return null;
	});
}

function memoryKv(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const puts: Array<{ key: string; options: unknown }> = [];
	return {
		puts,
		values,
		kv: {
			get: async (key: string) => values.get(key) ?? null,
			put: async (key: string, value: string, options: unknown) => {
				values.set(key, value);
				puts.push({ key, options });
			},
		} as unknown as KVNamespace,
	};
}

function maintenanceEnv(db: D1Database, kv: KVNamespace, r2?: R2Bucket): Env {
	return {
		DB: db,
		KV: kv,
		R2: r2,
		ENVIRONMENT: "test",
		SHORTLINK_DOMAIN: "go.test",
		API_DOMAIN: "api.test",
		SDK_DOMAIN: "sdk.test",
		CORS_ORIGIN: "*",
		JWT_SECRET: "unit-test-secret",
	} as Env;
}

function backfillDates(db: ReturnType<typeof permissiveDb>) {
	return db.calls
		.filter((call) => call.sql.startsWith("INSERT INTO visitor_daily_statistics"))
		.map((call) => call.args);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("scheduled maintenance", () => {
	it("filters events with sargable UTC day ranges instead of date(created_at)", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
		const db = permissiveDb();
		const { kv } = memoryKv();

		await runMaintenance(maintenanceEnv(db, kv), 1);

		const eventQueries = db.calls.filter(
			(call) => call.sql.includes("FROM events") && call.sql.startsWith("INSERT INTO"),
		);
		expect(eventQueries).toHaveLength(3);
		for (const call of eventQueries) {
			expect(call.sql).not.toContain("date(e.created_at) = ?");
			expect(call.sql).not.toMatch(/WHERE date\(created_at\) = \?/u);
			expect(call.args.slice(0, 2)).toEqual(["2026-10-31", "2026-11-01"]);
		}
	});

	it("recomputes older days once per UTC day and only today on later runs", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
		const { kv, puts } = memoryKv();

		const firstDb = permissiveDb();
		const first = await runMaintenance(maintenanceEnv(firstDb, kv), 3, { incremental: true });
		expect(first.dailyPass).toBe(true);
		expect(first.dates).toEqual(["2026-10-29", "2026-10-30", "2026-10-31"]);
		expect(backfillDates(firstDb)).toEqual([
			["2026-10-29", "2026-10-30"],
			["2026-10-30", "2026-10-31"],
			["2026-10-31", "2026-11-01"],
		]);
		expect(
			firstDb.calls.some((call) => call.sql.includes("DELETE FROM actions WHERE NOT EXISTS")),
		).toBe(true);
		expect(puts).toEqual([
			{ key: "superboard:maintenance:daily:2026-10-31", options: { expirationTtl: 172_800 } },
		]);

		const secondDb = permissiveDb();
		const second = await runMaintenance(maintenanceEnv(secondDb, kv), 3, { incremental: true });
		expect(second.dailyPass).toBe(false);
		expect(second.dates).toEqual(["2026-10-31"]);
		expect(backfillDates(secondDb)).toEqual([["2026-10-31", "2026-11-01"]]);
		expect(
			secondDb.calls.some((call) => call.sql.includes("DELETE FROM actions WHERE NOT EXISTS")),
		).toBe(false);
		expect(
			secondDb.calls.some((call) => call.sql.includes("DELETE FROM actions WHERE handled = 1")),
		).toBe(true);
		expect(puts).toHaveLength(1);
	});

	it("keeps refreshing yesterday during the first UTC hour before the daily pass", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-31T00:20:00.000Z"));
		const { kv, puts } = memoryKv();
		const db = permissiveDb();

		const summary = await runMaintenance(maintenanceEnv(db, kv), 3, { incremental: true });

		expect(summary.dailyPass).toBe(false);
		expect(summary.dates).toEqual(["2026-10-30", "2026-10-31"]);
		expect(puts).toHaveLength(0);
	});

	it("recomputes every requested day for explicit runs", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
		const { kv, puts } = memoryKv({ "superboard:maintenance:daily:2026-10-31": "done" });
		const db = permissiveDb();

		const summary = await runMaintenance(maintenanceEnv(db, kv), 2);

		expect(summary.dates).toEqual(["2026-10-30", "2026-10-31"]);
		expect(backfillDates(db)).toHaveLength(2);
		expect(puts).toHaveLength(0);
	});
});

describe("expired download cleanup", () => {
	it("lists root objects with custom metadata and deletes expired ones in batches", async () => {
		const db = createFakeD1((call: FakeD1Call) => {
			if (call.op === "run" && call.sql.startsWith("DELETE FROM downloadable_files"))
				return { meta: { changes: call.args.length } };
			return undefined;
		});
		const listOptions: R2ListOptions[] = [];
		const deleted: Array<string | string[]> = [];
		const past = new Date(Date.now() - 60_000).toISOString();
		const future = new Date(Date.now() + 60_000).toISOString();
		const pages = [
			{
				objects: [
					{ key: "links_data_a.csv", customMetadata: { expiresAt: past } },
					{ key: "links_data_b.csv", customMetadata: { expiresAt: future } },
					{ key: "manual.csv", customMetadata: {} },
				],
				truncated: true,
				cursor: "page-2",
			},
			{
				objects: [{ key: "activity_data_c.csv", customMetadata: { expiresAt: past } }],
				truncated: false,
			},
		];
		const r2 = {
			list: async (options: R2ListOptions) => {
				listOptions.push(options);
				return pages[listOptions.length - 1];
			},
			delete: async (keys: string | string[]) => {
				deleted.push(keys);
			},
		} as unknown as R2Bucket;

		const count = await cleanupExpiredDownloads(maintenanceEnv(db, {} as KVNamespace, r2));

		expect(count).toBe(2);
		expect(listOptions).toEqual([
			{ cursor: undefined, limit: 100, delimiter: "/", include: ["customMetadata"] },
			{ cursor: "page-2", limit: 100, delimiter: "/", include: ["customMetadata"] },
		]);
		expect(deleted).toEqual([["links_data_a.csv"], ["activity_data_c.csv"]]);
		expect(db.calls.map((call) => call.args)).toEqual([
			["links_data_a.csv"],
			["activity_data_c.csv"],
		]);
	});
});
