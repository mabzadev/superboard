import { CompiledQuery, Kysely } from "kysely";
import { describe, expect, it } from "vitest";

import { CoalescingD1Dialect } from "../../../../../packages/cloudflare/src/db/coalescing-d1.js";
import {
	D1_COMPOUND_SELECT_LIMIT,
	EmDashD1Dialect,
	RawBindingD1Dialect,
} from "../../../../../packages/cloudflare/src/db/d1-dialect.js";

interface MockStatement {
	sql: string;
	params: unknown[];
	bind: (...params: unknown[]) => MockStatement;
	all: () => Promise<unknown>;
}

function createMockD1(rows: Record<string, unknown>[] = []) {
	const allCalls: string[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const database = {
		prepare(sql: string): MockStatement {
			const stmt: MockStatement = {
				sql,
				params: [],
				bind(...params: unknown[]) {
					stmt.params = params;
					return stmt;
				},
				async all() {
					inFlight++;
					maxInFlight = Math.max(maxInFlight, inFlight);
					await new Promise((resolve) => setTimeout(resolve, 5));
					inFlight--;
					allCalls.push(sql);
					return { success: true, results: rows, meta: { changes: 0, last_row_id: 0 } };
				},
			};
			return stmt;
		},
	};
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- mock implements the prepare/batch subset the dialect uses
	const db = database as unknown as D1Database;
	return {
		database: db,
		allCalls,
		maxInFlight: () => maxInFlight,
	};
}

describe("RawBindingD1Dialect (#2040)", () => {
	it("reports supportsMultipleConnections: true so no ConnectionMutex serializes queries", () => {
		const { database } = createMockD1();
		const dialect = new RawBindingD1Dialect({ database });
		expect(dialect.createAdapter().supportsMultipleConnections).toBe(true);
	});

	it("lets concurrent queries overlap instead of serializing behind a mutex", async () => {
		const { database, allCalls, maxInFlight } = createMockD1();
		const db = new Kysely<any>({ dialect: new RawBindingD1Dialect({ database }) });

		await Promise.all([
			db.executeQuery(CompiledQuery.raw("select 1")),
			db.executeQuery(CompiledQuery.raw("select 2")),
		]);

		expect(maxInFlight()).toBe(2);
		expect(allCalls).toHaveLength(2);
	});
});

describe("EmDashD1Dialect (session path keeps the mutex)", () => {
	it("still reports supportsMultipleConnections: false", () => {
		const { database } = createMockD1();
		const dialect = new EmDashD1Dialect({ database });
		expect(dialect.createAdapter().supportsMultipleConnections).toBe(false);
	});

	it("serializes concurrent queries (maxInFlight stays 1)", async () => {
		const { database, maxInFlight } = createMockD1();
		const db = new Kysely<any>({ dialect: new EmDashD1Dialect({ database }) });

		await Promise.all([
			db.executeQuery(CompiledQuery.raw("select 1")),
			db.executeQuery(CompiledQuery.raw("select 2")),
		]);

		expect(maxInFlight()).toBe(1);
	});
});

describe("D1 compound-SELECT ceiling", () => {
	it.each([
		["raw binding", RawBindingD1Dialect],
		["session", EmDashD1Dialect],
		["coalescing", CoalescingD1Dialect],
	])("declares the ceiling on the %s adapter so core splits statements", (_name, Dialect) => {
		const { database } = createMockD1();
		const adapter = new Dialect({ database }).createAdapter();

		expect(adapter).toHaveProperty("compoundSelectLimit", D1_COMPOUND_SELECT_LIMIT);
	});
});

describe("D1 write results", () => {
	it.each([
		["raw binding", RawBindingD1Dialect],
		["session", EmDashD1Dialect],
	])("preserves DELETE RETURNING rows through the %s dialect", async (_name, Dialect) => {
		const rows = [{ storage_key: "expired.png" }];
		const { database } = createMockD1(rows);
		const db = new Kysely<any>({ dialect: new Dialect({ database }) });

		const result = await db.executeQuery(
			CompiledQuery.raw('delete from "media" where "status" = ? returning "storage_key"', [
				"pending",
			]),
		);

		expect(result.rows).toEqual(rows);
	});
});
