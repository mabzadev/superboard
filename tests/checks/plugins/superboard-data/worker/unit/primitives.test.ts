import { describe, expect, it } from "vitest";

import { typescriptTypes } from "../../../../../../packages/plugins/superboard-data/worker/src/database/codegen";
import {
	cursorClause,
	encodeCursor,
	parseFilters,
	parseOrder,
} from "../../../../../../packages/plugins/superboard-data/worker/src/database/query";
import type { TableDefinition } from "../../../../../../packages/plugins/superboard-data/worker/src/database/schema";
import {
	nextRun,
	parseCron,
} from "../../../../../../packages/plugins/superboard-data/worker/src/functions/cron";
import { changeVisible } from "../../../../../../packages/plugins/superboard-data/worker/src/realtime/hub";

const table: TableDefinition = {
	name: "todos",
	label: null,
	rules: { read: "owner", insert: "owner", update: "owner", delete: "owner" },
	realtime: false,
	created_at: "2026-11-07T00:00:00.000Z",
	updated_at: "2026-11-07T00:00:00.000Z",
	columns: [
		{
			name: "title",
			type: "text",
			nullable: false,
			default: null,
			unique: false,
			indexed: false,
			position: 0,
		},
		{
			name: "done",
			type: "boolean",
			nullable: false,
			default: false,
			unique: false,
			indexed: false,
			position: 1,
		},
		{
			name: "rank",
			type: "integer",
			nullable: true,
			default: null,
			unique: false,
			indexed: false,
			position: 2,
		},
		{
			name: "meta",
			type: "json",
			nullable: true,
			default: null,
			unique: false,
			indexed: false,
			position: 3,
		},
	],
};

describe("Cron schedules", () => {
	it("finds the next matching minute in UTC", () => {
		const from = new Date("2026-11-07T10:07:30.000Z");
		expect(nextRun("*/15 * * * *", from).toISOString()).toBe("2026-11-07T10:15:00.000Z");
		expect(nextRun("0 9 * * *", from).toISOString()).toBe("2026-11-08T09:00:00.000Z");
		expect(nextRun("30 8 1 * *", from).toISOString()).toBe("2026-12-01T08:30:00.000Z");
		expect(nextRun("0 0 * * 1", from).toISOString()).toBe("2026-11-09T00:00:00.000Z");
		expect(nextRun("0 0 * * 7", from).toISOString()).toBe("2026-11-08T00:00:00.000Z");
		expect(nextRun("0 12 13 * 5", from).toISOString()).toBe("2026-11-13T12:00:00.000Z");
		expect(nextRun("5,10-12 * * * *", from).toISOString()).toBe("2026-11-07T10:10:00.000Z");
	});

	it("rejects malformed expressions and impossible dates", () => {
		for (const expression of ["* * * *", "60 * * * *", "*/0 * * * *", "5-1 * * * *", "a * * * *"])
			expect(() => parseCron(expression)).toThrow(
				expect.objectContaining({ code: "cron_invalid" }),
			);
		expect(() => nextRun("0 0 31 2 *", new Date("2026-01-01T00:00:00Z"))).toThrow(
			expect.objectContaining({ code: "cron_never_runs" }),
		);
	});
});

describe("Row filters", () => {
	it("translates PostgREST-style filters into parameterized SQL", () => {
		const filters = parseFilters(
			new URLSearchParams(
				"title=ilike.*50%_off*&done=eq.true&rank=in.(1,2)&meta=is.null&order=rank.desc&rank=not.is.null",
			),
			table,
		);
		expect(filters.sql).toBe(
			`"title" LIKE ? ESCAPE '\\' AND "done" = ? AND "rank" IN (?, ?) AND "meta" IS NULL AND NOT ("rank" IS NULL)`,
		);
		expect(filters.values).toEqual(["%50\\%\\_off%", 1, 1, 2]);
		expect(parseFilters(new URLSearchParams("title=like.Ca?[t]*"), table).values).toEqual([
			"Ca[?][[]t]*",
		]);
		expect(parseFilters(new URLSearchParams('title=in.("a,b",c)'), table).values).toEqual([
			"a,b",
			"c",
		]);
	});

	it("rejects unknown columns, operators and mistyped values", () => {
		for (const [query, code] of [
			["missing=eq.1", "filter_column_unknown"],
			["title=between.1", "filter_operator_invalid"],
			["rank=eq.one", "filter_value_invalid"],
			["done=eq.yes", "filter_value_invalid"],
			["meta=eq.{}", "filter_column_invalid"],
			["rank=like.1*", "filter_operator_invalid"],
		])
			expect(() => parseFilters(new URLSearchParams(query), table)).toThrow(
				expect.objectContaining({ code }),
			);
		expect(() => parseOrder(new URLSearchParams("order=meta.asc"), table)).toThrow(
			expect.objectContaining({ code: "order_invalid" }),
		);
	});

	it("resumes a descending page after rows without a value", () => {
		const order = parseOrder(new URLSearchParams("order=rank.desc"), table);
		const afterValue = cursorClause(encodeCursor(order, { id: "b", rank: 4 }), order, table);
		expect(afterValue).toEqual({
			sql: `("rank" < ? OR ("rank" = ? AND "id" < ?) OR "rank" IS NULL)`,
			values: [4, 4, "b"],
		});
		const afterNull = cursorClause(encodeCursor(order, { id: "c", rank: null }), order, table);
		expect(afterNull).toEqual({ sql: `("rank" IS NULL AND "id" < ?)`, values: ["c"] });
		const otherOrder = parseOrder(new URLSearchParams("order=rank.asc"), table);
		expect(() =>
			cursorClause(encodeCursor(order, { id: "b", rank: 4 }), otherOrder, table),
		).toThrow(expect.objectContaining({ code: "cursor_invalid" }));
	});
});

describe("Generated types", () => {
	it("marks columns with defaults as optional on insert", () => {
		const source = typescriptTypes([table]);
		expect(source).toContain(
			"\t\t\ttitle: string;\n\t\t\tdone?: boolean;\n\t\t\trank?: number | null;",
		);
		expect(source).toContain("\t\t\tmeta: Json | null;");
	});
});

describe("Realtime visibility", () => {
	const change = {
		event: "INSERT" as const,
		record: { id: "1", owner_id: "alice" },
		old_record: null,
	};
	it("follows the read rule of the table", () => {
		const alice = {
			projectId: 1,
			role: "authenticated" as const,
			userId: "alice",
			expiresAt: Number.MAX_SAFE_INTEGER,
		};
		const bob = {
			projectId: 1,
			role: "authenticated" as const,
			userId: "bob",
			expiresAt: Number.MAX_SAFE_INTEGER,
		};
		const visitor = {
			projectId: 1,
			role: "anon" as const,
			userId: null,
			expiresAt: Number.MAX_SAFE_INTEGER,
		};
		const server = {
			projectId: 1,
			role: "service" as const,
			userId: null,
			expiresAt: Number.MAX_SAFE_INTEGER,
		};
		expect(changeVisible("owner", alice, change)).toBe(true);
		expect(changeVisible("owner", bob, change)).toBe(false);
		expect(changeVisible("authenticated", bob, change)).toBe(true);
		expect(changeVisible("authenticated", visitor, change)).toBe(false);
		expect(changeVisible("public", visitor, change)).toBe(true);
		expect(changeVisible("service", alice, change)).toBe(false);
		expect(changeVisible("service", server, change)).toBe(true);
		expect(
			changeVisible("owner", alice, {
				event: "DELETE",
				record: null,
				old_record: { id: "1", owner_id: "alice" },
			}),
		).toBe(true);
	});
});
