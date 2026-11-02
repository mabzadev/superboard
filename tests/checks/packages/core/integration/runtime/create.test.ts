import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { Kysely, sql, SqliteDialect } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_COMMENT_MODERATOR_PLUGIN_ID } from "../../../../../../packages/core/src/comments/moderator.js";
import { PendingMigrationsError } from "../../../../../../packages/core/src/database/migrations/policy.js";
import { runMigrations } from "../../../../../../packages/core/src/database/migrations/runner.js";
import { OptionsRepository } from "../../../../../../packages/core/src/database/repositories/options.js";
import type { Database as EmDashDatabase } from "../../../../../../packages/core/src/database/types.js";
import { EmDashRuntime } from "../../../../../../packages/core/src/emdash-runtime.js";
import type { RuntimeDependencies } from "../../../../../../packages/core/src/emdash-runtime.js";
import { getI18nConfig, setI18nConfig } from "../../../../../../packages/core/src/i18n/config.js";
import { definePlugin } from "../../../../../../packages/core/src/plugins/define-plugin.js";
import type { ContentBeforeSaveHandler } from "../../../../../../packages/core/src/plugins/types.js";
import { runWithContext } from "../../../../../../packages/core/src/request-context.js";

function createDeps(): RuntimeDependencies {
	return {
		config: {
			database: {
				entrypoint: `test-runtime-create-${randomUUID()}`,
				config: {},
				type: "sqlite",
			},
		},
		plugins: [
			definePlugin({
				id: "test-exclusive-provider",
				version: "1.0.0",
				capabilities: ["content:write", "content:read"],
				hooks: {
					"content:beforeSave": {
						exclusive: true,
						handler: vi.fn() as unknown as ContentBeforeSaveHandler,
					},
				},
			}),
		],
		createDialect: () => new SqliteDialect({ database: new Database(":memory:") }),
		createStorage: null,
		sandboxEnabled: false,
		sandboxedPluginEntries: [],
		createSandboxRunner: null,
	};
}

