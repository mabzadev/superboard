import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import { SqliteDialect } from "kysely";
import { describe, expect, it } from "vitest";

import { createPublicPluginApiRouteHandler } from "../../../../../../packages/core/src/astro/public-plugin-api-routes.js";
import {
	EmDashRuntime,
	type RuntimeDependencies,
} from "../../../../../../packages/core/src/emdash-runtime.js";
import { CronAccessImpl, CronExecutor } from "../../../../../../packages/core/src/plugins/cron.js";
import { definePlugin } from "../../../../../../packages/core/src/plugins/define-plugin.js";
import {
	createRequestMetrics,
	runWithContext,
} from "../../../../../../packages/core/src/request-context.js";

function createDeps(onActivate: (hasCron: boolean) => void): RuntimeDependencies {
	const entrypoint = `test-plugin-cron-route-${randomUUID()}`;
	return {
		config: { database: { entrypoint, config: {}, type: "sqlite" } },
		plugins: [
			definePlugin({
				id: "cron-route",
				version: "1.0.0",
				capabilities: ["content:write"],
				routes: {
					health: { handler: async () => ({ status: "ready", plugin_id: "cron-route" }) },
					status: { public: true, handler: async (ctx) => ({ hasCron: !!ctx.cron }) },
					write: {
						public: true,
						handler: async (ctx) => {
							if (!ctx.content || !("create" in ctx.content)) {
								throw new Error("Content write access unavailable");
							}
							return ctx.content.create("posts", { slug: "plugin-write" });
						},
					},
				},
				hooks: {
					"plugin:activate": {
						handler: async (_event, ctx) => onActivate(!!ctx.cron),
					},
				},
			}),
		],
		createDialect: () => new SqliteDialect({ database: new Database(":memory:") }),
		createScheduler: null,
		sandboxEnabled: false,
		sandboxedPluginEntries: [],
		createSandboxRunner: null,
	};
}

describe("EmDashRuntime.handlePluginApiRoute — cron", () => {
	it("provides database-backed cron access without an in-process scheduler", async () => {
		let activateHasCron = false;
		const runtime = await EmDashRuntime.create(
			createDeps((hasCron) => {
				activateHasCron = hasCron;
			}),
		);
		try {
			const result = await runtime.handlePluginApiRoute(
				"cron-route",
				"GET",
				"/status",
				new Request("http://test.local/_emdash/api/plugins/cron-route/status"),
			);
			expect(result).toMatchObject({ success: true, data: { hasCron: true } });

			await runtime.setPluginStatus("cron-route", "inactive");
			await runtime.setPluginStatus("cron-route", "active");
			expect(activateHasCron).toBe(true);
		} finally {
			await runtime.stopCron();
		}
	});

	it("inspects disabled plugin health without re-enabling its business routes", async () => {
		let activations = 0;
		const runtime = await EmDashRuntime.create(
			createDeps(() => {
				activations += 1;
			}),
		);
		try {
			await runtime.setPluginStatus("cron-route", "inactive");
			const request = new Request("http://test.local/_emdash/api/plugins/cron-route/health");
			expect(await runtime.inspectPluginHealth("cron-route", request)).toMatchObject({
				success: true,
				data: { status: "ready" },
			});
			expect(
				await runtime.handlePluginApiRoute("cron-route", "GET", "/status", request),
			).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
			await runtime.setPluginStatus("cron-route", "active");
			const count = activations;
			await runtime.setPluginStatus("cron-route", "active");
			expect(activations).toBe(count);
		} finally {
			await runtime.stopCron();
		}
	});

	it("keeps public plugin reads query-free and fences only actual content writes", async () => {
		const runtime = await EmDashRuntime.create(createDeps(() => undefined));
		try {
			await runtime.db
				.updateTable("_emdash_media_usage_activation")
				.set({ state: "activating" })
				.where("task_key", "=", "incremental_capture")
				.execute();
			const handler = createPublicPluginApiRouteHandler(runtime);
			const metrics = createRequestMetrics(performance.now());

			const readResult = await runWithContext({ editMode: false, metrics }, async () =>
				handler("cron-route", "GET", "/status", new Request("http://test.local/page")),
			);
			expect(readResult).toMatchObject({ success: true, data: { hasCron: true } });
			expect(metrics.dbCount).toBe(0);

			const writeResult = await handler(
				"cron-route",
				"GET",
				"/write",
				new Request("http://test.local/page"),
			);

			expect(writeResult).toMatchObject({
				success: false,
				status: 503,
				error: { code: "MEDIA_USAGE_ACTIVATION_IN_PROGRESS" },
			});
		} finally {
			await runtime.stopCron();
		}
	});
});

it("suspends overdue plugin jobs and resumes them after reactivation", async () => {
	const runtime = await EmDashRuntime.create(createDeps(() => undefined));
	try {
		const access = new CronAccessImpl(runtime.db, "cron-route", () => undefined);
		await access.schedule("daily-check", { schedule: "@hourly" });
		await runtime.db
			.updateTable("_emdash_cron_tasks")
			.set({ next_run_at: new Date(Date.now() - 1000).toISOString() })
			.where("plugin_id", "=", "cron-route")
			.execute();
		let invoked = 0;
		const executor = new CronExecutor(runtime.db, async () => {
			invoked += 1;
		});
		await runtime.setPluginStatus("cron-route", "inactive");
		expect(await executor.tick()).toBe(0);
		expect(invoked).toBe(0);
		await runtime.setPluginStatus("cron-route", "active");
		expect(await executor.tick()).toBe(1);
		expect(invoked).toBe(1);
	} finally {
		await runtime.stopCron();
	}
});

it("can deactivate a plugin after its activation hook fails permanently", async () => {
	let failActivation = false;
	const runtime = await EmDashRuntime.create(
		createDeps(() => {
			if (failActivation) throw new Error("activation hook failed");
		}),
	);
	try {
		await runtime.setPluginStatus("cron-route", "inactive");
		failActivation = true;
		await expect(runtime.setPluginStatus("cron-route", "active")).rejects.toThrow(
			"activation hook failed",
		);
		expect(
			await runtime.handlePluginApiRoute(
				"cron-route",
				"GET",
				"/status",
				new Request("https://site.test/status"),
			),
		).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
		await expect(runtime.setPluginStatus("cron-route", "active")).rejects.toThrow(
			"activation hook failed",
		);
		await runtime.setPluginStatus("cron-route", "inactive");
		expect(
			await runtime.handlePluginApiRoute(
				"cron-route",
				"GET",
				"/status",
				new Request("https://site.test/status"),
			),
		).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
	} finally {
		await runtime.stopCron();
	}
});
