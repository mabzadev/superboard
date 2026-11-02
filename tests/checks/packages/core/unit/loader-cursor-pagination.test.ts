import type { Kysely } from "kysely";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { handleContentCreate } from "../../../../../packages/core/src/api/index.js";
import { decodeCursor } from "../../../../../packages/core/src/database/repositories/types.js";
import type { Database } from "../../../../../packages/core/src/database/types.js";
import { emdashLoader } from "../../../../../packages/core/src/loader.js";
import { runWithContext } from "../../../../../packages/core/src/request-context.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../utils/test-db.js";

describe("Loader cursor pagination", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabaseWithCollections();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	async function createPublishedPost(title: string) {
		const result = await handleContentCreate(db, "post", {
			data: { title },
			status: "published",
		});
		if (!result.success) throw new Error("Failed to create post");
		return result.data!.item;
	}

	it("should return nextCursor when there are more results", async () => {
		for (let i = 1; i <= 5; i++) {
			await createPublishedPost(`Post ${i}`);
		}

		const loader = emdashLoader();
		const result = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({ filter: { type: "post", limit: 3 } }),
		);

		expect(result.entries).toHaveLength(3);
		expect(result.nextCursor).toBeTruthy();

		const decoded = decodeCursor(result.nextCursor!);
		expect(decoded).not.toBeNull();
		expect(decoded!.orderValue).toBeTruthy();
		expect(decoded!.id).toBeTruthy();
	});

	it("should not return nextCursor when all results fit in one page", async () => {
		await createPublishedPost("Post 1");
		await createPublishedPost("Post 2");

		const loader = emdashLoader();
		const result = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({ filter: { type: "post", limit: 10 } }),
		);

		expect(result.entries).toHaveLength(2);
		expect(result.nextCursor).toBeUndefined();
	});

	it("should not return nextCursor when no limit is set", async () => {
		for (let i = 1; i <= 3; i++) {
			await createPublishedPost(`Post ${i}`);
		}

		const loader = emdashLoader();
		const result = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({ filter: { type: "post" } }),
		);

		expect(result.entries).toHaveLength(3);
		expect(result.nextCursor).toBeUndefined();
	});

	it("should paginate through all results using cursor", async () => {
		for (let i = 1; i <= 5; i++) {
			await createPublishedPost(`Post ${i}`);
		}

		const loader = emdashLoader();

		const page1 = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({ filter: { type: "post", limit: 2 } }),
		);
		expect(page1.entries).toHaveLength(2);
		expect(page1.nextCursor).toBeTruthy();

		const page2 = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({
				filter: { type: "post", limit: 2, cursor: page1.nextCursor },
			}),
		);
		expect(page2.entries).toHaveLength(2);
		expect(page2.nextCursor).toBeTruthy();

		const page3 = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({
				filter: { type: "post", limit: 2, cursor: page2.nextCursor },
			}),
		);
		expect(page3.entries).toHaveLength(1);
		expect(page3.nextCursor).toBeUndefined();

		const allIds = [
			...page1.entries!.map((e) => e.data.id),
			...page2.entries!.map((e) => e.data.id),
			...page3.entries!.map((e) => e.data.id),
		];
		const uniqueIds = new Set(allIds);
		expect(uniqueIds.size).toBe(5);
	});

	it("should maintain sort order across pages", async () => {
		const titles = ["Delta", "Alpha", "Echo", "Bravo", "Charlie"];
		for (const title of titles) {
			await createPublishedPost(title);
		}

		const loader = emdashLoader();

		const allEntries: Array<{ data: Record<string, unknown> }> = [];
		let cursor: string | undefined;

		for (let page = 0; page < 10; page++) {
			const result = await runWithContext({ editMode: false, db }, () =>
				loader.loadCollection!({
					filter: {
						type: "post",
						limit: 2,
						cursor,
						orderBy: { title: "asc" },
					},
				}),
			);
			allEntries.push(...result.entries!);
			cursor = result.nextCursor;
			if (!cursor) break;
		}

		expect(allEntries).toHaveLength(5);
		const sortedTitles = allEntries.map((e) => e.data.title);
		expect(sortedTitles).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
	});

	it("should return empty entries with no nextCursor for empty collection", async () => {
		const loader = emdashLoader();
		const result = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({ filter: { type: "post", limit: 10 } }),
		);

		expect(result.entries).toHaveLength(0);
		expect(result.nextCursor).toBeUndefined();
	});

	it("should reject invalid cursor with a clear error", async () => {
		for (let i = 1; i <= 3; i++) {
			await createPublishedPost(`Post ${i}`);
		}

		const loader = emdashLoader();

		const result = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({
				filter: { type: "post", limit: 10, cursor: "not-a-valid-cursor" },
			}),
		);

		expect((result as { error?: Error }).error?.message).toMatch(/Invalid pagination cursor/);
	});

	it("should work with limit of 1", async () => {
		for (let i = 1; i <= 3; i++) {
			await createPublishedPost(`Post ${i}`);
		}

		const loader = emdashLoader();
		const allEntries: Array<{ data: Record<string, unknown> }> = [];
		let cursor: string | undefined;

		for (let page = 0; page < 10; page++) {
			const result = await runWithContext({ editMode: false, db }, () =>
				loader.loadCollection!({
					filter: { type: "post", limit: 1, cursor },
				}),
			);
			allEntries.push(...result.entries!);
			cursor = result.nextCursor;
			if (!cursor) break;
		}

		expect(allEntries).toHaveLength(3);
		const uniqueIds = new Set(allEntries.map((e) => e.data.id));
		expect(uniqueIds.size).toBe(3);
	});

	it("should include nextCursor in collection-level return alongside cacheHint", async () => {
		for (let i = 1; i <= 3; i++) {
			await createPublishedPost(`Post ${i}`);
		}

		const loader = emdashLoader();
		const result = await runWithContext({ editMode: false, db }, () =>
			loader.loadCollection!({ filter: { type: "post", limit: 2 } }),
		);

		expect(result.cacheHint).toBeDefined();
		expect(result.cacheHint!.tags).toEqual(["post"]);
		expect(result.nextCursor).toBeTruthy();
	});
});
