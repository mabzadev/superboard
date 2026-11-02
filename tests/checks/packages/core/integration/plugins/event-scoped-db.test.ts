import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { runMigrations } from "../../../../../../packages/core/src/database/migrations/runner.js";
import { MediaRepository } from "../../../../../../packages/core/src/database/repositories/media.js";
import type { Database as DbSchema } from "../../../../../../packages/core/src/database/types.js";
import {
	EmDashRuntime,
	type RuntimeDependencies,
} from "../../../../../../packages/core/src/emdash-runtime.js";
import { createMediaProvider } from "../../../../../../packages/core/src/media/local-runtime.js";
import { PluginContextFactory } from "../../../../../../packages/core/src/plugins/context.js";
import { CronExecutor } from "../../../../../../packages/core/src/plugins/cron.js";
import { createHookPipeline } from "../../../../../../packages/core/src/plugins/hooks.js";
import type {
	CronHandler,
	ResolvedHook,
	ResolvedPlugin,
} from "../../../../../../packages/core/src/plugins/types.js";
import { runWithContext } from "../../../../../../packages/core/src/request-context.js";
import { SchemaRegistry } from "../../../../../../packages/core/src/schema/registry.js";

function createTestPlugin(overrides: Partial<ResolvedPlugin> = {}): ResolvedPlugin {
	return {
		id: "test-plugin",
		version: "1.0.0",
		capabilities: [],
		allowedHosts: [],
		storage: {},
		admin: { pages: [], widgets: [], fieldWidgets: {} },
		hooks: {},
		routes: {},
		settings: undefined,
		...overrides,
	};
}

function cronMarkerPlugin(id: string): ResolvedPlugin {
	const cron: ResolvedHook<CronHandler> = {
		priority: 0,
		timeout: 5_000,
		dependencies: [],
		errorPolicy: "continue",
		exclusive: false,
		pluginId: id,
		handler: async (_event, ctx) => {
			await ctx.kv.set("ran", "yes");
		},
	};
	return createTestPlugin({ id, hooks: { cron } });
}

async function optionValue(db: Kysely<DbSchema>, name: string): Promise<string | undefined> {
	const row = await db
		.selectFrom("options")
		.select("value")
		.where("name", "=", name)
		.executeTakeFirst();
	return row?.value;
}

async function makeDb(): Promise<Kysely<DbSchema>> {
	const db = new Kysely<DbSchema>({
		dialect: new SqliteDialect({ database: new Database(":memory:") }),
	});
	await runMigrations(db);
	return db;
}

async function seedDueOneshot(db: Kysely<DbSchema>, pluginId: string, taskName: string) {
	const past = new Date(Date.now() - 60_000).toISOString();
	await db
		.insertInto("_emdash_cron_tasks" as never)
		.values({
			id: `task_${taskName}`,
			plugin_id: pluginId,
			task_name: taskName,
			schedule: past,
			is_oneshot: 1,
			data: null,
			status: "idle",
			enabled: 1,
			next_run_at: past,
			locked_at: null,
			last_run_at: null,
			created_at: past,
		} as never)
		.execute();
}

