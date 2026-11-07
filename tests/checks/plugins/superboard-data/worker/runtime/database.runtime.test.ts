import { beforeAll, describe, expect, it } from "vitest";

import { createKey, ensureTable, jsonOf, operator, publicRequest, sdk, service } from "./helpers";

type Row = Record<string, unknown> & { id: string; owner_id: string | null };
type Page = { items: Row[]; nextCursor?: string; count?: number };

describe("Application database", () => {
	beforeAll(async () => {
		await ensureTable({
			name: "todos",
			columns: [
				{ name: "title", type: "text", nullable: false },
				{ name: "done", type: "boolean", nullable: false, default: false },
				{ name: "priority", type: "integer" },
				{ name: "meta", type: "json" },
			],
		});
	});

	it("creates typed tables with owner-only rules by default", async () => {
		const response = await operator("/tables/todos");
		expect(response.status).toBe(200);
		const table = await jsonOf<{
			rules: Record<string, string>;
			columns: { name: string; type: string }[];
		}>(response);
		expect(table.rules).toEqual({
			read: "owner",
			insert: "owner",
			update: "owner",
			delete: "owner",
		});
		expect(table.columns.map((column) => [column.name, column.type])).toEqual([
			["title", "text"],
			["done", "boolean"],
			["priority", "integer"],
			["meta", "json"],
		]);
		const duplicate = await operator("/tables", { method: "POST", body: { name: "todos" } });
		expect(duplicate.status).toBe(409);
	});

	it("keeps each user's rows private under the owner rule", async () => {
		const created = await sdk("/v1/db/todos", {
			method: "POST",
			user: "alice",
			body: { title: "Buy milk", priority: 2, meta: { tags: ["home"] } },
		});
		expect(created.status).toBe(201);
		const row = await jsonOf<Row>(created);
		expect(row).toMatchObject({
			owner_id: "alice",
			title: "Buy milk",
			done: false,
			priority: 2,
			meta: { tags: ["home"] },
		});

		const alice = await jsonOf<Page>(await sdk("/v1/db/todos", { user: "alice" }));
		const bob = await jsonOf<Page>(await sdk("/v1/db/todos", { user: "bob" }));
		expect(alice.items.map((item) => item.id)).toContain(row.id);
		expect(bob.items).toEqual([]);

		expect((await sdk(`/v1/db/todos/${row.id}`, { user: "bob" })).status).toBe(404);
		expect(
			(await sdk(`/v1/db/todos/${row.id}`, { method: "PATCH", user: "bob", body: { done: true } }))
				.status,
		).toBe(404);
		const anonymous = await sdk("/v1/db/todos");
		expect(anonymous.status).toBe(401);
		expect(await jsonOf(anonymous)).toMatchObject({ error: { code: "authentication_required" } });
	});

	it("filters, orders and paginates with a cursor", async () => {
		for (const [title, priority] of [
			["Write report", 5],
			["Call plumber", 4],
			["Read book", 1],
			["Water plants", null],
		] as const)
			await sdk("/v1/db/todos", { method: "POST", user: "carol", body: { title, priority } });

		const first = await jsonOf<Page>(
			await sdk("/v1/db/todos?priority=gte.1&order=priority.desc&limit=2&count=exact", {
				user: "carol",
			}),
		);
		expect(first.items.map((item) => item.title)).toEqual(["Write report", "Call plumber"]);
		expect(first.count).toBe(3);
		expect(first.nextCursor).toBeTruthy();
		const second = await jsonOf<Page>(
			await sdk(
				`/v1/db/todos?priority=gte.1&order=priority.desc&limit=2&cursor=${first.nextCursor}`,
				{ user: "carol" },
			),
		);
		expect(second.items.map((item) => item.title)).toEqual(["Read book"]);
		expect(second.nextCursor).toBeUndefined();

		const search = await jsonOf<Page>(
			await sdk("/v1/db/todos?title=ilike.*PLANT*&select=title", { user: "carol" }),
		);
		expect(search.items).toEqual([{ id: expect.any(String) as string, title: "Water plants" }]);
		const missing = await jsonOf<Page>(
			await sdk("/v1/db/todos?priority=is.null", { user: "carol" }),
		);
		expect(missing.items.map((item) => item.title)).toEqual(["Water plants"]);
		const listed = await jsonOf<Page>(
			await sdk("/v1/db/todos?priority=in.(1,4)&order=priority.asc", { user: "carol" }),
		);
		expect(listed.items.map((item) => item.priority)).toEqual([1, 4]);
		const negated = await jsonOf<Page>(
			await sdk("/v1/db/todos?priority=not.is.null&count=exact&limit=1", { user: "carol" }),
		);
		expect(negated.count).toBe(3);
	});

	it("rejects invalid writes with a stable error code", async () => {
		const cases: [unknown, string][] = [
			[{ title: "x", unknown: 1 }, "column_unknown"],
			[{ title: 3 }, "value_invalid"],
			[{ priority: 1 }, "column_required"],
			[{ title: "x", created_at: "2020-01-01" }, "column_readonly"],
			[{ title: "x", owner_id: "mallory" }, "owner_readonly"],
		];
		for (const [input, code] of cases) {
			const response = await sdk("/v1/db/todos", { method: "POST", user: "dave", body: input });
			expect(await jsonOf(response)).toMatchObject({ error: { code } });
		}
		const filterless = await sdk("/v1/db/todos", { method: "DELETE", user: "dave" });
		expect(await jsonOf(filterless)).toMatchObject({ error: { code: "filter_required" } });
		const unknownFilter = await sdk("/v1/db/todos?nope=eq.1", { user: "dave" });
		expect(await jsonOf(unknownFilter)).toMatchObject({ error: { code: "filter_column_unknown" } });
	});

	it("updates, upserts and deletes visible rows", async () => {
		const id = crypto.randomUUID();
		const inserted = await jsonOf<Row>(
			await sdk("/v1/db/todos", { method: "POST", user: "erin", body: { id, title: "Draft" } }),
		);
		expect(inserted.id).toBe(id);
		const conflict = await sdk("/v1/db/todos", {
			method: "POST",
			user: "erin",
			body: { id, title: "Again" },
		});
		expect(conflict.status).toBe(409);
		const upserted = await sdk("/v1/db/todos?upsert=true", {
			method: "POST",
			user: "erin",
			body: { id, title: "Final" },
		});
		expect(await jsonOf(upserted)).toMatchObject({ id, title: "Final", owner_id: "erin" });
		const stolen = await sdk("/v1/db/todos?upsert=true", {
			method: "POST",
			user: "frank",
			body: { id, title: "Mine" },
		});
		expect(stolen.status).toBe(409);

		const updated = await sdk(`/v1/db/todos?title=eq.Final`, {
			method: "PATCH",
			user: "erin",
			body: { done: true },
		});
		expect((await jsonOf<Page>(updated)).items.map((item) => item.done)).toEqual([true]);
		const deleted = await sdk(`/v1/db/todos/${id}`, { method: "DELETE", user: "erin" });
		expect(deleted.status).toBe(200);
		expect((await sdk(`/v1/db/todos/${id}`, { user: "erin" })).status).toBe(404);
	});

	it("refuses a token issued for another project", async () => {
		const response = await sdk("/v1/db/todos", { user: "alice", projectId: 99 });
		expect(response.status).toBe(401);
		expect(await jsonOf(response)).toMatchObject({ error: { code: "token_project_mismatch" } });
	});

	it("opens a public table to anonymous readers only for reads", async () => {
		await ensureTable({
			name: "articles",
			rules: { read: "public", insert: "service", update: "service", delete: "service" },
			columns: [{ name: "headline", type: "text", nullable: false }],
		});
		const secret = await createKey("articles");
		const created = await service("/v1/db/articles", secret, {
			method: "POST",
			body: { headline: "Hello" },
		});
		expect(created.status).toBe(201);
		expect(await jsonOf(created)).toMatchObject({ owner_id: null, headline: "Hello" });
		const listed = await jsonOf<Page>(await sdk("/v1/db/articles"));
		expect(listed.items.map((item) => item.headline)).toContain("Hello");
		const write = await sdk("/v1/db/articles", {
			method: "POST",
			user: "alice",
			body: { headline: "Spam" },
		});
		expect(write.status).toBe(403);
	});

	it("authorizes server keys until they are revoked", async () => {
		const secret = await createKey("ci");
		const tables = await service("/v1/manage/tables", secret);
		expect(tables.status).toBe(200);
		const keys = await jsonOf<{ items: { id: string; name: string; hint: string }[] }>(
			await operator("/keys"),
		);
		const key = keys.items.find((item) => item.name === "ci")!;
		expect(key.hint.startsWith("sb_secret_")).toBe(true);
		expect(JSON.stringify(keys)).not.toContain(secret);
		expect((await operator(`/keys/${key.id}`, { method: "DELETE" })).status).toBe(200);
		const revoked = await service("/v1/manage/tables", secret);
		expect(revoked.status).toBe(401);
		const forged = await publicRequest("/v1/manage/tables", {
			headers: { authorization: "Bearer sb_secret_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
		});
		expect(forged.status).toBe(401);
	});

	it("applies a declarative schema and refuses destructive changes by default", async () => {
		const secret = await createKey("schema");
		const schema = {
			tables: [
				{
					name: "notes",
					rules: { read: "authenticated" },
					columns: [
						{ name: "body", type: "text", nullable: false },
						{ name: "pinned", type: "boolean", default: false },
					],
				},
			],
		};
		const plan = await jsonOf<{ changes: { action: string }[]; applied: boolean }>(
			await service("/v1/manage/schema?dry_run=true", secret, { method: "POST", body: schema }),
		);
		expect(plan).toEqual({
			applied: false,
			changes: [{ action: "create_table", table: "notes", destructive: false }],
		});
		const applied = await service("/v1/manage/schema", secret, { method: "POST", body: schema });
		expect(await jsonOf(applied)).toMatchObject({ applied: true });

		const shrunk = { tables: [{ ...schema.tables[0], columns: [schema.tables[0]!.columns[0]] }] };
		const refused = await service("/v1/manage/schema", secret, { method: "POST", body: shrunk });
		expect(refused.status).toBe(409);
		expect(await jsonOf(refused)).toMatchObject({ error: { code: "destructive_changes" } });
		const forced = await service("/v1/manage/schema?allow_destructive=true", secret, {
			method: "POST",
			body: shrunk,
		});
		expect(await jsonOf(forced)).toMatchObject({
			applied: true,
			changes: [{ action: "drop_column", column: "pinned" }],
		});

		const types = await service("/v1/manage/types", secret);
		const source = await types.text();
		expect(source).toContain("export interface Database {");
		expect(source).toContain("\tnotes: {");
		expect(source).toContain("body: string;");
		expect(source).not.toContain("pinned");
	});

	it("adds, alters and removes columns on a table with rows", async () => {
		await sdk("/v1/db/todos", { method: "POST", user: "gina", body: { title: "Existing" } });
		const required = await operator("/tables/todos/columns", {
			method: "POST",
			body: { name: "category", type: "text", nullable: false },
		});
		expect(await jsonOf(required)).toMatchObject({ error: { code: "column_default_required" } });
		const added = await operator("/tables/todos/columns", {
			method: "POST",
			body: { name: "category", type: "text", nullable: false, default: "general" },
		});
		expect(added.status).toBe(201);
		const rows = await jsonOf<Page>(await sdk("/v1/db/todos?title=eq.Existing", { user: "gina" }));
		expect(rows.items[0]).toMatchObject({ category: "general" });
		const indexed = await operator("/tables/todos/columns/category", {
			method: "PATCH",
			body: { indexed: true },
		});
		expect(indexed.status).toBe(200);
		const unconfirmed = await operator("/tables/todos/columns/category", { method: "DELETE" });
		expect(await jsonOf(unconfirmed)).toMatchObject({ error: { code: "confirmation_required" } });
		const removed = await operator("/tables/todos/columns/category?confirm=category", {
			method: "DELETE",
		});
		expect(removed.status).toBe(200);
	});

	it("runs read-only SQL limited to the project tables", async () => {
		const result = await operator("/sql", {
			method: "POST",
			body: {
				query: "SELECT title FROM adb_12_todos WHERE owner_id = 'carol' ORDER BY title LIMIT 2",
			},
		});
		expect(await jsonOf(result)).toMatchObject({
			columns: ["title"],
			rows: [["Call plumber"], ["Read book"]],
		});
		for (const [query, code] of [
			["DELETE FROM adb_12_todos", "sql_read_only"],
			["WITH x AS (SELECT 1) DELETE FROM adb_12_todos", "sql_read_only"],
			["SELECT * FROM data_service_keys", "sql_table_forbidden"],
			["SELECT * FROM adb_99_todos", "sql_table_forbidden"],
			["SELECT 1; SELECT 2", "sql_single_statement"],
		])
			expect(
				await jsonOf(await operator("/sql", { method: "POST", body: { query } })),
			).toMatchObject({
				error: { code },
			});
	});

	it("describes readable tables in OpenAPI", async () => {
		const document = await jsonOf<{
			paths: Record<string, unknown>;
			components: { schemas: Record<string, unknown> };
		}>(await sdk("/v1/openapi.json"));
		expect(Object.keys(document.paths)).toContain("/db/articles");
		expect(Object.keys(document.paths)).not.toContain("/db/todos");
		expect(document.components.schemas).toHaveProperty("Articles");
	});
});