describe("EmDashRuntime.create — cold boot", () => {
	it("initializes end-to-end and records each phase's own timing", async () => {
		const timings: Array<{ name: string; dur: number; desc?: string }> = [];
		const runtime = await EmDashRuntime.create(createDeps(), timings);

		try {
			const names = timings.map((t) => t.name);
			for (const expected of [
				"rt.db",
				"rt.seedcheck",
				"rt.plugins",
				"rt.site",
				"rt.sandbox",
				"rt.hooks",
				"rt.cron",
			]) {
				expect(names.filter((n) => n === expected)).toHaveLength(1);
			}
			expect(names).not.toContain("rt.market");
			expect(names).not.toContain("rt.registry");
			for (const t of timings) {
				expect(t.dur).toBeGreaterThanOrEqual(0);
				expect(Number.isFinite(t.dur)).toBe(true);
			}

			expect(runtime.hooks.getExclusiveSelection("content:beforeSave")).toBe(
				"test-exclusive-provider",
			);
			expect(runtime.hooks.getExclusiveSelection("comment:moderate")).toBe(
				DEFAULT_COMMENT_MODERATOR_PLUGIN_ID,
			);

			const row = await runtime.db
				.selectFrom("options")
				.select("value")
				.where("name", "=", "emdash:exclusive_hook:content:beforeSave")
				.executeTakeFirst();
			expect(row).toBeDefined();
			expect(JSON.parse(row!.value)).toBe("test-exclusive-provider");
		} finally {
			await runtime.stopCron();
		}
	});

	it("creates a runtime without a timings array (backwards compatible)", async () => {
		const runtime = await EmDashRuntime.create(createDeps());
		try {
			expect(runtime.hooks.getExclusiveSelection("content:beforeSave")).toBe(
				"test-exclusive-provider",
			);
		} finally {
			await runtime.stopCron();
		}
	});

	it("repairs historical locale casing from runtime configuration", async () => {
		const previousI18nConfig = getI18nConfig();
		setI18nConfig({ defaultLocale: "zh-TW", locales: ["en", "zh-TW"] });
		const sqlite = new Database(":memory:");
		const setupDb = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: sqlite }),
		});
		await runMigrations(setupDb);
		await sql`
			CREATE TABLE ec_post (
				id TEXT PRIMARY KEY,
				slug TEXT NOT NULL,
				locale TEXT NOT NULL,
				UNIQUE (slug, locale)
			)
		`.execute(setupDb);
		await sql`INSERT INTO ec_post (id, slug, locale) VALUES ('post-1', 'guide', 'zh-tw')`.execute(
			setupDb,
		);
		await new OptionsRepository(setupDb).set("emdash:setup_complete", true);

		const deps = createDeps();
		deps.createDialect = () => new SqliteDialect({ database: sqlite });
		const timings: Array<{ name: string; dur: number; desc?: string }> = [];
		const runtime = await EmDashRuntime.create(deps, timings);

		try {
			const row = await sql<{ locale: string }>`SELECT locale FROM ec_post`.execute(runtime.db);
			expect(row.rows[0]?.locale).toBe("zh-TW");
			expect(await new OptionsRepository(runtime.db).get("emdash:repair_locale_casing")).toBe(
				"1:en,zh-TW",
			);
			expect(timings.map((timing) => timing.name)).toContain("rt.locale");
		} finally {
			await runtime.stopCron();
			await setupDb.destroy();
			setI18nConfig(previousI18nConfig);
		}
	});

	it("repairs casing after configuration changes to a simple lowercase locale", async () => {
		const previousI18nConfig = getI18nConfig();
		setI18nConfig({ defaultLocale: "en", locales: ["en"] });
		const sqlite = new Database(":memory:");
		const setupDb = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: sqlite }),
		});
		await runMigrations(setupDb);
		await sql`
			CREATE TABLE ec_post (
				id TEXT PRIMARY KEY,
				slug TEXT NOT NULL,
				locale TEXT NOT NULL,
				UNIQUE (slug, locale)
			)
		`.execute(setupDb);
		await sql`INSERT INTO ec_post (id, slug, locale) VALUES ('post-1', 'guide', 'EN')`.execute(
			setupDb,
		);
		const options = new OptionsRepository(setupDb);
		await options.set("emdash:setup_complete", true);
		await options.set("emdash:repair_locale_casing", "1:EN");

		const deps = createDeps();
		deps.createDialect = () => new SqliteDialect({ database: sqlite });
		const runtime = await EmDashRuntime.create(deps);

		try {
			const row = await sql<{ locale: string }>`SELECT locale FROM ec_post`.execute(runtime.db);
			expect(row.rows[0]?.locale).toBe("en");
			expect(await new OptionsRepository(runtime.db).get("emdash:repair_locale_casing")).toBe(
				"1:en",
			);
		} finally {
			await runtime.stopCron();
			await setupDb.destroy();
			setI18nConfig(previousI18nConfig);
		}
	});

	it("warns about historical taxonomy locales when the operator manifest is built", async () => {
		const previousI18nConfig = getI18nConfig();
		setI18nConfig(null);
		const sqlite = new Database(":memory:");
		const setupDb = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: sqlite }),
		});
		await runMigrations(setupDb);
		await new OptionsRepository(setupDb).set("emdash:setup_complete", true);
		setI18nConfig({ defaultLocale: "ja", locales: ["ja"] });

		const deps = createDeps();
		deps.createDialect = () => new SqliteDialect({ database: sqlite });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const runtime = await EmDashRuntime.create(deps);

		try {
			expect(warn).not.toHaveBeenCalled();
			await runtime.getManifest();
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("Taxonomy rows use locales outside the configured locales (ja)"),
			);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("definitions: en"));
		} finally {
			warn.mockRestore();
			await runtime.stopCron();
			await setupDb.destroy();
			setI18nConfig(previousI18nConfig);
		}
	});

	it("passes normalized site information to the sandbox runner", async () => {
		const sqlite = new Database(":memory:");
		const setupDb = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: sqlite }),
		});
		await runMigrations(setupDb);
		const options = new OptionsRepository(setupDb);
		await options.set("emdash:setup_complete", true);
		await options.set("emdash:site_title", "Example Site");
		await options.set("emdash:site_url", "https://example.com/");
		await options.set("emdash:locale", "nl");

		const runner = {
			isAvailable: () => true,
			isHealthy: () => true,
			load: vi.fn(),
			setEmailSend: vi.fn(),
			terminateAll: vi.fn(),
		};
		const createSandboxRunner = vi.fn(() => runner as never);
		const deps: RuntimeDependencies = {
			...createDeps(),
			createDialect: () => new SqliteDialect({ database: sqlite }),
			sandboxEnabled: true,
			createSandboxRunner,
		};

		const runtime = await EmDashRuntime.create(deps);
		try {
			expect(createSandboxRunner).toHaveBeenCalledWith(
				expect.objectContaining({
					siteInfo: {
						name: "Example Site",
						url: "https://example.com",
						locale: "nl",
						trailingSlash: "ignore",
					},
				}),
			);
		} finally {
			await runtime.stopCron();
			await setupDb.destroy();
		}
	});

	it("excludes a plugin disabled in _plugin_state from the initial pipeline", async () => {
		const sqlite = new Database(":memory:");
		const setupDb = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: sqlite }),
		});
		await runMigrations(setupDb);
		await setupDb
			.insertInto("_plugin_state")
			.values({ plugin_id: "test-exclusive-provider", version: "1.0.0", status: "inactive" })
			.execute();
		await setupDb
			.insertInto("options")
			.values({ name: "emdash:setup_complete", value: "true" })
			.execute();

		const deps: RuntimeDependencies = {
			...createDeps(),
			createDialect: () => new SqliteDialect({ database: sqlite }),
		};
		const runtime = await EmDashRuntime.create(deps);
		try {
			expect(runtime.hooks.getExclusiveSelection("content:beforeSave")).toBeUndefined();
			expect(runtime.hooks.getExclusiveSelection("comment:moderate")).toBe(
				DEFAULT_COMMENT_MODERATOR_PLUGIN_ID,
			);
		} finally {
			await runtime.stopCron();
			await setupDb.destroy();
		}
	});

	it("routes the cold-start read phase through createCoalescingDialect", async () => {
		const singletonSqlite = new Database(":memory:");
		const singletonSetup = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: singletonSqlite }),
		});
		await runMigrations(singletonSetup);
		await singletonSetup
			.insertInto("options")
			.values({ name: "emdash:setup_complete", value: "true" })
			.execute();

		const coalescingSqlite = new Database(":memory:");
		const coalescingSetup = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: coalescingSqlite }),
		});
		await runMigrations(coalescingSetup);
		await coalescingSetup
			.insertInto("_plugin_state")
			.values({ plugin_id: "test-exclusive-provider", version: "1.0.0", status: "inactive" })
			.execute();
		await coalescingSetup
			.insertInto("options")
			.values({ name: "emdash:setup_complete", value: "true" })
			.execute();

		let coalescingCalls = 0;
		const deps: RuntimeDependencies = {
			...createDeps(),
			createDialect: () => new SqliteDialect({ database: singletonSqlite }),
			createCoalescingDialect: () => {
				coalescingCalls += 1;
				return new SqliteDialect({ database: coalescingSqlite });
			},
		};
		const runtime = await EmDashRuntime.create(deps);
		try {
			expect(coalescingCalls).toBe(1);
			expect(runtime.hooks.getExclusiveSelection("content:beforeSave")).toBeUndefined();
		} finally {
			await runtime.stopCron();
			try {
				await singletonSetup.destroy();
			} catch {}
			try {
				await coalescingSetup.destroy();
			} catch {}
		}
	});

	it("backs off after a migration failure instead of retrying immediately", async () => {
		const sqlite = new Database(":memory:");
		const setupDb = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: sqlite }),
		});
		await runMigrations(setupDb);
		await sql`DELETE FROM _emdash_migrations WHERE name = '001_initial'`.execute(setupDb);

		let dialectCalls = 0;
		const deps: RuntimeDependencies = {
			...createDeps(),
			createDialect: () => {
				dialectCalls += 1;
				return new SqliteDialect({ database: sqlite });
			},
		};

		await expect(EmDashRuntime.create(deps)).rejects.toThrow(/Migration failed/i);
		expect(dialectCalls).toBe(1);

		await expect(EmDashRuntime.create(deps)).rejects.toThrow(/backing off/i);
		expect(dialectCalls).toBe(1);
	});

	it("rechecks pending migrations without entering migration-failure backoff", async () => {
		let dialectCalls = 0;
		const deps: RuntimeDependencies = {
			...createDeps(),
			migrationMode: "check",
			createDialect: () => {
				dialectCalls += 1;
				return new SqliteDialect({ database: new Database(":memory:") });
			},
		};

		await expect(EmDashRuntime.create(deps)).rejects.toBeInstanceOf(PendingMigrationsError);
		await expect(EmDashRuntime.create(deps)).rejects.toBeInstanceOf(PendingMigrationsError);
		expect(dialectCalls).toBe(2);
	});

	it("rejects an empty database in manual migration mode", async () => {
		const deps: RuntimeDependencies = {
			...createDeps(),
			migrationMode: "manual",
		};

		await expect(EmDashRuntime.create(deps)).rejects.toThrow(/no such table/i);
	});

	it("does not run the auto-seed gate for an isolated request db", async () => {
		const sqlite = new Database(":memory:");
		const isolated = new Kysely<EmDashDatabase>({
			dialect: new SqliteDialect({ database: sqlite }),
		});
		await runMigrations(isolated);
		await isolated
			.insertInto("_plugin_state")
			.values({ plugin_id: "test-exclusive-provider", version: "1.0.0", status: "inactive" })
			.execute();
		const before = await isolated
			.selectFrom("_emdash_collections")
			.select((eb) => eb.fn.countAll<number>().as("count"))
			.executeTakeFirstOrThrow();
		expect(before.count).toBe(0);

		const timings: Array<{ name: string; dur: number; desc?: string }> = [];
		const runtime = await runWithContext(
			{ editMode: false, db: isolated, dbIsIsolated: true },
			() => EmDashRuntime.create(createDeps(), timings),
		);
		try {
			expect(runtime.hooks.getExclusiveSelection("content:beforeSave")).toBeUndefined();
			expect(timings.map((t) => t.name)).not.toContain("rt.seedcheck");
			const after = await isolated
				.selectFrom("_emdash_collections")
				.select((eb) => eb.fn.countAll<number>().as("count"))
				.executeTakeFirstOrThrow();
			expect(after.count).toBe(0);
		} finally {
			await runtime.stopCron();
			await isolated.destroy();
		}
	});
});