describe("event-scoped DB resolution (#1622)", () => {
	let dbA: Kysely<DbSchema>;
	let dbB: Kysely<DbSchema>;

	beforeEach(async () => {
		dbA = await makeDb();
		dbB = await makeDb();
	});

	afterEach(async () => {
		await dbA.destroy();
		await dbB.destroy();
	});

	describe("PluginContextFactory", () => {
		it("resolves the connection per createContext() via getDb", async () => {
			let current = dbA;
			const getDb = vi.fn(() => current);
			const factory = new PluginContextFactory({ db: dbA, getDb });
			const plugin = createTestPlugin({ id: "kv-plugin" });

			current = dbB;
			const ctxWrite = factory.createContext(plugin);
			await ctxWrite.kv.set("color", "blue");

			current = dbA;
			const ctxA = factory.createContext(plugin);
			expect(await ctxA.kv.get("color")).toBeNull();

			current = dbB;
			const ctxB = factory.createContext(plugin);
			expect(await ctxB.kv.get("color")).toBe("blue");

			expect(getDb).toHaveBeenCalledTimes(3);
		});

		it("falls back to the fixed db when getDb is omitted (stateless adapters)", async () => {
			const factory = new PluginContextFactory({ db: dbA });
			const plugin = createTestPlugin({ id: "kv-plugin" });

			const ctx = factory.createContext(plugin);
			await ctx.kv.set("k", "v");

			const repoOptions = await dbA
				.selectFrom("options")
				.select("value")
				.where("name", "=", "plugin:kv-plugin:k")
				.executeTakeFirst();
			expect(repoOptions?.value).toBe(JSON.stringify("v"));
		});
	});

	describe("CronExecutor", () => {
		it("resolves the connection at tick time, not construction", async () => {
			let current = dbA;
			const getDb = vi.fn(() => current);
			const invoked: string[] = [];
			const executor = new CronExecutor(getDb, async (pluginId) => {
				invoked.push(pluginId);
			});

			await seedDueOneshot(dbB, "cron-plugin", "sweep");

			current = dbA;
			expect(await executor.tick()).toBe(0);
			expect(invoked).toEqual([]);

			current = dbB;
			expect(await executor.tick()).toBe(1);
			expect(invoked).toEqual(["cron-plugin"]);

			const remaining = await dbB
				.selectFrom("_emdash_cron_tasks" as never)
				.selectAll()
				.execute();
			expect(remaining).toHaveLength(0);
			expect(getDb).toHaveBeenCalled();
		});

		it("accepts a plain Kysely for callers that don't need ALS", async () => {
			await seedDueOneshot(dbA, "cron-plugin", "sweep");
			const executor = new CronExecutor(dbA, async () => {});
			expect(await executor.tick()).toBe(1);
		});
	});

	describe("hook pipeline rebuild (#1622 regression)", () => {
		it("resolves via getDb when the pipeline is built from factory options", async () => {
			let current = dbA;
			const pipeline = createHookPipeline([cronMarkerPlugin("cron-hook")], {
				db: dbA,
				getDb: () => current,
			});

			current = dbB;
			const res = await pipeline.invokeCronHook("cron-hook", { name: "t" });
			expect(res.success).toBe(true);

			expect(await optionValue(dbB, "plugin:cron-hook:ran")).toBe(JSON.stringify("yes"));
			expect(await optionValue(dbA, "plugin:cron-hook:ran")).toBeUndefined();
		});

		it("keeps getDb across a setContextFactory merge (cron/email wiring)", async () => {
			let current = dbA;
			const pipeline = createHookPipeline([cronMarkerPlugin("cron-hook")], {
				db: dbA,
				getDb: () => current,
			});
			pipeline.setContextFactory({ cronReschedule: () => {} });

			current = dbB;
			await pipeline.invokeCronHook("cron-hook", { name: "t" });
			expect(await optionValue(dbB, "plugin:cron-hook:ran")).toBe(JSON.stringify("yes"));
		});
	});

	describe("local media provider", () => {
		it("resolves the connection per operation via getDb", async () => {
			let current = dbA;
			const getDb = vi.fn(() => current);
			const provider = createMediaProvider({ db: dbA, getDb });

			await new MediaRepository(dbB).create({
				filename: "photo.jpg",
				mimeType: "image/jpeg",
				storageKey: "media/photo.jpg",
			});

			current = dbA;
			expect((await provider.list({})).items).toHaveLength(0);

			current = dbB;
			const listed = await provider.list({});
			expect(listed.items).toHaveLength(1);
			expect(listed.items[0]!.filename).toBe("photo.jpg");

			expect(getDb).toHaveBeenCalled();
		});
	});

	describe("runtime schemaRegistry (#1622 regression)", () => {
		function createDeps(): RuntimeDependencies {
			return {
				config: {
					database: {
						entrypoint: `test-schema-registry-${randomUUID()}`,
						config: {},
						type: "sqlite",
					},
				},
				plugins: [],
				createDialect: () => new SqliteDialect({ database: new Database(":memory:") }),
				createStorage: null,
				sandboxEnabled: false,
				sandboxedPluginEntries: [],
				createSandboxRunner: null,
			};
		}

		it("resolves against the event-scoped db, not the captured singleton", async () => {
			const runtime = await EmDashRuntime.create(createDeps());
			try {
				const scopedDb = new Kysely<DbSchema>({
					dialect: new SqliteDialect({ database: new Database(":memory:") }),
				});
				await runMigrations(scopedDb);
				await new SchemaRegistry(scopedDb).createCollection({
					slug: "widgets",
					label: "Widgets",
					supports: ["drafts", "revisions"],
				});

				try {
					expect(await runtime.schemaRegistry.getCollectionWithFields("widgets")).toBeNull();

					const found = await runWithContext({ editMode: false, db: scopedDb }, () =>
						runtime.schemaRegistry.getCollectionWithFields("widgets"),
					);
					expect(found?.slug).toBe("widgets");
					expect(found?.supports).toContain("revisions");
				} finally {
					await scopedDb.destroy();
				}
			} finally {
				await runtime.stopCron();
			}
		});
	});
});
