import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBridgeHandler } from "../../../../packages/workerd/src/sandbox/bridge-handler.js";

function createTestDb() {
	const sqlite = new Database(":memory:");
	const db = new Kysely<any>({
		dialect: new SqliteDialect({ database: sqlite }),
	});
	return { db, sqlite };
}

async function runMigrations(db: Kysely<any>) {
	await db.schema
		.createTable("_emdash_collections")
		.addColumn("id", "text", (col) => col.primaryKey())
		.addColumn("slug", "text", (col) => col.notNull().unique())
		.addColumn("supports", "text")
		.execute();
	await db.schema
		.createTable("_emdash_fields")
		.addColumn("collection_id", "text", (col) => col.notNull())
		.addColumn("slug", "text", (col) => col.notNull())
		.execute();

	await db.schema
		.createTable("revisions")
		.addColumn("id", "text", (col) => col.primaryKey())
		.addColumn("collection", "text", (col) => col.notNull())
		.addColumn("entry_id", "text", (col) => col.notNull())
		.addColumn("data", "text", (col) => col.notNull())
		.addColumn("author_id", "text")
		.addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`(datetime('now'))`))
		.execute();

	await db.schema
		.createTable("_emdash_revision_prune_queue")
		.addColumn("collection", "text", (col) => col.notNull())
		.addColumn("entry_id", "text", (col) => col.notNull())
		.addColumn("revision_id", "text", (col) => col.notNull())
		.addPrimaryKeyConstraint("pk_revision_prune_queue", ["collection", "entry_id"])
		.execute();

	await db.schema
		.createTable("_plugin_storage")
		.addColumn("plugin_id", "text", (col) => col.notNull())
		.addColumn("collection", "text", (col) => col.notNull())
		.addColumn("id", "text", (col) => col.notNull())
		.addColumn("data", "text", (col) => col.notNull())
		.addColumn("created_at", "text", (col) => col.notNull())
		.addColumn("updated_at", "text", (col) => col.notNull())
		.addPrimaryKeyConstraint("pk_plugin_storage", ["plugin_id", "collection", "id"])
		.execute();

	await db.schema
		.createTable("users")
		.addColumn("id", "text", (col) => col.primaryKey())
		.addColumn("email", "text", (col) => col.notNull())
		.addColumn("name", "text")
		.addColumn("role", "integer", (col) => col.notNull())
		.addColumn("created_at", "text", (col) => col.notNull())
		.execute();

	await db.schema
		.createTable("media")
		.addColumn("id", "text", (col) => col.primaryKey())
		.addColumn("filename", "text", (col) => col.notNull())
		.addColumn("mime_type", "text", (col) => col.notNull())
		.addColumn("size", "integer")
		.addColumn("storage_key", "text", (col) => col.notNull())
		.addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
		.addColumn("created_at", "text", (col) => col.notNull())
		.execute();

	await db.schema
		.createTable("ec_posts")
		.addColumn("id", "text", (col) => col.primaryKey())
		.addColumn("slug", "text")
		.addColumn("status", "text", (col) => col.notNull().defaultTo("draft"))
		.addColumn("author_id", "text")
		.addColumn("primary_byline_id", "text")
		.addColumn("created_at", "text", (col) => col.notNull())
		.addColumn("updated_at", "text", (col) => col.notNull())
		.addColumn("published_at", "text")
		.addColumn("scheduled_at", "text")
		.addColumn("deleted_at", "text")
		.addColumn("version", "integer", (col) => col.notNull().defaultTo(1))
		.addColumn("live_revision_id", "text")
		.addColumn("draft_revision_id", "text")
		.addColumn("locale", "text", (col) => col.notNull().defaultTo("en"))
		.addColumn("translation_group", "text")
		.addColumn("title", "text")
		.addColumn("body", "text")
		.execute();

	await db
		.insertInto("_emdash_collections" as any)
		.values({ id: "posts", slug: "posts", supports: "[]" })
		.execute();
	await db
		.insertInto("_emdash_fields" as any)
		.values([
			{ collection_id: "posts", slug: "title" },
			{ collection_id: "posts", slug: "body" },
		])
		.execute();
}

