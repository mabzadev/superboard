import { randomUUID } from "node:crypto";

import { SqliteDialect } from "kysely";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { mapErrorStatus } from "../../../../../../packages/core/src/api/errors.js";
import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import { NodeSqliteCompatDatabase as Database } from "../../../../../../packages/core/src/db/node-sqlite-compat.js";
import { EmDashRuntime } from "../../../../../../packages/core/src/emdash-runtime.js";
import type { RuntimeDependencies } from "../../../../../../packages/core/src/emdash-runtime.js";
import { definePlugin } from "../../../../../../packages/core/src/plugins/define-plugin.js";
import { ContentSaveRejectedError } from "../../../../../../packages/core/src/plugins/save-rejection.js";
import type { ContentBeforeSaveHandler } from "../../../../../../packages/core/src/plugins/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";

function createDeps(sqlite: Database, handler: ContentBeforeSaveHandler): RuntimeDependencies {
	return {
		config: {
			database: {
				entrypoint: `test-before-save-rejection-${randomUUID()}`,
				config: {},
				type: "sqlite",
			},
		},
		plugins: [
			definePlugin({
				id: "editorial-gate",
				version: "1.0.0",
				capabilities: ["content:read", "content:write"],
				hooks: {
					"content:beforeSave": { handler },
				},
			}),
		],
		createDialect: () => new SqliteDialect({ database: sqlite }),
		createStorage: null,
		sandboxEnabled: false,
		sandboxedPluginEntries: [],
		createSandboxRunner: null,
	};
}

describe("content:beforeSave cancellation", () => {
	let runtime: EmDashRuntime;
	let repo: ContentRepository;

	async function boot(handler: ContentBeforeSaveHandler) {
		const sqlite = new Database(":memory:");
		runtime = await EmDashRuntime.create(createDeps(sqlite, handler));
		const registry = new SchemaRegistry(runtime.db);
		await registry.createCollection({ slug: "post", label: "Posts", labelSingular: "Post" });
		await registry.createField("post", { slug: "title", label: "Title", type: "string" });
		repo = new ContentRepository(runtime.db);
	}

	afterEach(async () => {
		await runtime?.stopCron();
	});

	describe("ContentSaveRejectedError", () => {
		beforeEach(() =>
			boot(async () => {
				throw new ContentSaveRejectedError("Posts need a summary");
			}),
		);

		it("returns SAVE_REJECTED with the plugin message on create", async () => {
			const result = await runtime.handleContentCreate("post", { data: { title: "Hi" } });

			expect(result).toEqual({
				success: false,
				error: { code: "SAVE_REJECTED", message: "Posts need a summary" },
			});
			if (result.success) return;
			expect(mapErrorStatus(result.error.code)).toBe(422);
			const rows = await repo.findMany("post");
			expect(rows.items).toHaveLength(0);
		});

		it("returns SAVE_REJECTED with the plugin message on update", async () => {
			const item = await repo.create({ type: "post", data: { title: "Original" } });

			const result = await runtime.handleContentUpdate("post", item.id, {
				data: { title: "Changed" },
			});

			expect(result).toEqual({
				success: false,
				error: { code: "SAVE_REJECTED", message: "Posts need a summary" },
			});
			if (result.success) return;
			expect(mapErrorStatus(result.error.code)).toBe(422);
			const kept = await repo.findById("post", item.id);
			expect(kept?.data.title).toBe("Original");
		});
	});

	describe("unexpected hook exception", () => {
		beforeEach(() =>
			boot(async () => {
				throw new Error("secret internal detail");
			}),
		);

		it("returns a generic error that hides the exception message on create", async () => {
			const result = await runtime.handleContentCreate("post", { data: { title: "Hi" } });

			expect(result.success).toBe(false);
			if (result.success) return;
			expect(result.error.code).toBe("CONTENT_HOOK_ERROR");
			expect(result.error.message).not.toContain("secret internal detail");
		});

		it("returns a generic error that hides the exception message on update", async () => {
			const item = await repo.create({ type: "post", data: { title: "Original" } });

			const result = await runtime.handleContentUpdate("post", item.id, {
				data: { title: "Changed" },
			});

			expect(result.success).toBe(false);
			if (result.success) return;
			expect(result.error.code).toBe("CONTENT_HOOK_ERROR");
			expect(result.error.message).not.toContain("secret internal detail");
			const kept = await repo.findById("post", item.id);
			expect(kept?.data.title).toBe("Original");
		});
	});

	describe("hook that does not throw", () => {
		beforeEach(() =>
			boot(async (event) => {
				return { ...event.content, title: `${event.content.title as string}!` };
			}),
		);

		it("still applies the hook's content changes", async () => {
			const result = await runtime.handleContentCreate("post", { data: { title: "Hi" } });

			expect(result.success).toBe(true);
			if (!result.success) return;
			expect(result.data.item.data.title).toBe("Hi!");
		});
	});
});
