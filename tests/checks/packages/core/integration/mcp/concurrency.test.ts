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
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../utils/test-db.js";

const ADMIN_ID = "user_admin";

describe("MCP concurrency — in-memory transport (bug #8 partial)", () => {
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

	it("14 parallel read calls all succeed (no spurious failures)", async () => {
		const callPromises = Array.from({ length: 14 }, (_, i) => {
			void i;
			return harness.client.callTool({ name: "schema_list_collections", arguments: {} });
		});

		const results = await Promise.all(callPromises);
		for (const result of results) {
			expect(result.isError, extractText(result)).toBeFalsy();
		}
	});

	it("mixed read/write calls in parallel maintain correctness", async () => {
		const initial = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post" },
		});
		const initialCount = extractJson<{ items: unknown[] }>(initial).items.length;

		const work = [
			...Array.from({ length: 5 }, (_, i) =>
				harness.client.callTool({
					name: "content_create",
					arguments: { collection: "post", data: { title: `parallel ${i}` } },
				}),
			),
			...Array.from({ length: 5 }, (_, i) => {
				void i;
				return harness.client.callTool({
					name: "content_list",
					arguments: { collection: "post" },
				});
			}),
		];

		const results = await Promise.all(work);

		const createsSuccessful = results
			.slice(0, 5)
			.filter((r) => !(r as { isError?: boolean }).isError).length;
		expect(createsSuccessful).toBe(5);

		const final = await harness.client.callTool({
			name: "content_list",
			arguments: { collection: "post" },
		});
		const finalCount = extractJson<{ items: unknown[] }>(final).items.length;
		expect(finalCount).toBe(initialCount + 5);
	});

	it("parallel updates to the same item don't corrupt state", async () => {
		const created = await harness.client.callTool({
			name: "content_create",
			arguments: { collection: "post", data: { title: "Original" } },
		});
		const id = extractJson<{ item: { id: string } }>(created).item.id;

		const work = Array.from({ length: 10 }, (_, i) =>
			harness.client.callTool({
				name: "content_update",
				arguments: { collection: "post", id, data: { title: `update ${i}` } },
			}),
		);

		const results = await Promise.all(work);
		for (const result of results) {
			expect(result.isError, extractText(result)).toBeFalsy();
		}

		const got = await harness.client.callTool({
			name: "content_get",
			arguments: { collection: "post", id },
		});
		const item = extractJson<{ item: { title?: unknown; data?: { title?: unknown } } }>(got).item;
		const title = item.data?.title ?? item.title;
		expect(typeof title).toBe("string");
		expect(title).toMatch(/^(Original|update \d)$/);
	});

	it("parallel calls don't leak data across users", async () => {
		const userTwo = await connectMcpHarness({
			db,
			userId: "user_contrib",
			userRole: Role.CONTRIBUTOR,
		});

		try {
			const created = await harness.client.callTool({
				name: "content_create",
				arguments: { collection: "post", data: { title: "by admin" } },
			});
			expect(created.isError, extractText(created)).toBeFalsy();
			const id = extractJson<{ item: { id: string } }>(created).item.id;

			const adminWork = Array.from({ length: 5 }, (_, i) =>
				harness.client.callTool({
					name: "content_update",
					arguments: { collection: "post", id, data: { title: `admin ${i}` } },
				}),
			);
			const contribWork = Array.from({ length: 5 }, (_, i) =>
				userTwo.client.callTool({
					name: "content_update",
					arguments: { collection: "post", id, data: { title: `contrib ${i}` } },
				}),
			);

			const [adminResults, contribResults] = await Promise.all([
				Promise.all(adminWork),
				Promise.all(contribWork),
			]);

			for (const r of adminResults) {
				expect(r.isError, extractText(r)).toBeFalsy();
			}
			for (const r of contribResults) {
				expect(r.isError).toBe(true);
			}
		} finally {
			await userTwo.cleanup();
		}
	});
});
