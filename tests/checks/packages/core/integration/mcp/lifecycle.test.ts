import { Role } from "@emdash-cms/auth";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../../../../../../packages/core/src/database/types.js";
import {
	connectMcpHarness,
	extractJson,
	extractText,
	type McpHarness,
} from "../../utils/mcp-runtime.js";
import {
	setupTestDatabaseWithCollections,
	teardownTestDatabase,
	setupTestDatabase,
} from "../../utils/test-db.js";

const ADMIN_ID = "user_admin";

describe("MCP content_unpublish — publishedAt clearing (bug #10)", () => {
	let db: Kysely<Database>;
	let harness: McpHarness;

	beforeEach(async () => {
		db = await setupTestDatabaseWithCollections();
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });
	});

	afterEach(async () => {
		if (harness) await harness.cleanup();
		await teardownTestDatabase(db);
	});

	it("unpublish clears publishedAt so 'currently live' is unambiguous", async () => {
		const created = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "Will publish" } },
		});
		const id = extractJson<{ item: { id: string } }>(created).item.id;

		const published = await harness.client.callTool({
			name: "content_publish",
			arguments: { collection: "post", id },
		});
		const publishedItem = extractJson<{ item: { publishedAt: string | null } }>(published);
		expect(publishedItem.item.publishedAt).toBeTruthy();

		const unpublished = await harness.client.callTool({
			name: "content_unpublish",
			arguments: { collection: "post", id },
		});
		const unpubItem = extractJson<{
			item: { publishedAt: string | null; status: string };
		}>(unpublished);

		expect(unpubItem.item.status).toBe("draft");
		expect(unpubItem.item.publishedAt).toBeNull();
	});

	it("content_get after unpublish reflects null publishedAt and status=draft", async () => {
		const created = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "T" } },
		});
		const id = extractJson<{ item: { id: string } }>(created).item.id;
		await harness.client.callTool({
			name: "content_publish",
			arguments: { collection: "post", id },
		});
		await harness.client.callTool({
			name: "content_unpublish",
			arguments: { collection: "post", id },
		});

		const got = await harness.client.callTool({
			name: "content_get",
			arguments: { collection: "post", id },
		});
		const gotItem = extractJson<{
			item: { publishedAt: string | null; status: string };
		}>(got);
		expect(gotItem.item.status).toBe("draft");
		expect(gotItem.item.publishedAt).toBeNull();
	});

	it("re-publish after unpublish gets a fresh publishedAt timestamp", async () => {
		const created = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "T" } },
		});
		const id = extractJson<{ item: { id: string } }>(created).item.id;

		const firstPub = await harness.client.callTool({
			name: "content_publish",
			arguments: { collection: "post", id },
		});
		const firstTs = extractJson<{ item: { publishedAt: string } }>(firstPub).item.publishedAt;
		expect(firstTs).toBeTruthy();

		await harness.client.callTool({
			name: "content_unpublish",
			arguments: { collection: "post", id },
		});

		await new Promise((r) => setTimeout(r, 5));

		const secondPub = await harness.client.callTool({
			name: "content_publish",
			arguments: { collection: "post", id },
		});
		const secondTs = extractJson<{ item: { publishedAt: string } }>(secondPub).item.publishedAt;
		expect(secondTs).toBeTruthy();
		expect(secondTs).not.toBe(firstTs);
	});
});

describe("MCP schema_create_collection — supports default (bug #11)", () => {
	let db: Kysely<Database>;
	let harness: McpHarness;

	beforeEach(async () => {
		db = await setupTestDatabase();
		harness = await connectMcpHarness({ db, userId: ADMIN_ID, userRole: Role.ADMIN });
	});

	afterEach(async () => {
		if (harness) await harness.cleanup();
		await teardownTestDatabase(db);
	});

	it("creating a collection without `supports` uses documented default ['drafts', 'revisions']", async () => {
		const result = await harness.client.callTool({
			name: "schema_create_collection",
			arguments: { slug: "article", label: "Articles" },
		});
		expect(result.isError, extractText(result)).toBeFalsy();
		const created = extractJson<{ supports: string[] }>(result);

		expect(created.supports).toEqual(expect.arrayContaining(["drafts", "revisions"]));
	});

	it("explicit empty supports array is preserved (regression guard — opt-out)", async () => {
		const result = await harness.client.callTool({
			name: "schema_create_collection",
			arguments: { slug: "minimal", label: "Minimal", supports: [] },
		});
		expect(result.isError, extractText(result)).toBeFalsy();
		const created = extractJson<{ supports: string[] }>(result);
		expect(created.supports).toEqual([]);
	});

	it("explicit supports list is preserved exactly (regression guard)", async () => {
		const result = await harness.client.callTool({
			name: "schema_create_collection",
			arguments: {
				slug: "blog",
				label: "Blog",
				supports: ["drafts", "revisions", "scheduling"],
			},
		});
		expect(result.isError, extractText(result)).toBeFalsy();
		const created = extractJson<{ supports: string[] }>(result);
		expect(created.supports.toSorted()).toEqual(["drafts", "revisions", "scheduling"].toSorted());
	});

	it("default-supports collection accepts publish/unpublish/revision flows immediately", async () => {
		await harness.client.callTool({
			name: "schema_create_collection",
			arguments: { slug: "story", label: "Stories" },
		});
		await harness.client.callTool({
			name: "schema_create_field",
			arguments: { collection: "story", slug: "title", label: "Title", type: "string" },
		});

		const created = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "story", data: { title: "T" } },
		});
		expect(created.isError, extractText(created)).toBeFalsy();
		const id = extractJson<{ item: { id: string } }>(created).item.id;

		await harness.client.callTool({
			name: "content_update",
			arguments: { collection: "story", id, data: { title: "Updated" } },
		});

		const revs = await harness.client.callTool({
			name: "revision_list",
			arguments: { collection: "story", id },
		});
		expect(revs.isError, extractText(revs)).toBeFalsy();
		const items = extractJson<{ items: unknown[] }>(revs).items;
		expect(items.length).toBeGreaterThan(0);
	});
});