describe("Plugin integration: sandboxed-test plugin operations", () => {
	let db: Kysely<any>;
	let sqlite: Database.Database;

	beforeEach(async () => {
		const ctx = createTestDb();
		db = ctx.db;
		sqlite = ctx.sqlite;
		await runMigrations(db);
	});

	afterEach(async () => {
		await db.destroy();
		sqlite.close();
	});

	function makePluginHandler() {
		return createBridgeHandler({
			pluginId: "sandboxed-test",
			version: "0.0.1",
			capabilities: ["read:content", "network:fetch"],
			allowedHosts: ["httpbin.org"],
			storageCollections: ["events"],
			db,
			emailSend: () => null,
		});
	}

	async function call(
		handler: ReturnType<typeof makePluginHandler>,
		method: string,
		body: Record<string, unknown> = {},
	) {
		const request = new Request(`http://bridge/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const response = await handler(request);
		return response.json() as Promise<{ result?: unknown; error?: string }>;
	}

	it("KV round-trip: set, get, delete", async () => {
		const handler = makePluginHandler();

		await call(handler, "kv/set", {
			key: "sandbox-test-key",
			value: { tested: true, time: 12345 },
		});

		const getResult = await call(handler, "kv/get", { key: "sandbox-test-key" });
		expect(getResult.result).toEqual({ tested: true, time: 12345 });

		const deleteResult = await call(handler, "kv/delete", { key: "sandbox-test-key" });
		expect(deleteResult.result).toBe(true);

		const afterDelete = await call(handler, "kv/get", { key: "sandbox-test-key" });
		expect(afterDelete.result).toBeNull();
	});

	it("Storage round-trip: put, get, count", async () => {
		const handler = makePluginHandler();

		await call(handler, "storage/put", {
			collection: "events",
			id: "event-1",
			data: {
				timestamp: "2025-01-01T00:00:00Z",
				type: "test",
				message: "Sandboxed plugin storage test",
			},
		});

		const getResult = await call(handler, "storage/get", {
			collection: "events",
			id: "event-1",
		});
		expect(getResult.result).toEqual({
			timestamp: "2025-01-01T00:00:00Z",
			type: "test",
			message: "Sandboxed plugin storage test",
		});

		const countResult = await call(handler, "storage/count", { collection: "events" });
		expect(countResult.result).toBe(1);
	});

	it("Content list with read:content capability", async () => {
		const handler = makePluginHandler();

		const now = new Date().toISOString();
		await db
			.insertInto("ec_posts" as any)
			.values([
				{
					id: "post-1",
					slug: "hello",
					status: "published",
					title: "Hello World",
					created_at: now,
					updated_at: now,
					version: 1,
				},
				{
					id: "post-2",
					slug: "second",
					status: "draft",
					title: "Second Post",
					created_at: now,
					updated_at: now,
					version: 1,
				},
			])
			.execute();

		const result = await call(handler, "content/list", { collection: "posts", limit: 5 });
		expect(result.error).toBeUndefined();

		const data = result.result as {
			items: Array<{ id: string; type: string; data: Record<string, unknown> }>;
			hasMore: boolean;
		};
		expect(data.items).toHaveLength(2);
		expect(data.hasMore).toBe(false);
		expect(data.items[0]!.type).toBe("posts");
		expect(data.items[0]!.data.title).toBeDefined();
	});

	describe("content lifecycle (requires read:content + write:content)", () => {
		function makeWriteHandler(i18nConfig?: { defaultLocale: string; locales: string[] } | null) {
			return createBridgeHandler({
				pluginId: "sandboxed-test",
				version: "0.0.1",
				capabilities: ["read:content", "write:content"],
				allowedHosts: [],
				storageCollections: [],
				i18nConfig,
				db,
				emailSend: () => null,
			});
		}

		it("create, read, update, delete", async () => {
			const handler = makeWriteHandler();

			const createResult = await call(handler, "content/create", {
				collection: "posts",
				data: { title: "New Post", body: "Content here", slug: "new-post", status: "draft" },
			});
			expect(createResult.error).toBeUndefined();
			const created = createResult.result as {
				id: string;
				type: string;
				data: Record<string, unknown>;
				locale: string;
			};
			expect(created.type).toBe("posts");
			expect(created.data.title).toBe("New Post");
			expect(created.locale).toBe("en");
			expect(created.id).toBeTruthy();
			await expect(
				db
					.selectFrom("ec_posts" as any)
					.select("translation_group" as any)
					.where("id", "=", created.id)
					.executeTakeFirstOrThrow(),
			).resolves.toEqual({ translation_group: created.id });

			const readResult = await call(handler, "content/get", {
				collection: "posts",
				id: created.id,
			});
			expect(readResult.error).toBeUndefined();
			const read = readResult.result as {
				id: string;
				data: Record<string, unknown>;
				locale: string;
			};
			expect(read.data.title).toBe("New Post");
			expect(read.locale).toBe("en");

			const updateResult = await call(handler, "content/update", {
				collection: "posts",
				id: created.id,
				data: { title: "Updated Post" },
			});
			expect(updateResult.error).toBeUndefined();
			const updated = updateResult.result as {
				id: string;
				data: Record<string, unknown>;
				locale: string;
			};
			expect(updated.data.title).toBe("Updated Post");
			expect(updated.locale).toBe("en");

			const deleteResult = await call(handler, "content/delete", {
				collection: "posts",
				id: created.id,
			});
			expect(deleteResult.result).toBe(true);

			const afterDelete = await call(handler, "content/get", {
				collection: "posts",
				id: created.id,
			});
			expect(afterDelete.result).toBeNull();
		});

		it("stages revision-enabled updates and returns the effective draft", async () => {
			await db
				.updateTable("_emdash_collections" as any)
				.set({ supports: '["revisions"]' })
				.where("slug", "=", "posts")
				.execute();
			const now = new Date().toISOString();
			await db
				.insertInto("revisions" as any)
				.values({
					id: "live-revision",
					collection: "posts",
					entry_id: "published-post",
					data: JSON.stringify({ title: "Live title", body: "Live body" }),
					author_id: null,
					created_at: now,
				})
				.execute();
			await db
				.insertInto("ec_posts" as any)
				.values({
					id: "published-post",
					slug: "published-post",
					status: "published",
					title: "Live title",
					body: "Live body",
					created_at: now,
					updated_at: now,
					version: 1,
					live_revision_id: "live-revision",
				})
				.execute();
			const handler = makeWriteHandler();

			const updateResult = await call(handler, "content/update", {
				collection: "posts",
				id: "published-post",
				data: { title: "Plugin title" },
			});

			expect(updateResult.error).toBeUndefined();
			expect(updateResult.result).toMatchObject({
				id: "published-post",
				data: { title: "Plugin title", body: "Live body" },
			});
			const row = await db
				.selectFrom("ec_posts" as any)
				.selectAll()
				.where("id", "=", "published-post")
				.executeTakeFirstOrThrow();
			expect(row).toMatchObject({
				title: "Live title",
				body: "Live body",
				live_revision_id: "live-revision",
				version: 2,
			});
			expect(row.draft_revision_id).toEqual(expect.any(String));
			const draft = await db
				.selectFrom("revisions" as any)
				.select("data")
				.where("id", "=", row.draft_revision_id)
				.executeTakeFirstOrThrow();
			expect(JSON.parse(draft.data)).toEqual({ title: "Plugin title", body: "Live body" });
		});

		it("forwards and normalizes an explicit locale", async () => {
			const handler = makeWriteHandler({ defaultLocale: "en", locales: ["en", "zh-TW"] });

			const result = await call(handler, "content/create", {
				collection: "posts",
				data: { title: "繁體中文" },
				options: { locale: "zh-tw" },
			});

			expect(result.error).toBeUndefined();
			expect(result.result).toMatchObject({ locale: "zh-TW" });
			const row = await db
				.selectFrom("ec_posts" as any)
				.select("locale" as any)
				.where("id", "=", (result.result as { id: string }).id)
				.executeTakeFirstOrThrow();
			expect(row.locale).toBe("zh-TW");
		});

		it("uses configured and no-i18n fallbacks when locale is omitted", async () => {
			const configured = await call(
				makeWriteHandler({ defaultLocale: "ja", locales: ["ja"] }),
				"content/create",
				{ collection: "posts", data: { title: "日本語" } },
			);
			const legacy = await call(makeWriteHandler(null), "content/create", {
				collection: "posts",
				data: { title: "English" },
			});

			expect(configured.result).toMatchObject({ locale: "ja" });
			expect(legacy.result).toMatchObject({ locale: "en" });
		});

		it("uses the configured default locale for batch creates", async () => {
			const result = await call(
				makeWriteHandler({ defaultLocale: "ja", locales: ["ja"] }),
				"content/createMany",
				{
					collection: "posts",
					items: [{ title: "一" }, { title: "二" }],
				},
			);

			expect(result.error).toBeUndefined();
			expect(result.result).toEqual([
				expect.objectContaining({ locale: "ja" }),
				expect.objectContaining({ locale: "ja" }),
			]);
			expect(
				await db
					.selectFrom("ec_posts" as any)
					.select("locale" as any)
					.execute(),
			).toEqual([{ locale: "ja" }, { locale: "ja" }]);
		});

		it("rejects invalid locale options before inserting", async () => {
			const handler = makeWriteHandler({ defaultLocale: "en", locales: ["en", "fr"] });

			const malformed = await call(handler, "content/create", {
				collection: "posts",
				data: { title: "Malformed" },
				options: { locale: "en_US" },
			});
			const unknown = await call(handler, "content/create", {
				collection: "posts",
				data: { title: "Unknown" },
				options: { locale: "de" },
			});

			expect(malformed.error).toMatch(/invalid locale code/i);
			expect(unknown.error).toMatch(/not configured/i);
			expect(
				await db
					.selectFrom("ec_posts" as any)
					.selectAll()
					.execute(),
			).toHaveLength(0);
		});
	});

	it("sandboxed-test plugin cannot write content (only has read:content)", async () => {
		const handler = makePluginHandler();
		const result = await call(handler, "content/create", {
			collection: "posts",
			data: { title: "Should fail" },
		});
		expect(result.error).toContain("Missing capability: write:content");
	});

	it("write-only plugin cannot read content (no implicit upgrade)", async () => {
		await db.schema
			.createTable("ec_pages")
			.addColumn("id", "text", (col) => col.primaryKey())
			.addColumn("slug", "text")
			.addColumn("status", "text", (col) => col.notNull().defaultTo("draft"))
			.addColumn("author_id", "text")
			.addColumn("created_at", "text", (col) => col.notNull())
			.addColumn("updated_at", "text", (col) => col.notNull())
			.addColumn("deleted_at", "text")
			.addColumn("version", "integer", (col) => col.notNull().defaultTo(1))
			.addColumn("locale", "text", (col) => col.notNull().defaultTo("en"))
			.addColumn("translation_group", "text")
			.addColumn("title", "text")
			.execute();

		const writeOnlyHandler = createBridgeHandler({
			pluginId: "write-only-plugin",
			version: "1.0.0",
			capabilities: ["write:content"],
			allowedHosts: [],
			storageCollections: [],
			db,
			emailSend: () => null,
		});

		const getResult = await call(writeOnlyHandler, "content/get", {
			collection: "pages",
			id: "any",
		});
		expect(getResult.error).toContain("Missing capability: read:content");

		const listResult = await call(writeOnlyHandler, "content/list", {
			collection: "pages",
		});
		expect(listResult.error).toContain("Missing capability: read:content");

		const createResult = await call(writeOnlyHandler, "content/create", {
			collection: "pages",
			data: { title: "Allowed" },
		});
		expect(createResult.error).toBeUndefined();
	});

	it("write-only media plugin cannot read media", async () => {
		const writeOnlyHandler = createBridgeHandler({
			pluginId: "write-only-media",
			version: "1.0.0",
			capabilities: ["write:media"],
			allowedHosts: [],
			storageCollections: [],
			db,
			emailSend: () => null,
		});

		const getResult = await call(writeOnlyHandler, "media/get", { id: "any" });
		expect(getResult.error).toContain("Missing capability: read:media");

		const listResult = await call(writeOnlyHandler, "media/list", {});
		expect(listResult.error).toContain("Missing capability: read:media");
	});

	it("sandboxed-test plugin cannot send email (not in capabilities)", async () => {
		const handler = makePluginHandler();
		const result = await call(handler, "email/send", {
			message: { to: "a@b.com", subject: "hi", text: "hello" },
		});
		expect(result.error).toContain("Missing capability: email:send");
	});

	it("sandboxed-test plugin cannot access undeclared storage collections", async () => {
		const handler = makePluginHandler();
		const result = await call(handler, "storage/get", {
			collection: "secrets",
			id: "1",
		});
		expect(result.error).toContain("Storage collection not declared: secrets");
	});

	it("two plugins cannot see each other's KV data", async () => {
		const pluginA = createBridgeHandler({
			pluginId: "plugin-a",
			version: "1.0.0",
			capabilities: [],
			allowedHosts: [],
			storageCollections: [],
			db,
			emailSend: () => null,
		});
		const pluginB = createBridgeHandler({
			pluginId: "plugin-b",
			version: "1.0.0",
			capabilities: [],
			allowedHosts: [],
			storageCollections: [],
			db,
			emailSend: () => null,
		});

		await call(pluginA, "kv/set", { key: "secret", value: "a-only" });

		const fromA = await call(pluginA, "kv/get", { key: "secret" });
		expect(fromA.result).toBe("a-only");

		const fromB = await call(pluginB, "kv/get", { key: "secret" });
		expect(fromB.result).toBeNull();
	});

	it("two plugins cannot see each other's storage documents", async () => {
		const pluginA = createBridgeHandler({
			pluginId: "plugin-a",
			version: "1.0.0",
			capabilities: [],
			allowedHosts: [],
			storageCollections: ["shared-name"],
			db,
			emailSend: () => null,
		});
		const pluginB = createBridgeHandler({
			pluginId: "plugin-b",
			version: "1.0.0",
			capabilities: [],
			allowedHosts: [],
			storageCollections: ["shared-name"],
			db,
			emailSend: () => null,
		});

		await call(pluginA, "storage/put", {
			collection: "shared-name",
			id: "doc-1",
			data: { owner: "a" },
		});

		const fromA = await call(pluginA, "storage/get", { collection: "shared-name", id: "doc-1" });
		expect((fromA.result as Record<string, unknown>).owner).toBe("a");

		const fromB = await call(pluginB, "storage/get", { collection: "shared-name", id: "doc-1" });
		expect(fromB.result).toBeNull();
	});
});
