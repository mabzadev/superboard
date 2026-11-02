import { Role } from "@emdash-cms/auth";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import { FTSManager } from "../../../../../../packages/core/src/search/fts-manager.js";
import {
	connectMcpHarness,
	extractJson,
	extractText,
	type McpHarness,
} from "../../utils/mcp-runtime.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

const ADMIN_ID = "user_admin";
const SUBSCRIBER_ID = "user_subscriber";

async function setupSearchablePostCollection(db: Kysely<Database>): Promise<void> {
	const registry = new SchemaRegistry(db);
	await registry.createCollection({
		slug: "post",
		label: "Posts",
		supports: ["drafts", "revisions", "search"],
	});
	await registry.createField("post", {
		slug: "title",
		label: "Title",
		type: "string",
		searchable: true,
	});
	await registry.createField("post", {
		slug: "body",
		label: "Body",
		type: "text",
		searchable: true,
	});
	await new FTSManager(db).enableSearch("post");
}

describe("search", () => {
	let db: Kysely<Database>;
	let harness: McpHarness;

	beforeEach(async () => {
		db = await setupTestDatabase();
	});

	afterEach(async () => {
		if (harness) await harness.cleanup();
		await teardownTestDatabase(db);
	});

	it("returns empty results when no collections are searchable", async () => {
		const registry = new SchemaRegistry(db);
		await registry.createCollection({ slug: "post", label: "Posts" });

		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });
		const result = await harness.client.callTool({
			name: "search",
			arguments: { query: "anything" },
		});
		expect(result.isError, extractText(result)).toBeFalsy();
		const data = extractJson<{ items: unknown[] }>(result);
		expect(data.items).toEqual([]);
	});

	it("returns empty results for a query with no matches", async () => {
		await setupSearchablePostCollection(db);
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });

		await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "Hello world", body: "Lorem ipsum" } },
		});
		await harness.client.callTool({
			name: "content_publish",
			arguments: { collection: "post", id: "hello-world" },
		});

		const result = await harness.client.callTool({
			name: "search",
			arguments: { query: "ZZZZZQuantumZebra" },
		});
		expect(result.isError, extractText(result)).toBeFalsy();
		const data = extractJson<{ items: unknown[] }>(result);
		expect(data.items).toEqual([]);
	});

	it("returns matching items for a query that hits", async () => {
		await setupSearchablePostCollection(db);
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });

		const created = await harness.client.callTool({
			name: "content_create",
			arguments: {
				collection: "post",
				data: { title: "Hello world", body: "Lorem ipsum about searching" },
			},
		});
		const id = extractJson<{ item: { id: string } }>(created).item.id;
		await harness.client.callTool({
			name: "content_publish",
			arguments: { collection: "post", id },
		});

		const result = await harness.client.callTool({
			name: "search",
			arguments: { query: "Hello" },
		});
		expect(result.isError, extractText(result)).toBeFalsy();
		const data = extractJson<{ items: Array<{ id: string }> }>(result);
		expect(data.items.length).toBeGreaterThan(0);
		expect(data.items.find((i) => i.id === id)).toBeTruthy();
	});

	it("scopes search by collections argument", async () => {
		const registry = new SchemaRegistry(db);
		await registry.createCollection({
			slug: "post",
			label: "Posts",
			supports: ["search"],
		});
		await registry.createField("post", {
			slug: "title",
			label: "Title",
			type: "string",
			searchable: true,
		});
		await registry.createCollection({
			slug: "page",
			label: "Pages",
			supports: ["search"],
		});
		await registry.createField("page", {
			slug: "title",
			label: "Title",
			type: "string",
			searchable: true,
		});
		const fts = new FTSManager(db);
		await fts.enableSearch("post");
		await fts.enableSearch("page");

		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });
		const post = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "rocket post" } },
		});
		const page = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "page", data: { title: "rocket page" } },
		});
		await harness.client.callTool({
			name: "content_publish",
			arguments: {
				collection: "post",
				id: extractJson<{ item: { id: string } }>(post).item.id,
			},
		});
		await harness.client.callTool({
			name: "content_publish",
			arguments: {
				collection: "page",
				id: extractJson<{ item: { id: string } }>(page).item.id,
			},
		});

		const result = await harness.client.callTool({
			name: "search",
			arguments: { query: "rocket", collections: ["post"] },
		});
		const data = extractJson<{ items: Array<{ collection?: string; type?: string }> }>(result);
		expect(data.items.length).toBeGreaterThan(0);
		for (const item of data.items) {
			const c = item.collection ?? item.type;
			expect(c).toBe("post");
		}
	});

	it("handles empty query string gracefully", async () => {
		await setupSearchablePostCollection(db);
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });

		const created = await harness.client.callTool({
			name: "content_create",
			arguments: {
				collection: "post",
				data: { title: "matchable", body: "indexed content" },
			},
		});
		await harness.client.callTool({
			name: "content_publish",
			arguments: {
				collection: "post",
				id: extractJson<{ item: { id: string } }>(created).item.id,
			},
		});

		const result = await harness.client.callTool({
			name: "search",
			arguments: { query: "" },
		});
		expect(result.isError, extractText(result)).toBeFalsy();
		const data = extractJson<{ items: unknown[] }>(result);
		expect(data.items).toEqual([]);
	});

	it("handles special characters in query without leaking FTS5 syntax errors", async () => {
		await setupSearchablePostCollection(db);
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });

		const created = await harness.client.callTool({
			name: "content_create",
			arguments: {
				collection: "post",
				data: { title: "matchable", body: "indexed content" },
			},
		});
		await harness.client.callTool({
			name: "content_publish",
			arguments: {
				collection: "post",
				id: extractJson<{ item: { id: string } }>(created).item.id,
			},
		});

		const result = await harness.client.callTool({
			name: "search",
			arguments: { query: 'NOT "quotes" AND* (' },
		});
		expect(result.isError, extractText(result)).toBeFalsy();
		const data = extractJson<{ items: unknown[] }>(result);
		expect(data.items).toEqual([]);
	});

	it("respects the limit parameter", async () => {
		await setupSearchablePostCollection(db);
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });

		for (let i = 0; i < 10; i++) {
			const c = await harness.client.callTool({
				name: "content_create",
				arguments: {
					collection: "post",
					data: { title: `searchable item ${i}`, body: "common-text" },
				},
			});
			await harness.client.callTool({
				name: "content_publish",
				arguments: {
					collection: "post",
					id: extractJson<{ item: { id: string } }>(c).item.id,
				},
			});
		}

		const result = await harness.client.callTool({
			name: "search",
			arguments: { query: "common-text", limit: 3 },
		});
		const data = extractJson<{ items: unknown[] }>(result);
		expect(data.items.length).toBeLessThanOrEqual(3);
	});

	it("only returns published items (not drafts) regardless of caller role", async () => {
		await setupSearchablePostCollection(db);
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });

		await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "draft-only-content" } },
		});
		const pubItem = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "published-content" } },
		});
		await harness.client.callTool({
			name: "content_publish",
			arguments: {
				collection: "post",
				id: extractJson<{ item: { id: string } }>(pubItem).item.id,
			},
		});

		const draftQuery = await harness.client.callTool({
			name: "search",
			arguments: { query: "draft-only-content" },
		});
		expect(extractJson<{ items: unknown[] }>(draftQuery).items).toEqual([]);

		const pubQuery = await harness.client.callTool({
			name: "search",
			arguments: { query: "published-content" },
		});
		expect(extractJson<{ items: unknown[] }>(pubQuery).items.length).toBeGreaterThan(0);
	});

	it("paginates results via the cursor argument", async () => {
		await setupSearchablePostCollection(db);
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });

		for (let i = 0; i < 5; i++) {
			const c = await harness.client.callTool({
				name: "content_create",
				arguments: {
					collection: "post",
					data: { title: `paginated item ${i}`, body: "common-cursor-text" },
				},
			});
			await harness.client.callTool({
				name: "content_publish",
				arguments: {
					collection: "post",
					id: extractJson<{ item: { id: string } }>(c).item.id,
				},
			});
		}

		const firstPage = await harness.client.callTool({
			name: "search",
			arguments: { query: "common-cursor-text", limit: 2 },
		});
		const firstData = extractJson<{ items: Array<{ id: string }>; nextCursor?: string }>(firstPage);
		expect(firstData.items).toHaveLength(2);
		expect(firstData.nextCursor).toBeTruthy();

		const secondPage = await harness.client.callTool({
			name: "search",
			arguments: { query: "common-cursor-text", limit: 2, cursor: firstData.nextCursor },
		});
		const secondData = extractJson<{ items: Array<{ id: string }> }>(secondPage);
		expect(secondData.items).toHaveLength(2);
		const firstIds = new Set(firstData.items.map((i) => i.id));
		for (const item of secondData.items) {
			expect(firstIds.has(item.id)).toBe(false);
		}
	});

	it("any logged-in user (SUBSCRIBER) can search", async () => {
		await setupSearchablePostCollection(db);
		harness = await connectMcpHarness({ db, userId: SUBSCRIBER_ID, userRole: Role.SUBSCRIBER });
		const result = await harness.client.callTool({
			name: "search",
			arguments: { query: "anything" },
		});
		expect(result.isError, extractText(result)).toBeFalsy();
	});
});
