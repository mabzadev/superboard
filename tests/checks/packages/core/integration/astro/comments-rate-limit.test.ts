import type { APIContext } from "astro";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as postComment } from "../../../../../../packages/core/src/astro/routes/api/comments/[collection]/[contentId]/index.js";
import { _resetTrustedProxyHeadersCache } from "../../../../../../packages/core/src/auth/trusted-proxy.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

const ORIGINAL_TRUSTED_ENV = process.env.EMDASH_TRUSTED_PROXY_HEADERS;

function buildRequest(opts: { userAgent?: string; body: unknown }): Request {
	return new Request("http://localhost/_emdash/api/comments/post/post-1", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(opts.userAgent ? { "user-agent": opts.userAgent } : {}),
		},
		body: JSON.stringify(opts.body),
	});
}

function buildContext(opts: { db: Kysely<Database>; request: Request }): APIContext {
	return {
		params: { collection: "post", contentId: "post-1" },
		request: opts.request,
		locals: {
			emdash: {
				db: opts.db,
				config: {},
				hooks: {
					runCommentBeforeCreate: async (event: unknown) => event,
					invokeExclusiveHook: async () => null,
					runCommentAfterCreate: async () => undefined,
				},
			},
			user: null,
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- minimal stub for tests
	} as unknown as APIContext;
}

describe("POST /comments — UA-hash rate-limit removal", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		delete process.env.EMDASH_TRUSTED_PROXY_HEADERS;
		_resetTrustedProxyHeadersCache();
		db = await setupTestDatabase();
		const registry = new SchemaRegistry(db);
		await registry.createCollection({
			slug: "post",
			label: "Posts",
			labelSingular: "Post",
			commentsEnabled: true,
		});
		await registry.createField("post", { slug: "title", label: "Title", type: "string" });
		await db
			.insertInto("ec_post" as never)
			.values({
				id: "post-1",
				slug: "post-1",
				status: "published",
				published_at: new Date().toISOString(),
				title: "Test post",
			} as never)
			.execute();
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
		if (ORIGINAL_TRUSTED_ENV === undefined) {
			delete process.env.EMDASH_TRUSTED_PROXY_HEADERS;
		} else {
			process.env.EMDASH_TRUSTED_PROXY_HEADERS = ORIGINAL_TRUSTED_ENV;
		}
		_resetTrustedProxyHeadersCache();
	});

	it("buckets no-trusted-IP requests together regardless of User-Agent", async () => {
		for (let i = 0; i < 20; i++) {
			const res = await postComment(
				buildContext({
					db,
					request: buildRequest({
						userAgent: `Bot/${i}`,
						body: {
							authorName: "Spam",
							authorEmail: "s@example.com",
							body: `message ${i}`,
						},
					}),
				}),
			);
			expect([200, 201]).toContain(res.status);
		}

		const limitedRes = await postComment(
			buildContext({
				db,
				request: buildRequest({
					userAgent: "Bot/fresh",
					body: {
						authorName: "Spam",
						authorEmail: "s@example.com",
						body: "one more",
					},
				}),
			}),
		);
		expect(limitedRes.status).toBe(429);
	});
});
