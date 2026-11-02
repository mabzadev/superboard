import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { SqliteDialect } from "kysely";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => void | Promise<void>> }));
vi.mock("../../../../../../packages/core/src/after.js", () => ({
	after: (fn: () => void | Promise<void>) => {
		deferred.push(fn);
	},
}));

import { ContentRepository } from "../../../../../../packages/core/src/database/repositories/content.js";
import { EmDashRuntime } from "../../../../../../packages/core/src/emdash-runtime.js";
import type { RuntimeDependencies } from "../../../../../../packages/core/src/emdash-runtime.js";
import { definePlugin } from "../../../../../../packages/core/src/plugins/define-plugin.js";
import type {
	ContentAfterDeleteHandler,
	ContentAfterUnpublishHandler,
} from "../../../../../../packages/core/src/plugins/types.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";

const afterDeleteHandler = vi.fn<ContentAfterDeleteHandler>(async () => {});
const afterUnpublishHandler = vi.fn<ContentAfterUnpublishHandler>(async () => {});

function createDeps(sqlite: Database.Database): RuntimeDependencies {
	return {
		config: {
			database: {
				entrypoint: `test-after-hooks-${randomUUID()}`,
				config: {},
				type: "sqlite",
			},
		},
		plugins: [
			definePlugin({
				id: "lifecycle-watcher",
				version: "1.0.0",
				capabilities: ["content:read"],
				hooks: {
					"content:afterDelete": { handler: afterDeleteHandler },
					"content:afterUnpublish": { handler: afterUnpublishHandler },
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

const drainMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

async function flushDeferred(): Promise<void> {
	const tasks = deferred.splice(0);
	for (const task of tasks) await task();
}

describe("runtime defers lifecycle hooks through after()", () => {
	let runtime: EmDashRuntime;
	let repo: ContentRepository;

	beforeEach(async () => {
		deferred.length = 0;
		afterDeleteHandler.mockClear();
		afterUnpublishHandler.mockClear();

		const sqlite = new Database(":memory:");
		runtime = await EmDashRuntime.create(createDeps(sqlite));

		const registry = new SchemaRegistry(runtime.db);
		await registry.createCollection({ slug: "post", label: "Posts", labelSingular: "Post" });
		await registry.createField("post", { slug: "title", label: "Title", type: "string" });

		repo = new ContentRepository(runtime.db);

		deferred.length = 0;
	});

	afterEach(async () => {
		await runtime.stopCron();
	});

	it("schedules the afterDelete hook via after() on soft delete", async () => {
		const item = await repo.create({ type: "post", data: { title: "Doomed" } });

		deferred.length = 0;
		const result = await runtime.handleContentDelete("post", item.id);
		expect(result.success).toBe(true);

		await drainMicrotasks();
		expect(afterDeleteHandler).not.toHaveBeenCalled();
		expect(deferred.length).toBeGreaterThan(0);

		await flushDeferred();
		expect(afterDeleteHandler).toHaveBeenCalledTimes(1);
	});

	it("schedules the afterUnpublish hook via after() on unpublish", async () => {
		const item = await repo.create({
			type: "post",
			slug: "live-then-gone",
			data: { title: "Live then gone" },
		});
		const published = await runtime.handleContentPublish("post", item.id);
		expect(published.success).toBe(true);

		deferred.length = 0;
		afterUnpublishHandler.mockClear();

		const result = await runtime.handleContentUnpublish("post", item.id);
		expect(result.success).toBe(true);

		await drainMicrotasks();
		expect(afterUnpublishHandler).not.toHaveBeenCalled();
		expect(deferred.length).toBeGreaterThan(0);

		await flushDeferred();
		expect(afterUnpublishHandler).toHaveBeenCalledTimes(1);
	});
});
