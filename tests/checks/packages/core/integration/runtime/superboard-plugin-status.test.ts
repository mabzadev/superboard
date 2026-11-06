import { randomUUID } from "node:crypto";

import { SqliteDialect } from "kysely";
import { afterEach, expect, it } from "vitest";

import { NodeSqliteCompatDatabase as Database } from "../../../../../../packages/core/src/db/node-sqlite-compat.js";
import { EmDashRuntime } from "../../../../../../packages/core/src/emdash-runtime.js";
import { definePlugin } from "../../../../../../packages/core/src/plugins/define-plugin.js";

let runtime: EmDashRuntime | undefined;

afterEach(async () => {
	await runtime?.stopCron();
	runtime = undefined;
});

async function createRuntime(activate: () => Promise<void>): Promise<EmDashRuntime> {
	runtime = await EmDashRuntime.create({
		config: {
			database: {
				entrypoint: `test-superboard-plugin-status-${randomUUID()}`,
				config: {},
				type: "sqlite",
			},
		},
		plugins: [
			definePlugin({
				id: "managed",
				version: "1.0.0",
				capabilities: [],
				routes: { ping: { public: true, handler: async () => ({ ok: true }) } },
				hooks: { "plugin:activate": { handler: activate } },
			}),
		],
		createDialect: () => new SqliteDialect({ database: new Database(":memory:") }),
		createScheduler: null,
		sandboxEnabled: false,
		sandboxedPluginEntries: [],
		createSandboxRunner: null,
	});
	return runtime;
}

function ping(current: EmDashRuntime) {
	return current.handlePluginApiRoute(
		"managed",
		"GET",
		"/ping",
		new Request("http://test.local/_emdash/api/plugins/managed/ping"),
	);
}

it("runs a plugin's activation hook once when a host repeats the activation", async () => {
	let activations = 0;
	const current = await createRuntime(async () => {
		activations += 1;
	});
	await current.setPluginStatus("managed", "inactive");
	const before = activations;

	await current.setPluginStatus("managed", "active");
	await current.setPluginStatus("managed", "active");

	expect(activations).toBe(before + 1);
	expect(await ping(current)).toMatchObject({ success: true });
});

it("keeps a plugin disabled when its activation hook fails", async () => {
	const current = await createRuntime(async () => {
		throw new Error("activation failed");
	});
	await current.setPluginStatus("managed", "inactive");

	await expect(current.setPluginStatus("managed", "active")).rejects.toThrow("activation failed");

	expect(await ping(current)).toMatchObject({ success: false });
});
