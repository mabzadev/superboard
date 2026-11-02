import { Role } from "@emdash-cms/auth";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import {
	connectMcpHarness,
	extractJson,
	extractText,
	type McpHarness,
} from "../../utils/mcp-runtime.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

const ADMIN_ID = "user_admin";

const INVALID_CURSOR = /cursor|invalid|malformed/i;

async function seedPosts(db: Kysely<Database>, count: number, prefix = "post"): Promise<string[]> {
	const repo = new ContentRepository(db);
	const ids: string[] = [];
	for (let i = 0; i < count; i++) {
		const item = await repo.create({
			type: "post",
			data: { title: `${prefix} ${i}` },
			slug: `${prefix}-${i}`,
			status: "draft",
			authorId: ADMIN_ID,
		});
		ids.push(item.id);
	}
	return ids;
}

describe("MCP cursor pagination — content_list (bug #12)", () => {
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

	it("rejects garbage cursor with a structured error (does NOT silently return first page)", async () => {
		await seedPosts(db, 5);

		const result = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", cursor: "obviously-malformed-cursor" },
		});

		expect(result.isError).toBe(true);
		expect(extractText(result)).toMatch(INVALID_CURSOR);
	});

	it("rejects empty-string cursor with a structured error", async () => {
		await seedPosts(db, 5);

		const result = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", cursor: "" },
		});

		expect(result.isError).toBe(true);
	});

	it("rejects base64-decodable but structurally-wrong cursor", async () => {
		await seedPosts(db, 5);

		const bogus = Buffer.from(JSON.stringify({ wrong: "shape" })).toString("base64");

		const result = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", cursor: bogus },
		});

		expect(result.isError).toBe(true);
		expect(extractText(result)).toMatch(INVALID_CURSOR);
	});

	it("rejects cursor with non-string id field", async () => {
		await seedPosts(db, 5);

		const bogus = Buffer.from(JSON.stringify({ orderValue: "x", id: 42 })).toString("base64");

		const result = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", cursor: bogus },
		});

		expect(result.isError).toBe(true);
	});

	it("valid cursor returns the correct next page (regression guard)", async () => {
		await seedPosts(db, 5);

		const first = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", limit: 2 },
		});
		const firstData = extractJson<{
			items: Array<{ id: string }>;
			nextCursor?: string;
		}>(first);
		expect(firstData.items).toHaveLength(2);
		expect(firstData.nextCursor).toBeTruthy();

		const second = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", limit: 2, cursor: firstData.nextCursor },
		});
		const secondData = extractJson<{
			items: Array<{ id: string }>;
		}>(second);
		expect(secondData.items).toHaveLength(2);
		const firstIds = firstData.items.map((i) => i.id);
		const secondIds = secondData.items.map((i) => i.id);
		for (const id of secondIds) {
			expect(firstIds).not.toContain(id);
		}
	});

	it("rejects oversized cursor without attempting to decode it (DoS guard)", async () => {
		await seedPosts(db, 3);

		const huge = "A".repeat(10_000);

		const result = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", cursor: huge },
		});

		expect(result.isError).toBe(true);
	});

	it("malformed cursor on second page does not skip back to start", async () => {
		await seedPosts(db, 5);

		const first = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", limit: 2 },
		});
		const firstData = extractJson<{ items: Array<{ id: string }>; nextCursor?: string }>(first);

		const tampered = firstData.nextCursor ? firstData.nextCursor.slice(0, -1) + "X" : "garbage";

		const result = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", limit: 2, cursor: tampered },
		});

		expect(result.isError).toBe(true);
	});
});

describe("MCP cursor pagination — other list tools (bug #12 propagation)", () => {
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

	it("content_list_trashed rejects malformed cursor", async () => {
		const ids = await seedPosts(db, 3);
		const repo = new ContentRepository(db);
		for (const id of ids) await repo.delete("post", id);

		const result = await harness.client.callTool({
			name: "content_list_trashed",
			arguments: { collection: "post", cursor: "garbage" },
		});
		expect(result.isError).toBe(true);
	});

	it("media_list rejects malformed cursor", async () => {
		const result = await harness.client.callTool({
			name: "media_list",
			arguments: { cursor: "garbage" },
		});
		expect(result.isError).toBe(true);
	});
});

describe("MCP cursor pagination — limit clamping (regression guard)", () => {
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

	it("limit beyond max is clamped, not rejected", async () => {
		await seedPosts(db, 3);

		const result = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post", limit: 1000 },
		});
		if (result.isError) {
			expect(extractText(result)).toMatch(/limit|max|exceed|invalid/i);
		} else {
			const data = extractJson<{ items: unknown[] }>(result);
			expect(data.items.length).toBeLessThanOrEqual(100);
		}
	});
});
